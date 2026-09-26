import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { Author, Block, ChangeEntry, ChangeSet, Connector, Rect, Thread } from '@aifig/shared'
import { bytesToBase64, COLOR_TOKENS, fitHeight, imageInfo, matchColor, maxBlockHeight, measureSticky, stickyContentHeight } from '@aifig/shared'
import {
  BLOCK_TYPE_IDS,
  BLOCK_TYPES,
  cardContentHeight,
  coerceFields,
  measureCard,
  fieldSummary,
  isBlockType,
  matchesQuery,
  suggestRelation,
  typeChrome,
  typeFields,
  typePatch,
  type BlockTypeId,
  type FieldValue,
  normalizeEmbedUrl,
  SNIPPET_LIMITS,
  snippetHash,
  snippetSourceBytes,
  snippetThumbKey,
  type WebSnippet,
} from '@aifig/shared'
import {
  SPACING,
  snap,
  toSizeToken,
  tokenManifest,
  type ColorToken,
  type SizeToken,
} from '@aifig/shared'
import {
  humanToolDefs,
  toolDefs,
  type AnyToolName,
  type CallRequest,
  type CallResponse,
  type CallerInfo,
} from '@aifig/shared'
import { spawn } from 'node:child_process'
import { diffBlocks, isEmptyPlan, planRestore } from '@aifig/shared'
import { backupRoot, boardBackupDir } from './backups'
import { aifigHome, Board, BoardRegistry, newId } from './board'
import { CorruptFileError, FutureVersionError } from './fileformat'
import { deleteVersion, listVersions, readVersion } from './versions'
import {
  bboxOf,
  findFreeSpot,
  intersects,
  layout,
  lintBlocks,
  measureBlock,
  tidyPositions,
  type LayoutIntent,
  type LayoutItem,
} from './layout'
import { PresenceHub, identify } from './presence'
import { renderSnapshot } from './snapshot'
import { checkSnippetJs } from './snippet-host'

export class ToolError extends Error {}

type Args = Record<string, any>

const PAD = SPACING.framePadding
const GAP = SPACING.gap
const CLUSTER_GAP = SPACING.clusterGap

function preview(s: string | undefined, n = 48) {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function slug(s: string) {
  return s.replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-|-$/g, '') || 'board'
}

export function describeBlock(b: Block) {
  const label = b.kind === 'card' || b.kind === 'frame' ? b.title || b.text : b.text
  return `${b.kind} "${preview(label, 32)}" (${b.id})`
}

/**
 * Applies edits to a board on behalf of a caller. Agent edits are recorded into a change set
 * and marked pending (the suggestion layer); human edits apply directly.
 */
class Recorder {
  readonly entries: ChangeEntry[] = []
  readonly touched = new Set<string>()
  constructor(
    private board: Board,
    private author: Author,
    private changeSet: ChangeSet | null,
  ) {}

  private get pendingFields() {
    return this.changeSet ? { changeSet: this.changeSet.id, pending: true } : { changeSet: null, pending: false }
  }

  private alreadyTracked(id: string) {
    return this.changeSet?.entries.some((e) => e.id === id && (e.op === 'create' || e.op === 'update')) || this.entries.some((e) => e.id === id && (e.op === 'create' || e.op === 'update'))
  }

  createBlock(b: Omit<Block, 'createdAt' | 'updatedAt' | 'author' | 'changeSet' | 'pending'>): Block {
    const now = Date.now()
    const block: Block = { ...b, author: this.author, createdAt: now, updatedAt: now, ...this.pendingFields }
    this.board.blocks.set(block.id, block)
    this.entries.push({ op: 'create', target: 'block', id: block.id })
    this.touched.add(block.id)
    return block
  }

  updateBlock(id: string, patch: Partial<Block>): Block {
    const before = this.board.blocks.get(id)
    if (!before) throw new ToolError(`No block with id "${id}"`)
    const next: Block = { ...before, ...patch, editedBy: this.author, updatedAt: Date.now() }
    if (this.changeSet) {
      if (!this.alreadyTracked(id)) this.entries.push({ op: 'update', target: 'block', id, before })
      Object.assign(next, this.pendingFields)
    }
    this.board.blocks.set(id, next)
    this.touched.add(id)
    return next
  }

  deleteBlock(id: string) {
    const before = this.board.blocks.get(id)
    if (!before) return
    for (const c of [...this.board.connectors.values()]) {
      if (c.from === id || c.to === id) this.deleteConnector(c.id)
    }
    for (const child of this.board.childrenOf(id)) this.deleteBlock(child.id)
    this.board.blocks.delete(id)
    if (this.changeSet) this.entries.push({ op: 'delete', target: 'block', id, before })
    this.touched.add(id)
  }

  createConnector(c: Omit<Connector, 'createdAt' | 'updatedAt' | 'author' | 'changeSet' | 'pending'>) {
    const now = Date.now()
    const conn: Connector = { ...c, author: this.author, createdAt: now, updatedAt: now, ...this.pendingFields }
    this.board.connectors.set(conn.id, conn)
    this.entries.push({ op: 'create', target: 'connector', id: conn.id })
    return conn
  }

  updateConnector(id: string, patch: Partial<Connector>) {
    const before = this.board.connectors.get(id)
    if (!before) throw new ToolError(`No connector with id "${id}"`)
    const next: Connector = { ...before, ...patch, updatedAt: Date.now() }
    if (this.changeSet) {
      if (!this.alreadyTracked(id)) this.entries.push({ op: 'update', target: 'connector', id, before })
      Object.assign(next, this.pendingFields)
    }
    this.board.connectors.set(id, next)
    return next
  }

  deleteConnector(id: string) {
    const before = this.board.connectors.get(id)
    if (!before) return
    this.board.connectors.delete(id)
    if (this.changeSet) this.entries.push({ op: 'delete', target: 'connector', id, before })
  }

  /** Put back a block exactly as it was in a version (keeping its original author). */
  restoreBlock(b: Block) {
    const before = this.board.blocks.get(b.id)
    if (!before) this.entries.push({ op: 'create', target: 'block', id: b.id })
    else if (this.changeSet && !this.alreadyTracked(b.id)) this.entries.push({ op: 'update', target: 'block', id: b.id, before })
    this.board.blocks.set(b.id, { ...b, editedBy: this.author, updatedAt: Date.now(), ...this.pendingFields })
    this.touched.add(b.id)
  }

  restoreConnector(c: Connector) {
    const before = this.board.connectors.get(c.id)
    if (!before) this.entries.push({ op: 'create', target: 'connector', id: c.id })
    else if (this.changeSet && !this.alreadyTracked(c.id)) this.entries.push({ op: 'update', target: 'connector', id: c.id, before })
    this.board.connectors.set(c.id, { ...c, updatedAt: Date.now(), ...this.pendingFields })
  }
}

interface Viewport {
  rect: Rect
  at: number
}

/** Per-call context: who is calling, and silent adjustments to report back as `warnings`. */
interface CallContext {
  caller: CallerInfo
  warnings: string[]
  strict: boolean
}
const callContext = new AsyncLocalStorage<CallContext>()

/** Tell the caller about an adjustment we made on its behalf (snapping, fallbacks, ignored arguments). */
export function warn(message: string) {
  const c = callContext.getStore()
  if (c && !c.warnings.includes(message)) c.warnings.push(message)
}

const strictMode = () => !!callContext.getStore()?.strict

/** Color input → token, reporting fallbacks (or failing in strict mode). */
function colorFor(input: unknown, fallback: ColorToken): ColorToken {
  if (input === undefined || input === null || input === '') return fallback
  const m = matchColor(input, fallback)
  if (m.how === 'unknown') {
    const list = COLOR_TOKENS.join(', ')
    if (strictMode()) throw new ToolError(`Unknown color "${input}". Use a token (${list}) or a hex value.`)
    warn(`Unknown color "${input}" — used "${m.token}". Colors: ${list} (hex values map to the nearest).`)
  } else if (m.how === 'hex') warn(`Color ${input} mapped to the nearest token "${m.token}".`)
  return m.token
}

/** Snap to the grid, collecting "101→104" notes for one summary warning per call. */
function snapNoted(v: number, notes: string[], label: string) {
  const s = snap(v)
  if (s !== v) notes.push(`${label} ${v}→${s}`)
  return s
}
function reportSnapped(notes: string[], what = 'the 8px grid') {
  if (notes.length) warn(`Snapped to ${what}: ${notes.slice(0, 8).join(', ')}${notes.length > 8 ? ` (+${notes.length - 8} more)` : ''}.`)
}

interface CanvasSeen {
  boardId: string
  focused: boolean
  at: number
}

export class CanvasCore {
  readonly registry = new BoardRegistry()
  readonly presence = new PresenceHub()
  private viewports = new Map<string, Viewport>()
  private openChangeSets = new Map<string, string>()
  /** The board the person last worked on in the canvas (persisted across restarts). */
  activeBoardId: string | null = null
  /** Open canvases (one per connection) and whether their window has focus. */
  private canvases = new Map<string, CanvasSeen>()
  /** Board each agent session last used, so defaults stay stable within a session. */
  private sessionBoards = new Map<string, string>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  private get statePath() {
    return path.join(aifigHome(), 'state.json')
  }

  init() {
    this.registry.loadAll()
    if (!this.registry.all().length) this.registry.create('My first board')
    try {
      const saved = JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
      if (saved.activeBoardId && this.registry.get(saved.activeBoardId)) this.activeBoardId = saved.activeBoardId
    } catch {
      // first run
    }
  }

