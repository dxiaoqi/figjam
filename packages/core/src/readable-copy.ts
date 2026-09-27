import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { writeFileAtomic } from './atomic'

/**
 * The readable `<id>.json` next to each board is a convenience copy (for people, diffs and scripts); the
 * `.aifig` file is the source of truth. Building it means walking every block and stringifying megabytes,
 * so it is debounced and built in a worker thread from the bytes the save already encoded: saves stay cheap
 * on the core's event loop even for 10k-block boards.
 *
 * `AIFIG_JSON_COPY`: `worker` (default) · `sync` (same debounce, built on the main thread) · `off`.
 */
export type ReadableCopyMode = 'worker' | 'sync' | 'off'

export const readableCopyMode = (): ReadableCopyMode => {
  const v = process.env.AIFIG_JSON_COPY?.trim().toLowerCase()
  return v === 'off' || v === '0' || v === 'false' ? 'off' : v === 'sync' ? 'sync' : 'worker'
}

/** Quiet period before the copy is rebuilt… */
export const JSON_COPY_DEBOUNCE_MS = 1500
/** …but never later than this after the first save it is missing. */
export const JSON_COPY_MAX_WAIT_MS = 10_000

export interface ReadableSource {
  id: string
  jsonFile: string
  title: string
  schemaLabel: string
  toJSON(): unknown
}

interface Pending {
  source: ReadableSource
  payload: Uint8Array
  timer: NodeJS.Timeout
  firstAt: number
}

// A sibling module: packages/core/src/readable-copy-worker.mjs from source, or the copy the desktop build bundles
// (with yjs inlined) next to aifig.mjs — a packaged app has no node_modules to resolve yjs from.
const WORKER_URL = new URL('./readable-copy-worker.mjs', import.meta.url)

const WORKER_IDLE_MS = 15_000

class ReadableCopies {
  private pending = new Map<string, Pending>()
  private inflight = new Map<string, Promise<void>>()
  private removed = new Set<string>()
  private worker: Worker | null | undefined
  private idleTimer: NodeJS.Timeout | undefined
  private seq = 0
  private workerError: string | null = null
  private written = { worker: 0, inline: 0 }
  private jobs = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()

  /** A save wrote `payload` (the board's Yjs state); refresh the readable copy soon. */
  schedule(source: ReadableSource, payload: Uint8Array) {
    const mode = readableCopyMode()
    if (mode === 'off') return
    this.removed.delete(source.jsonFile)
    const prev = this.pending.get(source.jsonFile)
    if (prev) clearTimeout(prev.timer)
    const firstAt = prev?.firstAt ?? Date.now()
    const wait = Math.max(0, Math.min(JSON_COPY_DEBOUNCE_MS, firstAt + JSON_COPY_MAX_WAIT_MS - Date.now()))
    const timer = setTimeout(() => void this.run(source.jsonFile), wait)
    timer.unref?.()
    this.pending.set(source.jsonFile, { source, payload, timer, firstAt })
  }

  /** The board is gone: drop a pending copy and delete the file (also once an in-flight write lands). */
  remove(file: string) {
    const p = this.pending.get(file)
    if (p) clearTimeout(p.timer)
    this.pending.delete(file)
    this.removed.add(file)
    fs.rmSync(file, { force: true })
    void this.inflight.get(file)?.finally(() => this.removed.has(file) && fs.rmSync(file, { force: true }))
  }

  /** Write every pending copy now, on this thread. Synchronous, so it is safe in exit handlers. */
  flushSync() {
    for (const [file, p] of this.pending) {
      clearTimeout(p.timer)
      this.pending.delete(file)
      this.writeSync(p.source)
    }
  }

  /** Resolves once nothing is pending or being written (tests, benchmarks). */
  async idle() {
    while (this.pending.size || this.inflight.size) {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        void this.run(p.source.jsonFile)
      }
      await Promise.allSettled([...this.inflight.values()])
    }
  }

  /** Which path builds the copies, for /api/health and the packaging smoke test. */
  status() {
    const mode = readableCopyMode()
    return { mode, worker: mode !== 'worker' ? 'off' : this.worker ? 'running' : this.worker === null ? 'unavailable' : 'idle', workerError: this.workerError, written: { ...this.written } }
  }

  private writeSync(source: ReadableSource) {
    try {
      writeFileAtomic(source.jsonFile, JSON.stringify(source.toJSON(), null, 2))
      this.written.inline++
    } catch (e) {
      console.error(`[core] could not write ${source.jsonFile}:`, e)
    }
  }

  private async run(file: string) {
    // one write per file at a time; a newer payload waits for the running one
    const running = this.inflight.get(file)
    if (running) {
      await running
      if (this.inflight.has(file)) return
    }
    const p = this.pending.get(file)
    if (!p) return
    this.pending.delete(file)
    const job = this.write(p).finally(() => {
      if (this.inflight.get(file) === job) this.inflight.delete(file)
      if (this.removed.has(file)) fs.rmSync(file, { force: true })
    })
    this.inflight.set(file, job)
    await job
  }

  private async write({ source, payload }: Pending) {
    const w = readableCopyMode() === 'worker' ? this.getWorker() : null
    if (!w) return this.writeSync(source)
    const id = ++this.seq
    try {
      await new Promise<void>((resolve, reject) => {
        this.jobs.set(id, { resolve, reject })
        clearTimeout(this.idleTimer)
        w.ref()
        w.postMessage({ id, file: source.jsonFile, payload, board: source.id, title: source.title, schema: source.schemaLabel })
      })
      this.written.worker++
    } catch (e) {
      console.error(`[core] could not write ${source.jsonFile} in the background, writing it inline:`, (e as Error).message)
      this.writeSync(source)
    }
  }

  private getWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker
    try {
      if (!fs.existsSync(fileURLToPath(WORKER_URL))) throw new Error(`${fileURLToPath(WORKER_URL)} is missing`)
      const w = new Worker(WORKER_URL)
      w.unref()
      w.on('message', (m: { id: number; error?: string }) => {
        const job = this.jobs.get(m.id)
        this.jobs.delete(m.id)
        if (!this.jobs.size) {
          w.unref()
          this.idleTimer = setTimeout(() => {
            if (this.jobs.size || this.worker !== w) return
            this.worker = undefined
            void w.terminate()
          }, WORKER_IDLE_MS)
          this.idleTimer.unref()
        }
        if (m.error) job?.reject(new Error(m.error))
        else job?.resolve()
      })
      w.on('error', (e) => {
        this.workerError = e.message
        for (const j of this.jobs.values()) j.reject(e)
        this.jobs.clear()
        this.worker = undefined
      })
      this.worker = w
    } catch (e) {
      this.workerError = (e as Error).message
      console.error(`[core] the readable-copy worker is unavailable, writing copies inline: ${this.workerError}`)
      this.worker = null
    }
    return this.worker
  }
}

export const readableCopies = new ReadableCopies()
