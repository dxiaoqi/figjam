import fs from 'node:fs'
import path from 'node:path'
import { SNIPPET_FILES, type Block, type CallerInfo, type CallRequest, type CallResponse, type SnippetFileEvent, type SnippetPart } from '@nodboard/shared'
import { writeFileAtomic } from './atomic'
import type { Board, BoardRegistry } from './board'

/** Edits saved in an editor that nobody checked out are the person's own. */
export const EDITOR_CALLER: CallerInfo = { id: 'human:editor', name: 'External editor', client: 'editor', kind: 'human' }

/** An agent that asked for the files owns their edits (as change sets) for this long after its last one. */
export const CHECKOUT_MS = 30 * 60_000

const PARTS = Object.keys(SNIPPET_FILES) as SnippetPart[]

interface Core {
  registry: BoardRegistry
  call(req: CallRequest): Promise<CallResponse>
}

/**
 * Editable working copies of inline web snippets: `snippets/<block>/index.html, style.css, script.js` in the
 * board's assets folder (next to `Name.nodboard` when the board has a file). The asset files themselves stay
 * immutable; a save here goes through `update_snippet` like any other edit — the canvas updates live, the
 * block is attributed to the external editor, and an agent that checked the files out gets a change set to
 * review. When the snippet changes elsewhere (canvas, agent, review), the files are rewritten to match.
 */
export class SnippetFiles {
  private watchers = new Map<string, fs.FSWatcher>()
  private timers = new Map<string, NodeJS.Timeout>()
  private checkouts = new Map<string, { caller: CallerInfo; until: number }>()
  private observed = new WeakSet<Board>()
  private busy = new Set<string>()
  onEvent: (e: SnippetFileEvent) => void = () => {}

  constructor(private core: Core) {}

  static rootFor(board: Board) {
    return path.join(board.externalStore?.dir ?? board.assetsDir, 'snippets')
  }

  dirFor(board: Board, blockId: string) {
    if (!/^[\w-]+$/.test(blockId)) throw new Error(`Not a block id: ${blockId}`)
    return path.join(SnippetFiles.rootFor(board), blockId)
  }

  private key(board: Board, blockId: string) {
    return `${board.id}:${blockId}`
  }

  private files(dir: string) {
    return Object.fromEntries(PARTS.map((p) => [p, path.join(dir, SNIPPET_FILES[p].name)])) as Record<SnippetPart, string>
  }

  private readFiles(dir: string): Record<SnippetPart, string> | null {
    const out = {} as Record<SnippetPart, string>
    for (const [p, f] of Object.entries(this.files(dir)) as [SnippetPart, string][]) {
      try {
        out[p] = fs.readFileSync(f, 'utf8')
      } catch {
        out[p] = ''
      }
    }
    return out
  }

  private write(board: Board, block: Block, dir: string) {
    const src = board.snippetSource(block.web)
    for (const [p, f] of Object.entries(this.files(dir)) as [SnippetPart, string][]) {
      let cur: string | null = null
      try {
        cur = fs.readFileSync(f, 'utf8')
      } catch {
        // new
      }
      if (cur !== src[p]) writeFileAtomic(f, src[p])
    }
  }

  /** Write the working copies (if needed) and start watching them. */
  materialize(board: Board, blockId: string) {
    const block = board.blocks.get(blockId)
    if (block?.kind !== 'web' || block.web?.mode !== 'inline') throw new Error(`No inline web snippet "${blockId}"`)
    const dir = this.dirFor(board, blockId)
    fs.mkdirSync(dir, { recursive: true })
    this.write(board, block, dir)
    this.watch(board, blockId, dir)
    return { dir, files: this.files(dir) }
  }

  /** Materialize for an agent: its saves become change sets for the next CHECKOUT_MS. */
  checkout(board: Board, blockId: string, caller: CallerInfo) {
    const r = this.materialize(board, blockId)
    if (caller.kind === 'agent') this.checkouts.set(this.key(board, blockId), { caller, until: Date.now() + CHECKOUT_MS })
    return { ...r, until: caller.kind === 'agent' ? Date.now() + CHECKOUT_MS : null }
  }

