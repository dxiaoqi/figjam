import fs from 'node:fs'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import * as Y from 'yjs'
import type { Asset, Block, BoardSummary, ChangeSet, Connector, Rect, Thread } from '@aifig/shared'
import { cleanStaleTemps, writeFileAtomic } from './atomic'
import { backupFile, listBackups, quarantine } from './backups'
import { aifigHome } from './config'
import {
  compareSchema,
  CorruptFileError,
  CURRENT_SCHEMA,
  decodeContainer,
  encodeContainer,
  formatSchema,
  FutureVersionError,
  LEGACY_SCHEMA,
  type SchemaVersion,
} from './fileformat'
import { migrate, type MigrationResult } from './migrations'
import { NoticeStore } from './notices'
import { DataSafety } from './safety'
import { listVersions, readVersion } from './versions'

export { aifigHome }

export const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)

export function boardsDir() {
  return path.join(aifigHome(), 'boards')
}

/** Quiet period before a burst of edits is written… */
export const SAVE_DEBOUNCE_MS = 250
/** …but never later than this after the first unsaved edit, so constant editing still saves. */
export const SAVE_MAX_WAIT_MS = 2000
const SAVE_RETRY_MS = 3000

/** Edits since the last write, used to spot large changes worth a version from just before them. */
export interface ChangeCounts {
  added: number
  removed: number
  updated: number
}

/**
 * One board = one Yjs document, persisted as `<id>.aifig` (checksummed container, see fileformat.ts)
 * plus a readable `<id>.json` export. Saves are coalesced and atomic.
 */
export class Board {
  readonly doc = new Y.Doc()
  readonly meta = this.doc.getMap<unknown>('meta')
  readonly blocks = this.doc.getMap<Block>('blocks')
  readonly connectors = this.doc.getMap<Connector>('connectors')
  readonly changeSets = this.doc.getMap<ChangeSet>('changeSets')
  readonly assets = this.doc.getMap<Asset>('assets')
  readonly threads = this.doc.getMap<Thread>('threads')
  private saveTimer: NodeJS.Timeout | null = null
  private firstDirtyAt = 0
  deleted = false
  dirty = false
  /** False for read-only copies (version previews, recovery candidates) that must never touch disk. */
  readonly persist: boolean
  /** Schema written to disk: the current one, or a newer minor version the file already had. */
  schema: SchemaVersion = CURRENT_SCHEMA
  /** Unsaved structural edits (reset on every write). */
  pending: ChangeCounts = { added: 0, removed: 0, updated: 0 }
  private updatedKeys = new Set<string>()
  lastSavedAt = 0
  /** A user-chosen .aifig file (Open / Save As) that every save is mirrored to. */
  externalPath: string | null = null
  /** Called right before a write replaces the file on disk (the old bytes are still there). */
  beforeWrite: ((b: Board, pending: ChangeCounts) => void) | null = null
  onSaved: ((b: Board) => void) | null = null
  onSaveError: ((b: Board, e: Error) => void) | null = null

