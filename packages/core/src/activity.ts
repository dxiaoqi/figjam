import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type { ActivityCategory, ActivityEntry } from '@aifig/shared'

const MAX_BYTES = 1024 * 1024
const KEEP_IN_MEMORY = 500

/** Strings that look like credentials are masked before anything reaches the log. */
const SECRETISH = /\b(sk-[\w-]{8,}|sk-ant-[\w-]{8,}|gh[pousr]_[\w]{16,}|xox[baprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|Bearer\s+[\w.~+/-]{16,}|[A-Za-z0-9_-]{40,})\b/g
export const redact = (s: string) => s.replace(SECRETISH, '[redacted]')

/**
 * Append-only activity log for actions that touch the network, secrets or permissions. JSONL under
 * AIFIG_HOME (0600, rotated at 1 MB, one previous file kept) plus an in-memory tail for the canvas.
 */
export class ActivityLog {
  private tail: ActivityEntry[] = []
  private listeners = new Set<(e: ActivityEntry) => void>()
  private throttle = new Map<string, number>()

  constructor(private file: string | null) {
    if (!file) return
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-KEEP_IN_MEMORY)
      this.tail = lines.filter(Boolean).map((l) => JSON.parse(l) as ActivityEntry)
    } catch {
      // first run or unreadable: start fresh
    }
  }

  static at(home: string) {
    return new ActivityLog(path.join(home, 'activity.jsonl'))
  }

  onRecord(fn: (e: ActivityEntry) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  record(e: Omit<ActivityEntry, 'id' | 'at'>, opts: { throttleKey?: string; throttleMs?: number } = {}): ActivityEntry | null {
    if (opts.throttleKey) {
      const last = this.throttle.get(opts.throttleKey) ?? 0
      if (Date.now() - last < (opts.throttleMs ?? 60_000)) return null
      this.throttle.set(opts.throttleKey, Date.now())
    }
    const entry: ActivityEntry = {
      ...e,
      id: nanoid(10),
      at: Date.now(),
      target: e.target ? redact(e.target).slice(0, 200) : undefined,
      detail: e.detail ? redact(e.detail).slice(0, 500) : undefined,
    }
    this.tail.push(entry)
    if (this.tail.length > KEEP_IN_MEMORY) this.tail.splice(0, this.tail.length - KEEP_IN_MEMORY)
    this.persist(entry)
    for (const fn of this.listeners) fn(entry)
    return entry
  }

  list(opts: { limit?: number; category?: ActivityCategory } = {}): ActivityEntry[] {
    const all = opts.category ? this.tail.filter((e) => e.category === opts.category) : this.tail
    return all.slice(-(opts.limit ?? 200)).reverse()
  }

  private persist(entry: ActivityEntry) {
    if (!this.file) return
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
      try {
        if (fs.statSync(this.file).size > MAX_BYTES) fs.renameSync(this.file, `${this.file}.1`)
      } catch {
        // no file yet
      }
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    } catch (err) {
      console.error('[core] activity log write failed', (err as Error).message)
    }
  }
}