  private watch(board: Board, blockId: string, dir: string) {
    this.observe(board)
    const key = this.key(board, blockId)
    if (this.watchers.has(key)) return
    try {
      const w = fs.watch(dir, () => this.schedule(board, blockId))
      w.on('error', () => this.unwatch(key))
      this.watchers.set(key, w)
    } catch (e) {
      console.error(`[core] can't watch ${dir}:`, e)
    }
  }

  private unwatch(key: string) {
    this.watchers.get(key)?.close()
    this.watchers.delete(key)
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
  }

  private schedule(board: Board, blockId: string, ms = 150) {
    const key = this.key(board, blockId)
    clearTimeout(this.timers.get(key))
    const t = setTimeout(() => {
      this.timers.delete(key)
      this.ingest(board, blockId).catch((e) => console.error('[core] snippet file sync failed:', e))
    }, ms)
    t.unref?.()
    this.timers.set(key, t)
  }

  /** The files changed on disk: apply them to the snippet unless they already match. */
  async ingest(board: Board, blockId: string) {
    const key = this.key(board, blockId)
    const block = board.blocks.get(blockId)
    if (!block || block.kind !== 'web' || block.web?.mode !== 'inline') return
    const dir = this.dirFor(board, blockId)
    const next = this.readFiles(dir)
    if (!next) return
    const cur = board.snippetSource(block.web)
    const changed = PARTS.filter((p) => next[p] !== cur[p])
    if (!changed.length || this.busy.has(key)) return
    const co = this.checkouts.get(key)
    const caller = co && co.until > Date.now() ? co.caller : EDITOR_CALLER
    const names = changed.map((p) => SNIPPET_FILES[p].name)
    this.busy.add(key)
    try {
      const r = await this.core.call({
        tool: 'update_snippet',
        args: { board: board.id, id: blockId, ...Object.fromEntries(changed.map((p) => [p, next[p]])), intent: `Edited ${names.join(', ')} in an editor` },
        caller,
      })
      const file = names.join(', ')
      if (!r.ok) this.onEvent({ type: 'snippet-file', boardId: board.id, blockId, file, status: 'error', by: caller.name, message: r.error })
      else {
        const cs = (r.result as { changeSet?: string | null }).changeSet ?? null
        if (co && cs) co.until = Date.now() + CHECKOUT_MS
        this.onEvent({ type: 'snippet-file', boardId: board.id, blockId, file, status: cs ? 'review' : 'applied', by: caller.name, changeSet: cs })
      }
    } finally {
      this.busy.delete(key)
    }
  }

  /** Keep working copies in step with the snippet (canvas edits, agents, accept / reject). */
  private observe(board: Board) {
    if (this.observed.has(board)) return
    this.observed.add(board)
    board.blocks.observe((e) => {
      e.changes.keys.forEach((c, id) => {
        const key = this.key(board, id)
        if (!this.watchers.has(key)) return
        if (c.action === 'delete') {
          this.unwatch(key)
          fs.rmSync(this.dirFor(board, id), { recursive: true, force: true })
          return
        }
        const b = board.blocks.get(id)
        if (b?.kind === 'web' && b.web?.mode === 'inline' && !this.busy.has(key)) {
          try {
            this.write(board, b, this.dirFor(board, id))
          } catch (err) {
            console.error(`[core] could not update the files of snippet ${id}:`, err)
          }
        }
      })
    })
  }

  /**
   * Pick up working copies that exist on disk (after a restart). Files saved while the core was off win if
   * they're newer than the snippet; otherwise they're brought up to date.
   */
  resume(board: Board) {
    const root = SnippetFiles.rootFor(board)
    let ids: string[] = []
    try {
      ids = fs.readdirSync(root)
    } catch {
      return
    }
    for (const id of ids) {
      const block = board.blocks.get(id)
      const dir = path.join(root, id)
      if (block?.kind !== 'web' || block.web?.mode !== 'inline') continue
      const newest = Math.max(0, ...Object.values(this.files(dir)).map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)))
      if (newest > block.updatedAt) this.schedule(board, id, 0)
      else this.write(board, block, dir)
      this.watch(board, id, dir)
    }
  }

  close() {
    for (const k of [...this.watchers.keys()]) this.unwatch(k)
  }
}