  constructor(
    readonly id: string,
    opts: { persist?: boolean } = {},
  ) {
    this.persist = opts.persist !== false
    this.doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin !== 'load') this.markDirty()
    })
    const count = (e: Y.YMapEvent<any>) => {
      if (e.transaction.origin === 'load') return
      e.changes.keys.forEach((c, key) => {
        if (c.action === 'add') this.pending.added++
        else if (c.action === 'delete') this.pending.removed++
        else if (!this.updatedKeys.has(key)) {
          this.updatedKeys.add(key)
          this.pending.updated++
        }
      })
    }
    this.blocks.observe(count)
    this.connectors.observe(count)
  }

  get file() {
    return path.join(boardsDir(), `${this.id}.aifig`)
  }

  get jsonFile() {
    return path.join(boardsDir(), `${this.id}.json`)
  }

  get title() {
    return (this.meta.get('title') as string) ?? 'Untitled board'
  }

  get schemaLabel() {
    return formatSchema(this.schema)
  }

  /**
   * Decode a file into a detached board: verify the container, apply the Yjs payload, run migrations.
   * Throws CorruptFileError or FutureVersionError; never returns a silently empty board.
   */
  static fromBytes(id: string, data: Uint8Array, file?: string, opts: { persist?: boolean } = {}): { board: Board; migration: MigrationResult; savedAt: number | null } {
    const decoded = decodeContainer(data, file)
    const b = new Board(id, opts)
    try {
      Y.applyUpdate(b.doc, decoded.payload, 'load')
    } catch (e) {
      throw new CorruptFileError(`the board document can't be decoded (${(e as Error).message})`, file)
    }
    if (compareSchema(decoded.schema, LEGACY_SCHEMA) === 0 && !b.meta.size && !b.blocks.size) {
      throw new CorruptFileError('no board data in the file', file)
    }
    const migration = migrate(b.doc, decoded.schema)
    b.schema = migration.newerMinor ? decoded.schema : CURRENT_SCHEMA
    return { board: b, migration, savedAt: decoded.header?.savedAt ?? null }
  }

  static create(title: string): Board {
    const b = new Board(`b${newId()}`)
    b.doc.transact(() => {
      b.meta.set('title', title)
      b.meta.set('createdAt', Date.now())
      b.meta.set('updatedAt', Date.now())
      b.meta.set('schema', formatSchema(CURRENT_SCHEMA))
    })
    b.saveNow(true)
    return b
  }

  markDirty() {
    if (!this.persist || this.deleted) return
    if (!this.dirty) {
      this.dirty = true
      this.firstDirtyAt = Date.now()
    }
    this.scheduleSave()
  }

  scheduleSave(delay = SAVE_DEBOUNCE_MS) {
    if (!this.persist || this.deleted) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    const wait = Math.max(0, Math.min(delay, this.firstDirtyAt + SAVE_MAX_WAIT_MS - Date.now()))
    this.saveTimer = setTimeout(() => this.saveNow(), wait)
    this.saveTimer.unref?.()
  }

  encode() {
    return encodeContainer(Y.encodeStateAsUpdate(this.doc), { savedAt: Date.now(), board: this.id, title: this.title, schema: this.schemaLabel })
  }

  /** Write now if there are unsaved edits (or always with `force`). Returns false if the write failed. */
  saveNow(force = false): boolean {
    if (!this.persist || this.deleted) return true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.dirty && !force) return true
    const pending = this.pending
    try {
      this.beforeWrite?.(this, pending)
    } catch (e) {
      console.error(`[core] pre-save snapshot of ${this.id} failed:`, e)
    }
    try {
      const bytes = this.encode()
      writeFileAtomic(this.file, bytes)
      this.dirty = false
      this.pending = { added: 0, removed: 0, updated: 0 }
      this.updatedKeys.clear()
      this.lastSavedAt = Date.now()
      if (this.externalPath) {
        try {
          writeFileAtomic(this.externalPath, bytes)
        } catch (e) {
          console.error(`[core] could not write ${this.externalPath}:`, e)
        }
      }
      writeFileAtomic(this.jsonFile, JSON.stringify(this.toJSON(), null, 2))
    } catch (e) {
      console.error(`[core] could not save board ${this.id}:`, e)
      this.onSaveError?.(this, e as Error)
      this.saveTimer = setTimeout(() => this.saveNow(), SAVE_RETRY_MS)
      this.saveTimer.unref?.()
      return false
    }
    try {
      this.onSaved?.(this)
    } catch (e) {
      console.error(`[core] after-save hook for ${this.id} failed:`, e)
    }
    return true
  }

  remove() {
    this.deleted = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    for (const f of [this.file, this.jsonFile]) fs.rmSync(f, { force: true })
  }

  touch() {
    this.meta.set('updatedAt', Date.now())
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      schema: this.schemaLabel,
      createdAt: this.meta.get('createdAt'),
      updatedAt: this.meta.get('updatedAt'),
      blocks: [...this.blocks.values()],
      connectors: [...this.connectors.values()],
      changeSets: [...this.changeSets.values()],
      assets: [...this.assets.values()].map(({ bytes, ...meta }) => ({ ...meta, size: bytes.byteLength })),
      threads: [...this.threads.values()],
    }
  }

  summary(): BoardSummary {
    return {
      id: this.id,
      path: this.externalPath,
      title: this.title,
      createdAt: (this.meta.get('createdAt') as number) ?? 0,
      updatedAt: (this.meta.get('updatedAt') as number) ?? 0,
      blockCount: this.blocks.size,
      pendingChangeSets: [...this.changeSets.values()].filter((c) => c.status === 'pending').length,
    }
  }

  // ---- geometry helpers -------------------------------------------------

  getBlock(id: string) {
    return this.blocks.get(id)
  }

  childrenOf(parent: string | null): Block[] {
    return [...this.blocks.values()].filter((b) => (b.parent ?? null) === parent)
  }

  /** Page-space bounds of a block (frames are top level, so one hop is enough). */
  pageRect(b: Block): Rect {
    let { x, y } = b
    if (b.parent) {
      const p = this.blocks.get(b.parent)
      if (p) {
        const pr = this.pageRect(p)
        x += pr.x
        y += pr.y
      }
    }
    return { x, y, w: b.w, h: b.h }
  }

  /** Resolve a block by id, or by exact (case-insensitive) title/text. */
  resolve(ref: string, kinds?: Block['kind'][]): Block | undefined {
    const direct = this.blocks.get(ref)
    if (direct && (!kinds || kinds.includes(direct.kind))) return direct
    const needle = ref.trim().toLowerCase()
    const candidates = [...this.blocks.values()].filter((b) => !kinds || kinds.includes(b.kind))
    return (
      candidates.find((b) => (b.title ?? '').trim().toLowerCase() === needle) ??
      candidates.find((b) => (b.text ?? '').trim().toLowerCase() === needle)
    )
  }
}