  private persistActive() {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      try {
        fs.mkdirSync(aifigHome(), { recursive: true })
        fs.writeFileSync(this.statePath, JSON.stringify({ activeBoardId: this.activeBoardId }))
      } catch {
        // not fatal: the default just won't survive a restart
      }
    }, 300)
    this.persistTimer.unref?.()
  }

  /** A canvas reported its viewport. Only a focused canvas (or the only one open) moves the active board. */
  setViewport(boardId: string, rect: Rect, conn = 'default', focused = true) {
    this.viewports.set(boardId, { rect, at: Date.now() })
    this.canvases.set(conn, { boardId, focused, at: Date.now() })
    const others = [...this.canvases.entries()].filter(([k, c]) => k !== conn && Date.now() - c.at < 120_000 && c.boardId !== boardId)
    if ((focused || !others.length) && this.activeBoardId !== boardId) {
      this.activeBoardId = boardId
      this.persistActive()
    }
  }

  canvasClosed(conn: string) {
    this.canvases.delete(conn)
  }

  // ---- dispatch -----------------------------------------------------------

  async call(req: CallRequest): Promise<CallResponse> {
    const { tool, caller } = req
    const def = (toolDefs as any)[tool] ?? (humanToolDefs as any)[tool]
    if (!def) return { ok: false, error: `Unknown tool "${tool}"` }
    if (tool in humanToolDefs && caller.kind !== 'human') {
      return { ok: false, error: `"${tool}" can only be used by a human from the canvas app or CLI.` }
    }
    const parsed = z.object(def.input).safeParse(req.args ?? {})
    if (!parsed.success) {
      return { ok: false, error: `Invalid arguments for ${tool}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}` }
    }
    const ctx: CallContext = { caller, warnings: [], strict: (parsed.data as Args).strict === true || process.env.AIFIG_STRICT === '1' }
    try {
      const out = await callContext.run(ctx, () => this.dispatch(tool, parsed.data as Args, caller))
      const withWarnings = (r: unknown) => (ctx.warnings.length && r && typeof r === 'object' && !Array.isArray(r) ? { ...(r as object), warnings: ctx.warnings } : r)
      if (out && typeof out === 'object' && 'image' in out) {
        const { image, ...rest } = out as any
        return { ok: true, result: withWarnings(rest), image }
      }
      return { ok: true, result: withWarnings(out) }
    } catch (e) {
      if (e instanceof ToolError) return { ok: false, error: e.message }
      console.error(`[core] ${tool} failed`, e)
      return { ok: false, error: `Internal error in ${tool}: ${(e as Error).message}` }
    }
  }

  private dispatch(tool: AnyToolName, a: Args, caller: CallerInfo): unknown {
    switch (tool) {
      case 'list_boards':
        return {
          boards: this.registry.all().map((b) => ({ ...b.summary(), open: b.id === this.activeBoardId })),
        }
      case 'create_board': {
        const b = this.registry.create(a.title)
        return { board: b.summary() }
      }
      case 'rename_board': {
        const b = this.board(a.board)
        b.doc.transact(() => {
          b.meta.set('title', a.title)
          b.touch()
        }, 'api')
        return { board: b.summary() }
      }
      case 'open_file': {
        let b: Board
        try {
          b = this.registry.openFile(a.path)
        } catch (e) {
          if (e instanceof FutureVersionError) throw new ToolError(e.message)
          if (e instanceof CorruptFileError) throw new ToolError(`“${path.basename(a.path)}” is damaged and can’t be opened (${e.reason}). If it was an ai-figma board, look for a copy in ${backupRoot()}.`)
          throw e
        }
        return { board: b.summary() }
      }
      case 'save_file': {
        const b = this.board(a.board)
        this.registry.saveAs(b, a.path)
        return { board: b.summary() }
      }
      case 'delete_board': {
        const b = this.board(a.board)
        this.registry.delete(b.id)
        if (!this.registry.all().length) this.registry.create('My first board')
        return { deleted: b.id }
      }
      case 'get_board':
        return this.getBoard(a, caller)
      case 'create_blocks':
        return this.createBlocks(a, caller)
      case 'update_blocks':
        return this.updateBlocks(a, caller)
      case 'delete_blocks':
        return this.deleteBlocks(a, caller)
      case 'connect':
        return this.connect(a, caller)
      case 'update_connectors':
        return this.updateConnectors(a, caller)
      case 'add_image':
        return this.addImage(a, caller)
      case 'group_into_frame':
        return this.groupIntoFrame(a, caller)
      case 'arrange':
        return this.arrange(a, caller)
      case 'tidy':
        return this.tidy(a, caller)
      case 'lint_layout':
        return this.lint(a, caller)
      case 'render_snapshot':
        return this.snapshot(a, caller)
      case 'set_status': {
        const b = this.board(a.board)
        this.presence.touch(caller, { boardId: b.id, status: a.status })
        return { ok: true }
      }
      case 'begin_change_set':
        return this.beginChangeSet(a, caller)
      case 'commit_change_set':
        return this.commitChangeSet(a, caller)
      case 'list_change_sets':
        return this.listChangeSets(a)
      case 'review_change_set':
        return this.review(a, caller)
      case 'undo_changes':
        return this.undoChanges(a, caller)
      case 'report_layout':
        return this.reportLayout(a)
      case 'list_types':
        return this.listTypes()
      case 'create_snippet':
        return this.createSnippet(a, caller)
      case 'update_snippet':
        return this.updateSnippet(a, caller)
      case 'report_snippet_thumb':
        return this.reportSnippetThumb(a)
      case 'set_type':
        return this.setType(a, caller)
      case 'query_blocks':
        return this.queryBlocks(a, caller)
      case 'get_threads': {
        const board = this.board(a.board)
        this.presence.touch(caller, { boardId: board.id, autoStatus: 'Reading comments…' })
        const threads = [...board.threads.values()].filter((t) => a.include_resolved || !t.resolved).sort((p, q) => p.createdAt - q.createdAt)
        return {
          board: board.id,
          threads: threads.map((t) => {
            const b = board.blocks.get(t.target)
            return {
              id: t.id,
              on: b ? { id: b.id, kind: b.kind, title: b.title, text: b.text } : null,
              author: t.author.name,
              text: t.text,
              resolved: t.resolved,
              replies: t.replies.map((r) => ({ author: r.author.name, text: r.text })),
            }
          }),
        }
      }
      case 'reply_thread':
      case 'resolve_thread': {
        const board = this.board(a.board)
        const t = board.threads.get(a.thread)
        if (!t) throw new ToolError(`No comment thread "${a.thread}"`)
        const author = this.author(caller)
        const next: Thread = tool === 'reply_thread' ? { ...t, replies: [...t.replies, { id: newId(), author, text: a.text, createdAt: Date.now() }] } : { ...t, resolved: true, resolvedAt: Date.now() }
        board.doc.transact(() => board.threads.set(t.id, next), 'api')
        const target = board.blocks.get(t.target)
        if (target) {
          const r = board.pageRect(target)
          this.presence.touch(caller, { boardId: board.id, cursor: { x: r.x + r.w - 8, y: r.y + 8 }, focus: r, autoStatus: tool === 'reply_thread' ? 'Replying to a comment…' : 'Resolved a comment' })
        }
        return { thread: t.id, resolved: next.resolved, replies: next.replies.length }
      }
      case 'export_board':
        return this.exportBoard(a)
      case 'get_design_tokens':
        return tokenManifest()
      case 'list_versions':
        return this.listVersions(a)
      case 'create_version': {
        const b = this.board(a.board)
        return { board: b.id, version: this.registry.safety.snapshot(b, 'checkpoint', a.name.trim(), caller.name) }
      }
      case 'restore_version':
        return this.restoreVersion(a, caller)
      case 'prepare_restore':
        return this.restoreVersion({ ...a, prepare: true }, caller)
      case 'get_version':
        return this.getVersion(a, caller)
      case 'delete_version': {
        const b = this.board(a.board)
        deleteVersion(b.id, a.version)
        return { board: b.id, deleted: a.version }
      }
      case 'get_notices':
        return { notices: this.registry.notices.list(a.board), backupFolder: backupRoot() }
      case 'dismiss_notice':
        return { dismissed: this.registry.notices.dismiss(a.id) }
      case 'open_backup_folder':
        return this.openBackupFolder(a)
    }
  }

  // ---- versions & backups -------------------------------------------------

  private listVersions(a: Args) {
    const board = this.board(a.board)
    const versions = listVersions(board.id).slice(0, a.limit ?? 50)
    return { board: board.id, count: versions.length, versions: versions.map((v) => ({ ...v, createdAtIso: new Date(v.createdAt).toISOString() })) }
  }

  /** A version as a detached, read-only board. */
  private versionBoard(board: Board, id: string) {
    try {
      const v = readVersion(board.id, id)
      return { info: v.info, board: Board.fromBytes(board.id, v.payload, v.file, { persist: false }).board }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof CorruptFileError) {
        const known = listVersions(board.id).slice(0, 5).map((v) => v.id)
        throw new ToolError(e instanceof CorruptFileError && (e as CorruptFileError).reason.includes('checksum') ? `Version "${id}" is damaged and can't be restored.` : `No version "${id}" on "${board.title}".${known.length ? ` Recent: ${known.join(', ')}` : ''}`)
      }
      if (e instanceof FutureVersionError) throw new ToolError(e.message)
      throw e
    }
  }

  async versionPreview(boardRef: string, id: string, theme: 'light' | 'dark') {
    const board = this.registry.get(boardRef)
    if (!board) return null
    try {
      const { board: vb } = this.versionBoard(board, id)
      return (await renderSnapshot(vb, { theme, format: 'svg' })).svg
    } catch {
      return null
    }
  }

  private getVersion(a: Args, _caller: CallerInfo) {
    const board = this.board(a.board)
    const { info, board: vb } = this.versionBoard(board, a.version)
    return {
      board: board.id,
      version: info,
      /** What restoring would do to the current board. */
      diff: diffBlocks(board.blocks.values(), vb.blocks.values()),
      blocks: [...vb.blocks.values()],
      connectors: [...vb.connectors.values()],
    }
  }

  private copyMissingAssets(board: Board, from: Board) {
    for (const [id, asset] of from.assets) if (!board.assets.has(id)) board.assets.set(id, asset)
  }

  /**
   * Restore a version: checkpoint the current state, then write the difference as ordinary edits — direct
   * for people, a reviewable change set for agents — so it can be undone like any other change. `prepare`
   * (the canvas) only checkpoints and returns the plan; the canvas applies it itself so ⌘Z undoes it.
   */
  private restoreVersion(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const { info, board: vb } = this.versionBoard(board, a.version)
    const label = info.name || new Date(info.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    const plan = planRestore({ blocks: board.blocks.values(), connectors: board.connectors.values() }, { blocks: vb.blocks.values(), connectors: vb.connectors.values() })
    const summary = diffBlocks(board.blocks.values(), vb.blocks.values())
    if (isEmptyPlan(plan)) return { board: board.id, restored: info.id, unchanged: true, summary, changeSet: null, checkpoint: null }
    board.saveNow()
    const checkpoint = this.registry.safety.snapshot(board, 'before-restore', `Before restoring “${label}”`, caller.name)
    board.doc.transact(() => this.copyMissingAssets(board, vb), 'api')
    if (a.prepare && caller.kind === 'human') return { board: board.id, restored: info.id, checkpoint: checkpoint.id, summary, plan }
    const { changeSet } = this.edit(board, caller, a.intent, `Restore version “${label}”`, (rec) => {
      for (const b of plan.upsertBlocks) rec.restoreBlock(b)
      for (const id of plan.deleteBlocks) rec.deleteBlock(id)
      for (const c of plan.upsertConnectors) rec.restoreConnector(c)
      for (const id of plan.deleteConnectors) rec.deleteConnector(id)
    })
    return {
      board: board.id,
      restored: info.id,
      checkpoint: checkpoint.id,
      summary,
      changeSet,
      note: changeSet ? 'The restore is waiting for review in the canvas.' : `Restored. To go back, restore version ${checkpoint.id}.`,
    }
  }

  private async openBackupFolder(a: Args) {
    const board = a.board ? this.board(a.board) : null
    const dir = board ? boardBackupDir(board.id, board.title) : backupRoot()
    const target = fs.existsSync(dir) ? dir : backupRoot()
    fs.mkdirSync(target, { recursive: true })
    if (a.reveal === false) return { path: target, opened: false }
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
    const opened = await new Promise<boolean>((resolve) => {
      try {
        const p = spawn(cmd, [target], { detached: true, stdio: 'ignore' })
        p.once('error', () => resolve(false))
        p.once('spawn', () => {
          p.unref()
          resolve(true)
        })
      } catch {
        resolve(false)
      }
    })
    return { path: target, opened }
  }

  // ---- helpers ------------------------------------------------------------

  /**
   * Resolve a board. Explicit refs win. Without one: the board this session last used (stable within a
   * session), else the board open in the canvas — with a warning whenever that choice isn't clear-cut.
   */
  board(ref?: string): Board {
    const ctx = callContext.getStore()
    const session = ctx && ctx.caller.id !== 'human:ui' ? ctx.caller.id : null
    const remember = (b: Board) => {
      if (session) this.sessionBoards.set(session, b.id)
      return b
    }
    if (ref) {
      const b = this.registry.find(ref)
      if (!b) throw new ToolError(`No board "${ref}". Boards: ${this.registry.all().map((b) => `"${b.title}" (${b.id})`).join(', ')}`)
      return remember(b)
    }
    const last = session ? this.sessionBoards.get(session) : undefined
    const lastBoard = last ? this.registry.get(last) : undefined
    if (lastBoard) return lastBoard
    const recent = [...this.canvases.values()].filter((c) => Date.now() - c.at < 120_000)
    const openBoards = new Set(recent.map((c) => c.boardId))
    const active = this.activeBoardId ? this.registry.get(this.activeBoardId) : undefined
    const b = active ?? this.registry.all()[0]
    if (!b) throw new ToolError('There are no boards yet. Call create_board first.')
    if (!active) warn(`No \`board\` given and no board is active in the canvas — used "${b.title}" (${b.id}). Pass \`board\` explicitly.`)
    else if (openBoards.size > 1) warn(`No \`board\` given and ${openBoards.size} boards are open in the canvas — used "${b.title}" (${b.id}), the one last focused. Pass \`board\` explicitly.`)
    else if (!openBoards.size) warn(`No \`board\` given and no canvas is open — used "${b.title}" (${b.id}), the board last active. Pass \`board\` explicitly.`)
    return remember(b)
  }

  private frame(board: Board, ref: string) {
    const f = board.resolve(ref, ['frame'])
    if (!f) {
      const frames = board.childrenOf(null).filter((b) => b.kind === 'frame')
      throw new ToolError(`No frame "${ref}" on this board. Frames: ${frames.length ? frames.map((f) => `"${f.title}" (${f.id})`).join(', ') : 'none'}`)
    }
    return f
  }

  private author(caller: CallerInfo): Author {
    if (caller.kind === 'human') return { kind: 'human', id: caller.id, name: caller.name }
    const id = identify(caller)
    return { kind: 'agent', id: caller.id, name: id.name, color: this.presence.colorFor(caller), client: caller.client }
  }

  /** Run edits inside one Yjs transaction, grouped into a change set for agents. */
  private edit<T>(board: Board, caller: CallerInfo, intent: string | undefined, fallbackIntent: string, fn: (r: Recorder) => T) {
    const author = this.author(caller)
    let cs: ChangeSet | null = null
    let isNew = false
    if (caller.kind === 'agent') {
      const openId = this.openChangeSets.get(`${caller.id}:${board.id}`)
      const open = openId ? board.changeSets.get(openId) : undefined
      if (open && open.status === 'open') cs = { ...open, entries: [...open.entries] }
      else {
        const now = Date.now()
        cs = { id: `cs${newId()}`, author, intent: intent || fallbackIntent, status: 'pending', entries: [], createdAt: now, updatedAt: now }
        isNew = true
      }
    }
    const rec = new Recorder(board, author, cs)
    let result!: T
    board.doc.transact(() => {
      result = fn(rec)
      if (cs && rec.entries.length) {
        cs.entries.push(...rec.entries)
        cs.updatedAt = Date.now()
        board.changeSets.set(cs.id, cs)
      }
      board.touch()
    }, 'api')
    if (caller.kind === 'agent') {
      const rects = [...rec.touched].map((id) => board.blocks.get(id)).filter(Boolean).map((b) => board.pageRect(b!))
      const focus = rects.length ? bboxOf(rects) : null
      const last = rects[rects.length - 1]
      this.presence.touch(caller, {
        boardId: board.id,
        focus,
        cursor: last ? { x: last.x + last.w * 0.7, y: last.y + last.h * 0.75 } : undefined,
        autoStatus: intent || fallbackIntent,
      })
    }
    return { result, changeSet: cs && (rec.entries.length || !isNew) ? cs.id : null }
  }

  private fitFrame(rec: Recorder, board: Board, frameId: string, shrink = false) {
    const f = board.blocks.get(frameId)
    if (!f) return
    const kids = board.childrenOf(frameId)
    if (!kids.length) return
    const right = Math.max(...kids.map((k) => k.x + k.w)) + PAD
    const bottom = Math.max(...kids.map((k) => k.y + k.h)) + PAD
    const w = snap(shrink ? Math.max(right, 240) : Math.max(f.w, right))
    const h = snap(shrink ? Math.max(bottom, 160) : Math.max(f.h, bottom))
    if (w !== f.w || h !== f.h) rec.updateBlock(frameId, { w, h })
  }

  /** Make room: when a block grows, push the siblings stacked below it down by the same amount. */
  private makeRoom(board: Board, cur: Block, w: number, grow: number, skip: Set<string>, move: (id: string, y: number) => void) {
    if (grow === 0) return
    for (const s of board.childrenOf(cur.parent ?? null)) {
      if (s.id === cur.id || skip.has(s.id) || s.kind === 'frame') continue
      if (s.y >= cur.y + cur.h - 1 && s.x < cur.x + w && s.x + s.w > cur.x) move(s.id, Math.ceil((s.y + grow) / 8) * 8)
    }
  }

  /**
   * The canvas measures real rendered content (fonts, wrapping, lists, code) and reports it here, so layout,
   * make-room and lint use true heights. Not an edit: no change set, no author, not undoable.
   */
  private reportLayout(a: Args) {
    const board = this.board(a.board)
    const updated: string[] = []
    const frames = new Set<string>()
    const shrinkFrames = new Set<string>()
    board.doc.transact(() => {
      for (const it of a.items as { id: string; content_h?: number; expanded?: boolean }[]) {
        const cur = board.blocks.get(it.id)
        if (!cur || !['card', 'sticky', 'text'].includes(cur.kind)) continue
        const expanded = it.expanded ?? cur.expanded ?? false
        const contentH = it.content_h != null ? Math.round(it.content_h) : cur.contentH
        const h = contentH != null ? fitHeight(cur.kind, cur.w, contentH, expanded) : cur.h
        if (h === cur.h && contentH === cur.contentH && expanded === !!cur.expanded) continue
        board.blocks.set(cur.id, { ...cur, h, contentH, expanded: expanded || undefined })
        // growing always makes room; only an explicit collapse gives the space back (measurement jitter never pulls blocks up)
        const delta = h - cur.h
        const collapsing = it.expanded === false && !!cur.expanded
        if (collapsing && cur.parent) shrinkFrames.add(cur.parent)
        if (delta > 0 || collapsing) {
          this.makeRoom(board, cur, cur.w, delta, new Set(updated), (id, y) => board.blocks.set(id, { ...board.blocks.get(id)!, y }))
        }
        updated.push(cur.id)
        if (cur.parent) frames.add(cur.parent)
      }
      for (const fid of frames) {
        const f = board.blocks.get(fid)
        const kids = board.childrenOf(fid)
        if (!f || !kids.length) continue
        const w = snap(Math.max(f.w, Math.max(...kids.map((k) => k.x + k.w)) + PAD))
        const bottom = Math.max(...kids.map((k) => k.y + k.h)) + PAD
        const h = snap(shrinkFrames.has(fid) ? Math.max(bottom, 160) : Math.max(f.h, bottom))
        if (w !== f.w || h !== f.h) board.blocks.set(fid, { ...f, w, h })
      }
      if (updated.length) board.touch()
    }, 'layout')
    return { board: board.id, updated }
  }

  // ---- web snippets --------------------------------------------------------

  private snippetFrom(a: Args, base?: WebSnippet): WebSnippet {
    const hasInline = a.html !== undefined || a.css !== undefined || a.js !== undefined
    if (a.url && hasInline) throw new ToolError('Pass either `url` or `html`/`css`/`js`, not both')
    let web: WebSnippet
    if (a.url !== undefined) {
      const n = normalizeEmbedUrl(String(a.url))
      if ('error' in n) throw new ToolError(n.error)
      web = { mode: 'url', url: String(a.url), embedUrl: n.embedUrl, provider: n.provider, posterUrl: n.thumbUrl, title: a.title ?? base?.title ?? n.title, state: base?.state, thumb: base?.thumb, thumbFor: base?.thumbFor }
    } else if (hasInline || base?.mode === 'inline') {
      web = { ...(base?.mode === 'inline' ? base : {}), mode: 'inline', html: a.html ?? base?.html ?? '', css: a.css ?? base?.css ?? '', js: a.js ?? base?.js ?? '', title: a.title ?? base?.title }
      if (snippetSourceBytes(web) > SNIPPET_LIMITS.sourceBytes) throw new ToolError(`Snippet source is over ${SNIPPET_LIMITS.sourceBytes / 1024} KB`)
      if (!`${web.html}${web.js}`.trim()) throw new ToolError('An inline snippet needs some html or js')
      const js = checkSnippetJs(web.js ?? '')
      if (js.mode === 'error') throw new ToolError(`${js.error}. Nothing was saved.`)
      if (js.mode === 'async') warn('Top-level `await` found: the script runs inside an async function, so its top-level declarations are not globals — attach handlers with addEventListener rather than inline on*="…" attributes.')
      if (!web.title) {
        const heading = (web.html ?? '').match(/<(h[1-3]|title)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2]?.replace(/<[^>]+>/g, '').trim()
        if (heading) web.title = heading.slice(0, 80)
      }
    } else if (base) web = { ...base, title: a.title ?? base.title }
    else throw new ToolError('Pass `url` (https) or an inline `html` / `css` / `js` snippet')
    return web
  }

  private async posterFor(board: Board, web: WebSnippet) {
    if (!web.posterUrl || (web.thumb && web.thumbFor === snippetHash(web))) return web
    try {
      const r = await fetch(web.posterUrl, { signal: AbortSignal.timeout(4000) })
      if (!r.ok) return web
      const bytes = new Uint8Array(await r.arrayBuffer())
      const info = imageInfo(bytes)
      if (!info || bytes.byteLength > SNIPPET_LIMITS.thumbBytes) return web
      const id = `a${newId()}`
      board.doc.transact(() => board.assets.set(id, { id, mime: info.mime, w: info.w, h: info.h, bytes, name: 'poster', createdAt: Date.now() }), 'api')
      return { ...web, thumb: id, thumbFor: snippetHash(web) }
    } catch {
      return web
    }
  }

  private async createSnippet(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    let web = this.snippetFrom(a)
    web = await this.posterFor(board, web)
    const video = web.mode === 'url' && /YouTube|Vimeo|Loom/.test(web.provider ?? '')
    const w = snap(Math.min(Math.max(a.width ?? 480, 160), 1600))
    const h = snap(Math.min(Math.max(a.height ?? (video ? Math.round((w * 9) / 16) : 320), 120), 1200))
    const r = await this.createBlocks({ ...a, blocks: [{ kind: 'web', w, h, web, text: web.title ?? '' }], intent: a.intent ?? `Add ${web.mode === 'url' ? `a ${web.provider} embed` : 'a web snippet'}` }, caller)
    return { ...r, id: r.created?.find((c: { kind: string }) => c.kind === 'web')?.id, mode: web.mode, embedUrl: web.embedUrl }
  }

  private async updateSnippet(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const cur = board.blocks.get(a.id) ?? board.resolve(a.id)
    if (!cur || cur.kind !== 'web' || !cur.web) throw new ToolError(`No web snippet "${a.id}"`)
    let web = this.snippetFrom(a, cur.web)
    web = await this.posterFor(board, web)
    const { changeSet } = this.edit(board, caller, a.intent, `Update snippet “${preview(web.title ?? '', 30)}”`, (rec) => {
      rec.updateBlock(cur.id, { web, text: web.title ?? '' })
    })
    const before = cur.web
    const lines = (v?: string) => (v ?? '').split('\n')
    const changed: Record<string, string> = {}
    for (const k of ['url', 'title', 'html', 'css', 'js'] as const) {
      if ((before[k] ?? '') === (web[k] ?? '')) continue
      if (k === 'url' || k === 'title') changed[k] = `${before[k] ?? '—'} → ${web[k] ?? '—'}`
      else {
        const a0 = new Set(lines(before[k]))
        const b0 = new Set(lines(web[k]))
        changed[k] = `+${lines(web[k]).filter((l) => !a0.has(l)).length} / −${lines(before[k]).filter((l) => !b0.has(l)).length} lines`
      }
    }
    if (!Object.keys(changed).length) warn('Nothing changed — the snippet already had this source.')
    return { board: board.id, changeSet, id: cur.id, mode: web.mode, changed }
  }

  /** The canvas captured a preview inside the sandbox; store it. Not an edit (no change set, not undoable). */
  private reportSnippetThumb(a: Args) {
    const board = this.board(a.board)
    const cur = board.blocks.get(a.id)
    if (!cur?.web) throw new ToolError('No such snippet')
    if (snippetThumbKey(cur.web) !== a.hash) return { stale: true }
    const bytes = new Uint8Array(Buffer.from(String(a.png).replace(/^data:image\/png;base64,/, ''), 'base64'))
    const info = imageInfo(bytes)
    if (!info || info.mime !== 'image/png' || bytes.byteLength > SNIPPET_LIMITS.thumbBytes) throw new ToolError('Preview must be a PNG under 1.5 MB')
    const id = `a${newId()}`
    board.doc.transact(() => {
      board.assets.set(id, { id, mime: 'image/png', w: info.w, h: info.h, bytes, name: 'snippet-preview.png', createdAt: Date.now() })
      const now = board.blocks.get(cur.id)!
      board.blocks.set(cur.id, { ...now, web: { ...now.web!, thumb: id, thumbFor: a.hash } })
    }, 'layout')
    return { board: board.id, thumb: id }
  }

  // ---- block types ---------------------------------------------------------

  private listTypes() {
    const relations: { from: BlockTypeId; to: BlockTypeId; relation: string }[] = []
    for (const f of BLOCK_TYPE_IDS) for (const t of BLOCK_TYPE_IDS) {
      const r = suggestRelation(f, t)
      if (r) relations.push({ from: f, to: t, relation: r })
    }
    return {
      types: BLOCK_TYPE_IDS.map((id) => {
        const d = BLOCK_TYPES[id]
        return { id, label: d.label, description: d.description, color: d.color, prefixes: d.prefixes, fields: d.fields }
      }),
      relations,
      note: 'Types are optional. Promote with set_type (or create_blocks `type`), demote with type "none" — field values are kept. At most a few fields per type; deeper schemas belong to Skills.',
    }
  }

  private heightFor(b: Block) {
    const extra = typeChrome(b)
    if (b.kind === 'sticky') return fitHeight('sticky', b.w, stickyContentHeight(b.text, b.w, extra), b.expanded)
    if (b.kind === 'card') return fitHeight('card', b.w, cardContentHeight(b.title ?? '', b.text, b.w, extra), b.expanded)
    return b.h
  }

  private setType(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const type: BlockTypeId | null | undefined = a.type === 'none' ? null : a.type
    const blocks = (a.ids as string[]).map((id) => {
      const b = board.blocks.get(id) ?? board.resolve(id)
      if (!b) throw new ToolError(`No block "${id}"`)
      if (b.kind !== 'sticky' && b.kind !== 'card') throw new ToolError(`Only stickies and cards can have a type ("${preview(b.text || b.title, 30)}" is a ${b.kind})`)
      if (type === undefined && !b.type) throw new ToolError(`"${preview(b.text || b.title, 30)}" has no type yet — pass \`type\` to promote it`)
      return b
    })
    let fields: Record<string, FieldValue> = {}
    if (a.fields && Object.keys(a.fields).length) {
      const t = type ?? blocks[0].type
      if (!t) throw new ToolError('Fields need a type')
      if (blocks.some((b) => (type ?? b.type) !== t)) throw new ToolError('Setting fields on blocks of different types — call set_type once per type')
      const r = coerceFields(t, a.fields)
      if (r.errors.length) throw new ToolError(r.errors[0])
      fields = r.fields
    }
    const label = type === null ? 'Make plain' : type ? `Mark as ${BLOCK_TYPES[type].label.toLowerCase()}` : 'Update fields'
    const { changeSet } = this.edit(board, caller, a.intent, `${label} (${blocks.length})`, (rec) => {
      const frames = new Set<string>()
      for (const b of blocks) {
        const patch = typePatch(b, type, fields)
        if (!Object.keys(patch).length) continue
        const next = { ...b, ...patch } as Block
        const h = this.heightFor(next)
        rec.updateBlock(b.id, { ...patch, h, contentH: undefined })
        this.makeRoom(board, b, b.w, h - b.h, new Set(blocks.map((x) => x.id)), (id, y) => rec.updateBlock(id, { y }))
        if (b.parent) frames.add(b.parent)
      }
      for (const f of frames) this.fitFrame(rec, board, f)
    })
    return { board: board.id, changeSet, updated: blocks.map((b) => ({ id: b.id, type: type === null ? null : (type ?? b.type), fields: typeFields({ ...b, ...typePatch(b, type, fields) } as Block) })) }
  }

  private queryBlocks(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    this.presence.touch(caller, { boardId: board.id, autoStatus: 'Looking through the board…' })
    const frame = a.frame ? this.frame(board, a.frame) : null
    const type = a.type === 'none' ? null : isBlockType(a.type) ? a.type : undefined
    if (a.where && Object.keys(a.where).length && type) {
      const { errors } = coerceFields(type, a.where)
      if (errors.length) throw new ToolError(errors[0])
    }
    const hits = [...board.blocks.values()]
      .filter((b) => (b.kind === 'sticky' || b.kind === 'card') && (!frame || b.parent === frame.id) && matchesQuery(b, { type, where: a.where }))
      .sort((p, q) => (p.parent ?? '').localeCompare(q.parent ?? '') || p.y - q.y || p.x - q.x)
    return {
      board: board.id,
      count: hits.length,
      blocks: hits.map((b) => ({
        id: b.id,
        kind: b.kind,
        type: b.type ?? null,
        text: b.kind === 'card' ? `${b.title ?? ''}${b.text ? ` — ${b.text}` : ''}` : b.text,
        fields: typeFields(b),
        frame: b.parent ? (board.blocks.get(b.parent)?.title ?? null) : null,
      })),
    }
  }

  private siblingsRects(board: Board, parent: string | null, exclude: Set<string> = new Set()) {
    return board
      .childrenOf(parent)
      .filter((b) => !exclude.has(b.id))
      .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
  }

  // ---- reads -------------------------------------------------------------

  private getBoard(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    this.presence.touch(caller, { boardId: board.id, autoStatus: 'Reading the board…' })
    const frameFilter = a.frame ? this.frame(board, a.frame) : null
    const all = [...board.blocks.values()]
    const frames = all.filter((b) => b.kind === 'frame' && (!frameFilter || b.id === frameFilter.id))
    const loose = frameFilter ? [] : all.filter((b) => !b.parent && b.kind !== 'frame')
    const conns = [...board.connectors.values()]
    const pending = [...board.changeSets.values()].filter((c) => c.status === 'pending' || c.status === 'open')
    if (a.format === 'json') {
      return {
        board: board.summary(),
        frames: frames.map((f) => ({ ...f, children: board.childrenOf(f.id) })),
        blocks: loose,
        connectors: conns,
        pendingChangeSets: pending.map((c) => ({ id: c.id, author: c.author.name, intent: c.intent, entries: c.entries.length })),
      }
    }
    const line = (b: Block) => {
      const body =
        b.kind === 'card'
          ? `**${preview(b.title, 60)}** — ${preview(b.text, 100)}`
          : b.kind === 'web' && b.web
            ? `"${preview(b.web.title ?? '', 60)}" (${b.web.mode === 'url' ? `embed ${b.web.url}` : `inline snippet, ${snippetSourceBytes(b.web)} bytes`})`
            : `"${preview(b.text, 100)}"`
      const collapsed = b.contentH != null && b.contentH > b.h + 4 && b.h >= maxBlockHeight(b.kind, b.w, b.expanded) - 8
      const flags = [b.kind === 'image' ? '' : b.color, b.size !== 'm' && b.kind !== 'image' ? `size ${b.size}` : '', b.rotation ? `rotated ${b.rotation}°` : '', b.pending ? 'pending review' : '', collapsed ? `long: collapsed, full height ${b.contentH}px` : ''].filter(Boolean).join(', ')
      const typed = b.type ? ` <${b.type}${fieldSummary(b) ? `: ${fieldSummary(b)}` : ''}>` : ''
      return `- ${b.kind}${typed} ${body} [${flags}] (id: ${b.id}, ${b.x},${b.y} ${b.w}×${b.h})`
    }
    const out: string[] = []
    out.push(`# ${board.title} (board id: ${board.id})`)
    out.push(`${all.length} blocks · ${conns.length} connectors · ${pending.length} change sets awaiting review`)
    if (!all.length) out.push('\nThe board is empty. Use create_blocks with a layout intent (and `frame` to title a section).')
    for (const f of frames) {
      const kids = board.childrenOf(f.id).sort((p, q) => p.y - q.y || p.x - q.x)
      out.push(`\n## Frame "${f.title}" (id: ${f.id}, ${f.x},${f.y} ${f.w}×${f.h}) — ${kids.length} blocks`)
      out.push(...kids.map(line))
    }
    if (loose.length) {
      out.push('\n## Outside frames')
      out.push(...loose.sort((p, q) => p.y - q.y || p.x - q.x).map(line))
    }
    const relevant = frameFilter ? conns.filter((c) => [c.from, c.to].some((id) => id && board.blocks.get(id)?.parent === frameFilter.id)) : conns
    if (relevant.length) {
      out.push('\n## Connectors')
      for (const c of relevant) {
        const name = (id?: string | null) => {
          const b = id ? board.blocks.get(id) : undefined
          return b ? `"${preview(b.kind === 'card' || b.kind === 'frame' ? b.title : b.text, 32)}"` : '(free end)'
        }
        out.push(`- ${name(c.from)} → ${name(c.to)}${c.label ? ` "${c.label}"` : ''} [${c.route ?? 'curved'}] (id: ${c.id})`)
      }
    }
    return { markdown: out.join('\n') }
  }

  // ---- create ------------------------------------------------------------

  private createBlocks(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const intentLayout: LayoutIntent = a.layout ?? (a.blocks.some((b: Args) => b.parent) ? 'tree' : a.blocks.some((b: Args) => b.group) ? 'cluster' : 'grid')

    interface Draft {
      key: string
      ref?: string
      kind: Block['kind']
      text: string
      title?: string
      color: ColorToken
      size: SizeToken
      w: number
      h: number
      group?: string
      parentRef?: string
      asset?: string
      type?: BlockTypeId
      fields?: Record<string, FieldValue>
      extra: number
      web?: WebSnippet
    }
    const drafts: Draft[] = a.blocks.map((b: Args, i: number) => {
      const kind: Block['kind'] = b.kind ?? 'sticky'
      const size = toSizeToken(b.size, 'm')
      const color = colorFor(b.color, kind === 'sticky' ? 'yellow' : kind === 'card' ? 'blue' : 'gray')
      const text = String(b.text ?? '')
      const title = b.title != null ? String(b.title) : undefined
      const type = isBlockType(b.type) && (kind === 'sticky' || kind === 'card') ? b.type : undefined
      let fields: Record<string, FieldValue> | undefined
      if (type) {
        const r = coerceFields(type, b.fields ?? {})
        if (r.errors.length) throw new ToolError(r.errors[0])
        fields = r.fields
      }
      if (type && b.color !== undefined && colorFor(b.color, color) !== BLOCK_TYPES[type].color) warn(`\`color\` is ignored for typed blocks — a ${BLOCK_TYPES[type].label.toLowerCase()} is always ${BLOCK_TYPES[type].color}.`)
      const extra = type ? typeChrome({ type, typeData: { [type]: fields } }) : 0
      let dims: { w: number; h: number; size?: SizeToken }
      if (kind === 'sticky') dims = measureSticky(text, size, false, extra)
      else if (kind === 'image' || kind === 'web') dims = { w: b.w, h: b.h }
      else if (kind === 'card') dims = measureCard(title ?? '', text, size, false, extra)
      else dims = measureBlock({ kind, text, title, size, w: 0, h: 0 })
      return { key: `k${i}`, ref: b.ref, kind, text, title, color: type ? BLOCK_TYPES[type].color : color, size: dims.size ?? size, w: dims.w, h: dims.h, group: b.group, parentRef: b.parent, asset: b.asset as string | undefined, type, fields, extra, web: kind === 'web' ? (b.web as WebSnippet) : undefined }
    })
    // same kind in one batch → same size
    const stickies = drafts.filter((d) => d.kind === 'sticky')
    if (stickies.length > 1) {
      const side = Math.max(...stickies.map((d) => d.w))
      const sz = stickies.find((d) => d.w === side)!.size
      const h = Math.max(...stickies.map((d) => fitHeight('sticky', side, stickyContentHeight(d.text, side, d.extra))))
      for (const d of stickies) Object.assign(d, { w: side, h, size: sz })
    }
    const cards = drafts.filter((d) => d.kind === 'card')
    if (cards.length > 1) {
      const w = Math.max(...cards.map((d) => d.w))
      for (const d of cards) d.w = w
    }

    const refToKey = new Map(drafts.filter((d) => d.ref).map((d) => [d.ref!, d.key]))
    const items: LayoutItem[] = drafts.map((d) => ({
      key: d.key,
      kind: d.kind,
      w: d.w,
      h: d.h,
      group: d.group,
      parentKey: d.parentRef ? refToKey.get(d.parentRef) : undefined,
    }))
    const headingSize = (g: string) => measureBlock({ kind: 'text', text: g, size: 'l', w: 0, h: 0 })
    const res = layout(items, intentLayout, { columns: a.columns, direction: a.direction, headingSize })

    const rects: Rect[] = [...res.placed.values()]
    for (const hd of res.headings) rects.push({ x: hd.x, y: hd.y, ...headingSize(hd.group) })
    const bb = bboxOf(rects)
    const content = { w: bb.w, h: bb.h }

    const inside = a.inside ? this.frame(board, a.inside) : null
    if (inside && a.at) warn('`at` is ignored together with `inside`: blocks go below the frame\'s existing content. Drop `inside` to place at exact coordinates.')
    if (inside && a.frame) warn('`frame` is ignored together with `inside` (frames can\'t be nested).')
    const wrapTitle: string | undefined = inside ? undefined : a.frame
    const groupSize = wrapTitle ? { w: snap(content.w + PAD * 2), h: snap(content.h + PAD * 2) } : content

    // origin of the group in its parent's space
    let parent: string | null = inside?.id ?? null
    let origin: { x: number; y: number }
    const anchorRef = a.right_of ?? a.below
    if (inside) {
      const kids = board.childrenOf(inside.id)
      origin = { x: PAD, y: kids.length ? snap(Math.max(...kids.map((k) => k.y + k.h)) + GAP) : PAD }
    } else if (a.at) {
      const notes: string[] = []
      origin = { x: snapNoted(a.at.x, notes, 'at.x'), y: snapNoted(a.at.y, notes, 'at.y') }
      reportSnapped(notes)
    } else if (anchorRef) {
      const anchor = board.resolve(anchorRef)
      if (!anchor) throw new ToolError(`No block "${anchorRef}" to place next to.`)
      parent = anchor.parent ?? null
      const gap = anchor.kind === 'frame' || wrapTitle ? CLUSTER_GAP : GAP
      origin = a.right_of ? { x: anchor.x + anchor.w + gap, y: anchor.y } : { x: anchor.x, y: anchor.y + anchor.h + gap }
      const others = this.siblingsRects(board, parent, new Set([anchor.id]))
      for (let i = 0; i < 200; i++) {
        const cand = { ...origin, ...groupSize }
        if (!others.some((o) => intersects(cand, o, GAP - 1))) break
        if (a.right_of) origin.y += 32
        else origin.x += 32
      }
      origin = { x: snap(origin.x), y: snap(origin.y) }
    } else {
      const occupied = board.childrenOf(null).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
      origin = findFreeSpot(occupied, groupSize, this.viewports.get(board.id)?.rect ?? null)
    }

    const created: { id: string; ref?: string; kind: string; label: string }[] = []
    const { result, changeSet } = this.edit(board, caller, a.intent, `Add ${drafts.length} ${drafts.length === 1 ? drafts[0].kind : 'blocks'}`, (rec) => {
      let frameId: string | null = null
      let offset = { x: origin.x - bb.x, y: origin.y - bb.y }
      if (wrapTitle) {
        const f = rec.createBlock({ id: newId(), kind: 'frame', x: origin.x, y: origin.y, w: groupSize.w, h: groupSize.h, parent: null, text: '', title: wrapTitle, color: 'gray', size: 'm' })
        frameId = f.id
        parent = f.id
        offset = { x: PAD - bb.x, y: PAD - bb.y }
        created.push({ id: f.id, kind: 'frame', label: wrapTitle })
      }
      for (const hd of res.headings) {
        const s = headingSize(hd.group)
        const t = rec.createBlock({ id: newId(), kind: 'text', x: snap(hd.x + offset.x), y: snap(hd.y + offset.y), w: s.w, h: s.h, parent, text: hd.group, color: 'gray', size: 'l' })
        created.push({ id: t.id, kind: 'text', label: hd.group })
      }
      const keyToId = new Map<string, string>()
      for (const d of drafts) {
        const p = res.placed.get(d.key)!
        const b = rec.createBlock({ id: newId(), kind: d.kind, x: snap(p.x + offset.x), y: snap(p.y + offset.y), w: p.w, h: p.h, parent, text: d.text, title: d.title, color: d.color, size: d.size, ...(d.asset ? { asset: d.asset } : {}), ...(d.type ? { type: d.type, typeData: { [d.type]: d.fields ?? {} } } : {}), ...(d.web ? { web: d.web } : {}) })
        keyToId.set(d.key, b.id)
        created.push({ id: b.id, ref: d.ref, kind: d.kind, label: preview(d.kind === 'card' ? d.title : d.text, 40) })
      }
      const conns: string[] = []
      for (const [from, to] of res.edges) {
        conns.push(rec.createConnector({ id: newId(), from: keyToId.get(from)!, to: keyToId.get(to)! }).id)
      }
      // tree roots that reference existing blocks
      for (const d of drafts) {
        if (d.parentRef && !refToKey.has(d.parentRef)) {
          const existing = board.resolve(d.parentRef)
          if (existing) conns.push(rec.createConnector({ id: newId(), from: existing.id, to: keyToId.get(d.key)! }).id)
        }
      }
      if (inside) this.fitFrame(rec, board, inside.id)
      return { frameId, connectors: conns }
    })

    return {
      board: board.id,
      changeSet,
      frame: result.frameId,
      created,
      connectors: result.connectors,
      next: 'Changes are live on the canvas and await human review. Use render_snapshot or lint_layout to check the result.',
    }
  }

  // ---- update / delete ---------------------------------------------------

  private updateBlocks(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    for (const u of a.updates) if (!board.blocks.get(u.id)) throw new ToolError(`No block with id "${u.id}"`)
    const gridNotes: string[] = []
    const rotNotes: string[] = []
    const { result, changeSet } = this.edit(board, caller, a.intent, `Edit ${a.updates.length} block${a.updates.length === 1 ? '' : 's'}`, (rec) => {
      const frames = new Set<string>()
      const updated: string[] = []
      for (const u of a.updates as Args[]) {
        const cur = board.blocks.get(u.id)!
        const patch: Partial<Block> = {}
        if (u.text !== undefined) patch.text = u.text
        if (u.title !== undefined) patch.title = u.title
        if (u.color !== undefined) patch.color = colorFor(u.color, cur.color)
        if (u.size !== undefined) patch.size = toSizeToken(u.size, cur.size)
        const exact = a.snap === false
        if (u.x !== undefined) patch.x = exact ? u.x : snapNoted(u.x, gridNotes, `x`)
        if (u.y !== undefined) patch.y = exact ? u.y : snapNoted(u.y, gridNotes, `y`)
        if (u.rotation !== undefined) {
          const norm = (d: number) => ((d % 360) + 360) % 360
          const r = exact ? norm(u.rotation) : norm(Math.round(u.rotation / 15) * 15)
          if (!exact && r !== norm(u.rotation)) rotNotes.push(`${u.rotation}°→${r}°`)
          patch.rotation = r
        }
        const merged = { ...cur, ...patch }
        const contentChanged = patch.text !== undefined || patch.title !== undefined || patch.size !== undefined
        if (contentChanged) patch.contentH = undefined
        if (cur.kind === 'sticky' && contentChanged) {
          const m = measureSticky(merged.text, merged.size, cur.expanded, typeChrome(merged))
          const w = Math.max(m.w, patch.size ? 0 : cur.w)
          Object.assign(patch, { w, h: w === m.w ? m.h : fitHeight('sticky', w, stickyContentHeight(merged.text, w, typeChrome(merged)), cur.expanded), size: m.size })
        } else if ((cur.kind === 'card' || cur.kind === 'text') && contentChanged) {
          const m = measureBlock(merged)
          patch.w = m.w
          patch.h = m.h
        }
        rec.updateBlock(u.id, patch)
        updated.push(u.id)
        if (cur.parent) frames.add(cur.parent)
        this.makeRoom(board, cur, patch.w ?? cur.w, (patch.h ?? cur.h) - cur.h, new Set(updated), (id, y) => rec.updateBlock(id, { y }))
      }
      for (const f of frames) this.fitFrame(rec, board, f)
      return updated
    })
    reportSnapped(gridNotes)
    reportSnapped(rotNotes, '15° (pass `snap: false` for exact angles)')
    return { board: board.id, changeSet, updated: result }
  }

  private deleteBlocks(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const missing = (a.ids as string[]).filter((id) => !board.blocks.get(id) && !board.connectors.get(id))
    if (missing.length) throw new ToolError(`Not found: ${missing.join(', ')}`)
    const { changeSet } = this.edit(board, caller, a.intent, `Remove ${a.ids.length} item${a.ids.length === 1 ? '' : 's'}`, (rec) => {
      for (const id of a.ids as string[]) {
        if (board.connectors.get(id)) rec.deleteConnector(id)
        else rec.deleteBlock(id)
      }
    })
    return { board: board.id, changeSet, deleted: a.ids }
  }

  private connect(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    if (a.connectors && (a.from || a.to)) throw new ToolError('Pass either `connectors: [...]` or a single `from` / `to`, not both')
    const list: Args[] = a.connectors ?? (a.from && a.to ? [{ from: a.from, to: a.to, label: a.label, relation: a.relation }] : [])
    if (!list.length) throw new ToolError('Pass `connectors: [{ from, to }]` (several) or `from` and `to` (one)')
    const pairs = list.map((c) => {
      const from = board.resolve(c.from)
      const to = board.resolve(c.to)
      if (!from) throw new ToolError(`Can't find block "${c.from}" (use an id from get_board)`)
      if (!to) throw new ToolError(`Can't find block "${c.to}" (use an id from get_board)`)
      if (from.id === to.id) throw new ToolError(`A connector needs two different blocks ("${c.from}")`)
      return { from: from.id, to: to.id, label: c.label as string | undefined, route: (c.route ?? a.route) as Connector['route'], relation: (c.relation as Connector['relation']) ?? suggestRelation(from.type, to.type) }
    })
    const { result, changeSet } = this.edit(board, caller, a.intent, `Connect ${pairs.length} pair${pairs.length === 1 ? '' : 's'}`, (rec) => {
      const ids: string[] = []
      for (const p of pairs) {
        const dup = [...board.connectors.values()].find((c) => c.from === p.from && c.to === p.to)
        if (dup) continue
        ids.push(rec.createConnector({ id: newId(), from: p.from, to: p.to, label: p.label, ...(p.route ? { route: p.route } : {}), ...(p.relation ? { relation: p.relation } : {}) }).id)
        rec.touched.add(p.to)
      }
      return ids
    })
    return { board: board.id, changeSet, connectors: result }
  }

  private async addImage(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    let bytes: Uint8Array
    if (a.path) {
      const fs = await import('node:fs')
      if (!fs.existsSync(a.path)) throw new ToolError(`No file at ${a.path}`)
      bytes = new Uint8Array(fs.readFileSync(a.path))
    } else if (a.url) {
      const r = await fetch(a.url, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new ToolError(`Download failed (${r.status}) for ${a.url}`)
      bytes = new Uint8Array(await r.arrayBuffer())
    } else if (a.data) {
      bytes = new Uint8Array(Buffer.from(String(a.data).replace(/^data:[^,]+,/, ''), 'base64'))
    } else throw new ToolError('Provide path, url or data')
    if (bytes.byteLength > 12 * 1024 * 1024) throw new ToolError('Images are limited to 12 MB')
    const info = imageInfo(bytes)
    if (!info || !info.w || !info.h) throw new ToolError('Unsupported image — use PNG, JPEG, GIF or WebP')
    const assetId = `a${newId()}`
    board.doc.transact(() => board.assets.set(assetId, { id: assetId, mime: info.mime, w: info.w, h: info.h, bytes, name: a.path?.split('/').pop(), createdAt: Date.now() }), 'api')
    const w = snap(Math.min(a.width ?? Math.min(info.w, 480), 1600))
    const h = snap((w * info.h) / info.w)
    return this.createBlocks({ ...a, blocks: [{ kind: 'image', w, h, asset: assetId, text: a.caption ?? '' }], intent: a.intent ?? 'Add an image' }, caller)
  }

  private updateConnectors(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    if (a.connectors && a.ids) throw new ToolError('Pass either `ids` (same change for all) or `connectors: [{ id, … }]` (per connector), not both')
    const shared = { route: a.route, label: a.label, waypoints: a.waypoints, relation: a.relation }
    const items: Args[] = a.connectors ?? (a.ids ?? []).map((id: string) => ({ id, ...shared }))
    if (!items.length) throw new ToolError('Pass `ids` or `connectors: [{ id, route, label, waypoints }]`')
    const missing = items.map((i) => i.id as string).filter((id) => !board.connectors.get(id))
    if (missing.length) throw new ToolError(`No connector with id: ${missing.join(', ')}`)
    const notes: string[] = []
    const { changeSet } = this.edit(board, caller, a.intent, `Restyle ${items.length} connector${items.length === 1 ? '' : 's'}`, (rec) => {
      for (const it of items) {
        const patch: Partial<Connector> = {}
        if (it.route) patch.route = it.route
        if (it.label !== undefined) patch.label = it.label
        if (it.relation) patch.relation = it.relation === 'none' ? undefined : it.relation
        if (it.waypoints) {
          patch.waypoints = it.waypoints.length ? it.waypoints.map((p: { x: number; y: number }, i: number) => ({ x: snapNoted(p.x, notes, `waypoint ${i + 1}.x`), y: snapNoted(p.y, notes, `waypoint ${i + 1}.y`) })) : null
          if (it.waypoints.length && !it.route) patch.route = 'elbow'
        }
        rec.updateConnector(it.id, patch)
      }
    })
    reportSnapped(notes)
    return { board: board.id, changeSet, updated: items.map((i) => i.id) }
  }

  private groupIntoFrame(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const blocks = (a.ids as string[]).map((id) => {
      const b = board.blocks.get(id)
      if (!b) throw new ToolError(`No block with id "${id}"`)
      if (b.kind === 'frame') throw new ToolError(`Frames can't be nested ("${b.title}")`)
      return b
    })
    const rects = blocks.map((b) => board.pageRect(b))
    const bb = bboxOf(rects)
    const fx = snap(bb.x - PAD)
    const fy = snap(bb.y - PAD)
    const { result, changeSet } = this.edit(board, caller, a.intent, `Group ${blocks.length} blocks into "${a.title}"`, (rec) => {
      const f = rec.createBlock({ id: newId(), kind: 'frame', x: fx, y: fy, w: snap(bb.w + PAD * 2), h: snap(bb.h + PAD * 2), parent: null, text: '', title: a.title, color: 'gray', size: 'm' })
      blocks.forEach((b, i) => rec.updateBlock(b.id, { parent: f.id, x: snap(rects[i].x - fx), y: snap(rects[i].y - fy) }))
      this.fitFrame(rec, board, f.id)
      return f.id
    })
    return { board: board.id, changeSet, frame: result }
  }

  private arrange(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const blocks = (a.ids as string[]).map((id) => {
      const b = board.blocks.get(id)
      if (!b) throw new ToolError(`No block with id "${id}"`)
      return b
    })
    const parent = blocks[0].parent ?? null
    if (blocks.some((b) => (b.parent ?? null) !== parent)) throw new ToolError('arrange needs blocks that share the same parent frame')
    const ordered = [...blocks].sort((p, q) => p.y - q.y || p.x - q.x)
    const bb = bboxOf(ordered)
    const res = layout(ordered.map((b) => ({ key: b.id, kind: b.kind, w: b.w, h: b.h })), a.layout, { columns: a.columns, headingSize: () => ({ w: 0, h: 0 }) })
    const { changeSet } = this.edit(board, caller, a.intent, `Arrange ${blocks.length} blocks as ${a.layout}`, (rec) => {
      for (const b of ordered) {
        const p = res.placed.get(b.id)!
        rec.updateBlock(b.id, { x: snap(bb.x + p.x), y: snap(bb.y + p.y), h: p.h })
      }
      if (parent) this.fitFrame(rec, board, parent)
    })
    return { board: board.id, changeSet, arranged: blocks.map((b) => b.id) }
  }

  private tidy(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const target = a.frame ? this.frame(board, a.frame) : null
    let moved = 0
    if (a.by === 'type' || a.by === 'matrix') return this.tidyByType(board, target, a, caller)
    const { changeSet } = this.edit(board, caller, a.intent, target ? `Tidy "${target.title}"` : 'Tidy the board', (rec) => {
      const tidyFrame = (f: Block) => {
        const kids = board.childrenOf(f.id)
        const pos = tidyPositions(kids, { x: PAD, y: PAD })
        for (const k of kids) {
          const p = pos.get(k.id)!
          if (p.x !== k.x || p.y !== k.y) {
            rec.updateBlock(k.id, p)
            moved++
          }
        }
        this.fitFrame(rec, board, f.id, true)
      }
      if (target) tidyFrame(target)
      else {
        for (const f of board.childrenOf(null).filter((b) => b.kind === 'frame')) tidyFrame(f)
        const top = board.childrenOf(null)
        if (top.length) {
          const bb = bboxOf(top)
          const pos = tidyPositions(top, { x: bb.x, y: bb.y })
          for (const b of top) {
            const p = pos.get(b.id)!
            if (p.x !== b.x || p.y !== b.y) {
              rec.updateBlock(b.id, p)
              moved++
            }
          }
        }
      }
    })
    return { board: board.id, changeSet, moved }
  }

  /** Group blocks by type (one row band per type), or lay them out as a type × field-value matrix with axis labels. */
  private tidyByType(board: Board, frame: Block | null, a: Args, caller: CallerInfo) {
    const parent = frame?.id ?? null
    const sibs = board.childrenOf(parent).filter((b) => b.kind !== 'frame')
    const oldAxes = sibs.filter((b) => b.layoutRole === 'axis')
    const items = sibs.filter((b) => b.layoutRole !== 'axis')
    if (!items.length) throw new ToolError('Nothing to tidy here')
    const origin = frame ? { x: PAD, y: PAD } : (() => { const bb = bboxOf(items); return { x: bb.x, y: bb.y } })()
    const order = [...BLOCK_TYPE_IDS, undefined]
    const rows = order.map((t) => ({ t, list: items.filter((b) => b.type === t).sort((p, q) => p.y - q.y || p.x - q.x) })).filter((r) => r.list.length)
    const GAP = 24
    const BAND = 48
    const moves = new Map<string, { x: number; y: number }>()
    const axes: { text: string; x: number; y: number }[] = []
    const field = a.matrix_field as string | undefined
    const bandLayout = (list: { t?: BlockTypeId; list: Block[] }[], startY: number) => {
      let y = startY
      const maxRowW = 6
      for (const r of list) {
        let x = origin.x
        let rowH = 0
        r.list.forEach((b, i) => {
          if (i && i % maxRowW === 0) {
            x = origin.x
            y += rowH + GAP
            rowH = 0
          }
          moves.set(b.id, { x: snap(x), y: snap(y) })
          x += b.w + GAP
          rowH = Math.max(rowH, b.h)
        })
        y += rowH + BAND
      }
      return y
    }
    if (a.by === 'matrix') {
      if (!field) throw new ToolError('matrix needs `matrix_field`, e.g. "status" or "done" (see list_types)')
      const withField = new Set(BLOCK_TYPE_IDS.filter((t) => BLOCK_TYPES[t].fields.some((f) => f.key === field)))
      if (!withField.size) throw new ToolError(`No type has a field "${field}" (see list_types)`)
      const valueOf = (b: Block) => {
        const v = typeFields(b)[field]
        return v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)
      }
      const inMatrix = rows.filter((r) => r.t && withField.has(r.t))
      const rest = rows.filter((r) => !r.t || !withField.has(r.t))
      const members = inMatrix.flatMap((r) => r.list)
      const declared = [...withField].flatMap((t) => BLOCK_TYPES[t].fields.filter((f) => f.key === field).flatMap((f) => (f.kind === 'enum' ? [...f.options] : f.kind === 'boolean' ? ['no', 'yes'] : [])))
      const cols = [...new Set([...declared, ...members.map(valueOf)])]
      const labelW = 128
      const colW = cols.map((c) => Math.max(160, ...members.filter((b) => valueOf(b) === c).map((b) => b.w)))
      const colX: number[] = []
      let x = origin.x + labelW
      for (const w of colW) {
        colX.push(x)
        x += w + GAP
      }
      let y = origin.y + 32
      cols.forEach((c, i) => axes.push({ text: c, x: colX[i], y: origin.y }))
      for (const r of inMatrix) {
        let rowH = 0
        const cursor = cols.map(() => y)
        for (const b of r.list) {
          const ci = cols.indexOf(valueOf(b))
          moves.set(b.id, { x: snap(colX[ci]), y: snap(cursor[ci]) })
          cursor[ci] += b.h + GAP
          rowH = Math.max(rowH, cursor[ci] - y - GAP)
        }
        axes.push({ text: BLOCK_TYPES[r.t!].plural, x: origin.x, y })
        y += rowH + BAND
      }
      if (rest.length) bandLayout(rest, y + GAP)
    } else bandLayout(rows, origin.y)
    const { changeSet } = this.edit(board, caller, a.intent, a.by === 'matrix' ? `Matrix: types × ${field}` : 'Group by type', (rec) => {
      for (const ax of oldAxes) rec.deleteBlock(ax.id)
      for (const ax of axes) {
        const m = measureBlock({ kind: 'text', text: ax.text, size: 's', w: 0, h: 0 })
        rec.createBlock({ id: newId(), kind: 'text', x: snap(ax.x), y: snap(ax.y), w: m.w, h: m.h, parent, text: `**${ax.text}**`, color: 'gray', size: 's', layoutRole: 'axis' })
      }
      for (const [id, p] of moves) rec.updateBlock(id, p)
      if (frame) this.fitFrame(rec, board, frame.id, true)
    })
    return { board: board.id, changeSet, moved: moves.size, rows: rows.map((r) => r.t ?? 'untyped') }
  }

  private lint(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    this.presence.touch(caller, { boardId: board.id, autoStatus: 'Checking the layout…' })
    const all = [...board.blocks.values()]
    const target = a.frame ? this.frame(board, a.frame) : null
    const scope = target ? [target, ...board.childrenOf(target.id)] : all
    const issues = lintBlocks(all, scope, describeBlock)
    return {
      board: board.id,
      ok: !issues.some((i) => i.severity === 'error'),
      summary: issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'} (${issues.filter((i) => i.severity === 'error').length} errors). Consider calling tidy.` : 'Layout looks clean.',
      issues,
    }
  }

  private async snapshot(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    this.presence.touch(caller, { boardId: board.id, autoStatus: 'Looking at the board…' })
    const target = a.frame ? this.frame(board, a.frame) : null
    if (a.ids) for (const id of a.ids as string[]) if (!board.blocks.get(id)) throw new ToolError(`No block with id "${id}"`)
    const { svg, png, width, height } = await renderSnapshot(board, { frameId: target?.id, ids: a.ids, theme: a.theme ?? 'light', format: a.format ?? 'png' })
    if ((a.format ?? 'png') === 'svg') return { board: board.id, width, height, svg }
    return { board: board.id, width, height, image: { mimeType: 'image/png', data: png!.toString('base64') } }
  }

  // ---- export ----------------------------------------------------------------

  exportBoard(a: Args) {
    const board = this.board(a.board)
    const target = a.frame ? this.frame(board, a.frame) : null
    const all = [...board.blocks.values()]
    const inScope = (b: Block) => !target || b.id === target.id || b.parent === target.id
    const blocks = all.filter(inScope)
    const ids = new Set(blocks.map((b) => b.id))
    const connectors = [...board.connectors.values()].filter((c) => (!c.from || ids.has(c.from)) && (!c.to || ids.has(c.to)))
    const threads = [...board.threads.values()].filter((t) => ids.has(t.target))
    if (a.format === 'json') {
      const assets = [...board.assets.values()].filter((as) => blocks.some((b) => b.asset === as.id)).map(({ bytes, ...meta }) => ({ ...meta, size: bytes.byteLength }))
      const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && v !== null && k !== 'changeSet')) as T
      const byType = Object.fromEntries(BLOCK_TYPE_IDS.map((t) => [t, blocks.filter((b) => b.type === t).map((b) => b.id)]).filter(([, v]) => v.length))
      return { format: 'json', filename: `${slug(board.title)}.json`, content: JSON.stringify({ format: 'aifig-export/1', exportedAt: new Date().toISOString(), board: { id: board.id, title: board.title }, byType, blocks: blocks.map((b) => clean({ ...b, ...(b.type ? { fields: typeFields(b) } : {}) })), connectors: connectors.map(clean), threads, assets }, null, 2) }
    }
    const byY = (p: Block, q: Block) => p.y - q.y || p.x - q.x
    const label = (b: Block | undefined) => (b ? (b.kind === 'card' || b.kind === 'frame' ? b.title || b.text : b.text).replace(/\s+/g, ' ').trim() : '(free end)')
    const line = (b: Block): string[] => {
      const comments = threads.filter((t) => t.target === b.id && !t.resolved)
      const notes = comments.flatMap((t) => [`  > 💬 ${t.author.name}: ${t.text}`, ...t.replies.map((r) => `  > ↳ ${r.author.name}: ${r.text}`)])
      switch (b.kind) {
        case 'card':
          return [`### ${b.title || 'Untitled card'}`, '', ...(b.text ? [b.text, ''] : []), ...notes]
        case 'text':
          return [`**${b.text}**`, '', ...notes]
        case 'web': {
          const w = b.web
          if (!w) return notes
          const head = `### 🌐 ${w.title || (w.mode === 'url' ? w.provider : 'Web snippet')}`
          if (w.mode === 'url') return [head, '', `<${w.url}>`, '', ...notes]
          const fence = (lang: string, code?: string) => (code?.trim() ? ['```' + lang, code.trim(), '```', ''] : [])
          return [head, '', ...fence('html', w.html), ...fence('css', w.css), ...fence('js', w.js), ...notes]
        }
        case 'image': {
          const as = b.asset ? board.assets.get(b.asset) : undefined
          const src = a.images === 'inline' && as ? `data:${as.mime};base64,${bytesToBase64(as.bytes)}` : (as?.name ?? b.asset ?? '')
          return [`![${b.text || as?.name || 'image'}](${src})`, '', ...notes]
        }
        default:
          return [`- ${b.text.replace(/\n/g, '\n  ')}`, ...notes]
      }
    }
    const out: string[] = [`# ${target ? target.title : board.title}`, '', `_Exported from ai-figma on ${new Date().toISOString().slice(0, 10)}_`, '']
    // typed blocks first, one section per type; everything else by frame
    const where = (b: Block) => (b.parent ? board.blocks.get(b.parent)?.title : '') || ''
    const typedLine = (b: Block): string[] => {
      const f = typeFields(b)
      const text = (b.kind === 'card' ? `**${b.title || 'Untitled'}**${b.text ? ` — ${b.text}` : ''}` : b.text).replace(/\n/g, ' ').trim()
      const ctx = where(b) ? ` _(${where(b)})_` : ''
      const comments = threads.filter((t) => t.target === b.id && !t.resolved).flatMap((t) => [`  > 💬 ${t.author.name}: ${t.text}`, ...t.replies.map((r) => `  > ↳ ${r.author.name}: ${r.text}`)])
      if (b.type === 'todo') return [`- [${f.done ? 'x' : ' '}] ${text}${f.owner ? ` — @${f.owner}` : ''}${ctx}`, ...comments]
      if (b.type === 'quote') return [`> ${text}${[f.interviewee, f.source].filter(Boolean).length ? ` — ${[f.interviewee, f.source].filter(Boolean).join(', ')}` : ''}${ctx}`, '', ...comments]
      const sum = fieldSummary(b)
      return [`- ${text}${sum ? ` — _${sum}_` : ''}${ctx}`, ...comments]
    }
    for (const t of BLOCK_TYPE_IDS) {
      const list = blocks.filter((b) => b.type === t).sort((p, q) => where(p).localeCompare(where(q)) || byY(p, q))
      if (!list.length) continue
      out.push(`## ${BLOCK_TYPES[t].plural} (${list.length})`, '')
      for (const b of list) out.push(...typedLine(b))
      out.push('')
    }
    const plain = (b: Block) => !b.type && b.layoutRole !== 'axis'
    const frames = blocks.filter((b) => b.kind === 'frame').sort(byY)
    for (const f of frames) {
      const kids = all.filter((k) => k.parent === f.id && plain(k)).sort(byY)
      if (!kids.length) continue
      out.push(`## ${f.title || 'Frame'}`, '')
      for (const b of kids) out.push(...line(b))
      out.push('')
    }
    const loose = blocks.filter((b) => !b.parent && b.kind !== 'frame' && plain(b)).sort(byY)
    if (loose.length) {
      if (frames.length) out.push('## Other notes', '')
      for (const b of loose) out.push(...line(b))
      out.push('')
    }
    if (connectors.length) {
      out.push('## Connections', '')
      for (const c of connectors) out.push(`- ${label(c.from ? board.blocks.get(c.from) : undefined)} ${c.relation ? `*${c.relation}*` : '→'} ${label(c.to ? board.blocks.get(c.to) : undefined)}${c.label ? ` (${c.label})` : ''}`)
      out.push('')
    }
    return { format: 'markdown', filename: `${slug(board.title)}.md`, content: out.join('\n').replace(/\n{3,}/g, '\n\n') }
  }

  // ---- change sets -------------------------------------------------------

  private beginChangeSet(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    if (caller.kind !== 'agent') throw new ToolError('Change sets are for agents')
    const key = `${caller.id}:${board.id}`
    const prevId = this.openChangeSets.get(key)
    if (prevId) this.commitChangeSet({ board: board.id }, caller)
    const now = Date.now()
    const cs: ChangeSet = { id: `cs${newId()}`, author: this.author(caller), intent: a.intent, status: 'open', entries: [], createdAt: now, updatedAt: now }
    board.doc.transact(() => board.changeSets.set(cs.id, cs), 'api')
    this.openChangeSets.set(key, cs.id)
    this.presence.touch(caller, { boardId: board.id, autoStatus: a.intent })
    return { changeSet: cs.id }
  }

  private commitChangeSet(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const key = `${caller.id}:${board.id}`
    const id = this.openChangeSets.get(key)
    if (!id) return { committed: null, note: 'No open change set; each edit was already submitted for review.' }
    this.openChangeSets.delete(key)
    const cs = board.changeSets.get(id)
    if (!cs) return { committed: null }
    board.doc.transact(() => {
      if (!cs.entries.length) board.changeSets.delete(id)
      else board.changeSets.set(id, { ...cs, status: 'pending', updatedAt: Date.now() })
    }, 'api')
    this.presence.touch(caller, { boardId: board.id, status: '' })
    return { committed: cs.entries.length ? id : null, entries: cs.entries.length }
  }

  private listChangeSets(a: Args) {
    const board = this.board(a.board)
    const sets = [...board.changeSets.values()]
      .filter((c) => !a.status || c.status === a.status)
      .sort((p, q) => q.createdAt - p.createdAt)
      .slice(0, 30)
    return {
      board: board.id,
      changeSets: sets.map((c) => ({
        id: c.id,
        author: c.author.name,
        intent: c.intent,
        status: c.status,
        entries: c.entries.length,
        reason: c.resolvedReason,
        rejectedItems: (c.decisions ?? []).filter((d) => d.action === 'reject').map((d) => d.id),
        createdAt: new Date(c.createdAt).toISOString(),
      })),
    }
  }

  private review(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const live = (c: ChangeSet) => c.status === 'pending' || c.status === 'open'
    const targets = a.id === 'all' ? [...board.changeSets.values()].filter(live) : ([board.changeSets.get(a.id)].filter(Boolean) as ChangeSet[])
    if (!targets.length) {
      if (a.id === 'all') return { board: board.id, reviewed: [], action: a.action, items: null }
      throw new ToolError(`No change set "${a.id}"`)
    }
    const items: Set<string> | null = a.items?.length ? new Set(a.items as string[]) : null
    board.doc.transact(() => {
      for (const cs of targets) {
        if (!live(cs)) continue
        const chosen = items ? cs.entries.filter((e) => items.has(e.id)) : cs.entries
        if (!chosen.length) continue
        if (a.action === 'accept') this.acceptEntries(board, cs, chosen)
        else this.revertEntries(board, chosen, new Set(chosen.map((e) => e.id)))
        const remaining = cs.entries.filter((e) => !chosen.includes(e))
        const decisions = [...(cs.decisions ?? []), ...[...new Set(chosen.map((e) => e.id))].map((id) => ({ id, action: a.action as 'accept' | 'reject', at: Date.now() }))]
        const accepted = a.action === 'accept' ? [...(cs.accepted ?? []), ...chosen] : (cs.accepted ?? [])
        let status: ChangeSet['status'] = cs.status
        if (!remaining.length) {
          const acts = new Set(decisions.map((d) => d.action))
          status = acts.size > 1 ? 'partial' : a.action === 'accept' ? 'accepted' : 'rejected'
        }
        board.changeSets.set(cs.id, { ...cs, entries: remaining, decisions, accepted, status, resolvedAt: remaining.length ? cs.resolvedAt : Date.now(), resolvedReason: a.reason ?? cs.resolvedReason, updatedAt: Date.now() })
        if (!remaining.length) for (const [k, v] of this.openChangeSets) if (v === cs.id) this.openChangeSets.delete(k)
      }
      board.touch()
    }, caller.kind === 'human' ? 'review' : 'api')
    return { board: board.id, reviewed: targets.map((t) => t.id), action: a.action, items: a.items ?? null }
  }

  private acceptEntries(board: Board, cs: ChangeSet, entries: ChangeEntry[]) {
    for (const e of entries) {
      if (e.op === 'delete') continue
      const map = (e.target === 'block' ? board.blocks : board.connectors) as any
      const cur = map.get(e.id)
      if (cur && cur.changeSet === cs.id) map.set(e.id, { ...cur, pending: false, changeSet: null })
    }
  }

  /** Undo entries (newest first). Children of removed frames that aren't being reverted move to the page. */
  private revertEntries(board: Board, entries: ChangeEntry[], reverting: Set<string>) {
    for (const e of [...entries].reverse()) {
      if (e.target === 'connector') {
        if (e.op === 'create') board.connectors.delete(e.id)
        else board.connectors.set(e.id, { ...(e.before as Connector), pending: false, changeSet: null })
        continue
      }
      if (e.op === 'create') {
        const b = board.blocks.get(e.id)
        if (!b) continue
        if (b.kind === 'frame') {
          const fr = board.pageRect(b)
          for (const child of board.childrenOf(b.id)) {
            if (reverting.has(child.id)) continue
            board.blocks.set(child.id, { ...child, parent: null, x: child.x + fr.x, y: child.y + fr.y })
          }
        }
        for (const c of [...board.connectors.values()]) if (c.from === e.id || c.to === e.id) board.connectors.delete(c.id)
        board.blocks.delete(e.id)
      } else {
        board.blocks.set(e.id, { ...(e.before as Block), pending: false, changeSet: null })
      }
    }
  }

  /** Undo an author's (or one change set's) work, including accepted changes, keeping later human edits. */
  private undoChanges(a: Args, caller: CallerInfo) {
    const board = this.board(a.board)
    const who = a.author ? String(a.author).toLowerCase() : null
    const sets = [...board.changeSets.values()].filter((c) => {
      if (c.status === 'rejected' || c.status === 'undone') return false
      if (a.change_set) return c.id === a.change_set
      if (Array.isArray(a.authors)) return (a.authors as string[]).includes(c.author.id)
      return who && (c.author.id.toLowerCase() === who || c.author.name.toLowerCase() === who)
    })
    if (!sets.length) throw new ToolError(a.change_set ? `No change set "${a.change_set}" to undo` : `No changes by "${a.author ?? 'that agent'}" to undo`)
    board.saveNow()
    this.registry.safety.snapshot(board, 'auto', sets.length === 1 ? `Before undoing “${sets[0].intent}”` : `Before undoing ${sets.length} change sets`, caller.name)
    const kept: { id: string; reason: string }[] = []
    let reverted = 0
    board.doc.transact(() => {
      for (const cs of [...sets].sort((p, q) => q.createdAt - p.createdAt)) {
        const since = cs.resolvedAt ?? cs.updatedAt
        const touchedByHuman = (id: string) => {
          const cur = (board.blocks.get(id) ?? board.connectors.get(id)) as Block | Connector | undefined
          return !!cur && cur.editedBy?.kind === 'human' && cur.updatedAt > since
        }
        const all = [...(cs.accepted ?? []), ...cs.entries]
        const safe = all.filter((e) => {
          if (e.op !== 'delete' && touchedByHuman(e.id)) {
            kept.push({ id: e.id, reason: 'edited by a person after it was accepted' })
            return false
          }
          return !(e.op === 'delete' && (board.blocks.has(e.id) || board.connectors.has(e.id)))
        })
        this.revertEntries(board, safe, new Set(safe.map((e) => e.id)))
        reverted += new Set(safe.map((e) => e.id)).size
        board.changeSets.set(cs.id, { ...cs, entries: [], status: 'undone', undoneAt: Date.now(), undoneBy: caller.name, updatedAt: Date.now() })
      }
      board.touch()
    }, 'review')
    return { board: board.id, undone: sets.map((s) => s.id), reverted, kept }
  }
}