const when = (t: number) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

export class BoardRegistry {
  private boards = new Map<string, Board>()
  readonly notices = new NoticeStore()
  readonly safety = new DataSafety(this.notices)
  onBoardAdded: ((b: Board) => void) | null = null

  private externalIndex() {
    return path.join(aifigHome(), 'external.json')
  }

  private saveExternalIndex() {
    const map: Record<string, string> = {}
    for (const b of this.boards.values()) if (b.externalPath) map[b.id] = b.externalPath
    writeFileAtomic(this.externalIndex(), JSON.stringify(map, null, 2))
  }

  /** Open a .aifig file from anywhere; saves are mirrored back to it. */
  openFile(file: string): Board {
    const abs = path.resolve(file)
    const open = [...this.boards.values()].find((b) => b.externalPath === abs)
    if (open) return open
    const data = fs.readFileSync(abs)
    const { board: b, migration } = Board.fromBytes(`b${newId()}`, data, abs)
    if (!b.meta.get('title')) b.meta.set('title', path.basename(abs, '.aifig'))
    if (migration.applied.length) backupFile(b.id, b.title, data, `before-format-${formatSchema(migration.from)}`)
    b.externalPath = abs
    b.saveNow(true)
    this.add(b)
    this.saveExternalIndex()
    return b
  }

  /** Save As: write the board to a file and keep mirroring saves there. */
  saveAs(b: Board, file: string) {
    b.externalPath = path.resolve(file)
    b.saveNow(true)
    this.saveExternalIndex()
  }

  loadAll() {
    fs.mkdirSync(boardsDir(), { recursive: true })
    this.notices.load()
    cleanStaleTemps(boardsDir())
    let external: Record<string, string> = {}
    try {
      external = JSON.parse(fs.readFileSync(this.externalIndex(), 'utf8'))
    } catch {
      /* none yet */
    }
    for (const f of fs.readdirSync(boardsDir())) {
      if (!f.endsWith('.aifig')) continue
      const id = f.slice(0, -'.aifig'.length)
      const b = this.loadOne(id, external[id] ?? null)
      if (b) this.add(b)
    }
  }

  /** Load a board file, recovering from the newest good copy if it's damaged. Null if it can't be opened. */
  private loadOne(id: string, externalPath: string | null): Board | null {
    const file = path.join(boardsDir(), `${id}.aifig`)
    let data: Buffer
    try {
      data = fs.readFileSync(file)
    } catch (e) {
      console.error(`[core] could not read board ${id}:`, e)
      return null
    }
    try {
      const { board, migration, savedAt } = Board.fromBytes(id, data, file)
      board.externalPath = externalPath
      board.lastSavedAt = savedAt ?? fs.statSync(file).mtimeMs
      if (migration.applied.length) {
        backupFile(id, board.title, data, `before-format-${formatSchema(migration.from)}`)
        console.error(`[core] migrated “${board.title}” to file format ${formatSchema(migration.to)}`)
        board.saveNow(true)
      }
      this.safety.onLoaded(board, data)
      return board
    } catch (e) {
      if (e instanceof FutureVersionError) {
        this.notices.add({
          id: `future:${id}`,
          kind: 'future-version',
          level: 'warning',
          boardId: id,
          title: 'Board saved by a newer ai-figma',
          detail: e.message,
          file,
        })
        return null
      }
      return this.recover(id, file, e as Error, externalPath)
    }
  }

  /**
   * The board file is damaged. Keep it aside, then load the newest copy that verifies — the Save As mirror,
   * a version snapshot or a rolling backup — and say so. Nothing is ever replaced by an empty board.
   */
  private recover(id: string, file: string, error: Error, externalPath: string | null): Board | null {
    const reason = error instanceof CorruptFileError ? error.reason : error.message
    type Candidate = { label: string; at: number; read: () => Uint8Array }
    const candidates: Candidate[] = []
    if (externalPath && fs.existsSync(externalPath)) {
      candidates.push({ label: `the copy at ${externalPath}`, at: fs.statSync(externalPath).mtimeMs, read: () => fs.readFileSync(externalPath) })
    }
    for (const v of listVersions(id)) candidates.push({ label: `the version from ${when(v.createdAt)}`, at: v.createdAt, read: () => readVersion(id, v.id).payload })
    for (const bk of listBackups(id)) candidates.push({ label: `the backup from ${when(bk.savedAt)}`, at: bk.savedAt, read: () => fs.readFileSync(bk.file) })
    candidates.sort((a, b) => b.at - a.at)

    const kept = quarantine(file, id)
    fs.rmSync(path.join(boardsDir(), `${id}.json`), { force: true })
    for (const c of candidates) {
      try {
        const bytes = c.read()
        const { board } = Board.fromBytes(id, bytes)
        board.externalPath = externalPath
        board.saveNow(true)
        this.safety.onRecovered(board, c.label)
        const ago = Date.now() - c.at
        this.notices.add({
          id: `recovered:${id}`,
          kind: 'recovered',
          level: 'warning',
          boardId: id,
          boardTitle: board.title,
          title: `“${board.title}” was damaged and has been restored`,
          detail: `The board file couldn’t be read (${reason}). It was restored from ${c.label}${ago > 60_000 ? ` — edits made after that may be missing` : ''}. The damaged file was kept.`,
          file: kept,
        })
        return board
      } catch {
        // try the next newest copy
      }
    }
    this.notices.add({
      id: `unreadable:${id}`,
      kind: 'unreadable',
      level: 'error',
      boardId: id,
      title: 'A board couldn’t be opened',
      detail: `The board file is damaged (${reason}) and no good version or backup was found. The file was moved aside so nothing overwrites it.`,
      file: kept,
    })
    return null
  }

  add(b: Board) {
    this.boards.set(b.id, b)
    this.safety.attach(b)
    this.onBoardAdded?.(b)
    return b
  }

  create(title: string) {
    return this.add(Board.create(title))
  }

  delete(id: string) {
    const b = this.boards.get(id)
    if (!b) return false
    this.safety.beforeDelete(b)
    b.remove()
    this.boards.delete(id)
    return true
  }

  get(id: string) {
    return this.boards.get(id)
  }

  all() {
    return [...this.boards.values()].sort(
      (a, b) => ((b.meta.get('updatedAt') as number) ?? 0) - ((a.meta.get('updatedAt') as number) ?? 0),
    )
  }

  find(ref: string) {
    const direct = this.boards.get(ref)
    if (direct) return direct
    const needle = ref.trim().toLowerCase()
    return this.all().find((b) => b.title.trim().toLowerCase() === needle)
  }

  /** Write every board with unsaved edits. Synchronous, so it is safe in exit handlers. */
  flush() {
    let ok = true
    for (const b of this.boards.values()) ok = b.saveNow() && ok
    return ok
  }
}
