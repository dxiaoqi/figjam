import fs from 'node:fs'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import * as Y from 'yjs'
import { assetFileName, assetIdFor, skillTypeRegistry, type AssetRole, type WebSnippet } from '@aifig/shared'
import type { Asset, Block, BoardSkill, BoardSummary, ChangeSet, Connector, Rect, Thread, TypeRegistry } from '@aifig/shared'
import { AssetStore, siblingAssetsDir } from './assets'
import { cleanStaleTemps, writeFileAtomic } from './atomic'
import { backupFile, backupPools, listBackups, quarantine } from './backups'
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
import { readableCopies } from './readable-copy'
import { DataSafety } from './safety'
import { listVersions, migrateHistory, readVersion } from './versions'

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
/** Metadata of a new asset (the rest — id, hash, size, ext — comes from the file). */
export interface AssetMeta {
  mime: string
  ext: string
  role: AssetRole
  name?: string
  w?: number
  h?: number
  duration?: number
}

export function assetsDirFor(boardId: string) {
  return path.join(boardsDir(), `${boardId}.assets`)
}

export interface ChangeCounts {
  added: number
  removed: number
  updated: number
}

/**
 * One board = one Yjs document, persisted as `<id>.aifig` (checksummed container, see fileformat.ts), its
 * files in `<id>.assets/` (content-addressed, see assets.ts), plus a readable `<id>.json` copy (debounced,
 * built off the event loop; see readable-copy.ts). Saves are coalesced and atomic. A board opened from or
 * saved to a user file (`Name.aifig`) mirrors every save there, with its files in `Name.assets/` next to it.
 */
export class Board {
  readonly doc = new Y.Doc()
  readonly meta = this.doc.getMap<unknown>('meta')
  readonly blocks = this.doc.getMap<Block>('blocks')
  readonly connectors = this.doc.getMap<Connector>('connectors')
  readonly changeSets = this.doc.getMap<ChangeSet>('changeSets')
  readonly assets = this.doc.getMap<Asset>('assets')
  readonly threads = this.doc.getMap<Thread>('threads')
  /** Skills enabled on this board (snapshots, so types render without the skill folder). */
  readonly skills = this.doc.getMap<BoardSkill>('skills')

  /** Built-in types plus the types of the skills enabled on this board. */
  types(): TypeRegistry {
    return skillTypeRegistry(this.skills.values())
  }
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
  /** Other places a missing asset file may still be found (the registry adds backups and other boards). */
  static fallbackStores: (b: Board) => AssetStore[] = () => []
  private storeCache: AssetStore | null = null
  /** Files known to be in the external `Name.assets/` folder already. */
  private mirrored = new Set<string>()

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

  get assetsDir() {
    return assetsDirFor(this.id)
  }

  /** The board's own asset files. */
  get store() {
    if (!this.storeCache || this.storeCache.dir !== this.assetsDir) this.storeCache = new AssetStore(this.assetsDir)
    return this.storeCache
  }

  /** `Name.assets/` next to the user's `Name.aifig` (Open / Save As), if there is one. */
  get externalStore() {
    return this.externalPath ? new AssetStore(siblingAssetsDir(this.externalPath)) : null
  }

  /** Asset files the document refers to, as `<sha256>.<ext>`. */
  assetFiles(): string[] {
    const out = new Set<string>()
    for (const a of this.assets.values()) if (a?.hash) out.add(assetFileName(a))
    return [...out]
  }

  /**
   * Put bytes into the assets folder and the `assets` map (reusing the entry when the same file is already
   * there). Call inside the caller's transaction to make the entry part of its edit.
   */
  putAsset(bytes: Uint8Array, meta: AssetMeta): Asset {
    const { hash } = this.store.put(bytes, meta.ext)
    return this.recordAsset(hash, bytes.byteLength, meta)
  }

  /** Same as putAsset for a file on disk (linked or copied, never read into memory whole). */
  importAssetFile(file: string, meta: AssetMeta): Asset {
    const { hash, size } = this.store.importFile(file, meta.ext)
    return this.recordAsset(hash, size, meta)
  }

  /** A finished upload (a temp file in the assets folder, hashed while it was written). */
  adoptAssetFile(tmp: string, hash: string, size: number, meta: AssetMeta): Asset {
    this.store.adopt(tmp, hash, meta.ext)
    return this.recordAsset(hash, size, meta)
  }

  private recordAsset(hash: string, size: number, meta: AssetMeta): Asset {
    const id = assetIdFor(hash)
    const existing = this.assets.get(id)
    if (existing?.hash === hash) return existing
    const asset: Asset = { id, hash, size, ...meta, createdAt: Date.now() }
    for (const k of Object.keys(asset) as (keyof Asset)[]) if (asset[k] === undefined) delete asset[k]
    this.assets.set(id, asset)
    return asset
  }

  /**
   * Path of an asset's file, or null when it can't be found. A file missing here but found elsewhere (the
   * external folder, a backup, another board — same hash, same bytes) is linked back in first.
   */
  assetPath(ref: string | Asset | undefined): string | null {
    const a = typeof ref === 'string' ? this.assets.get(ref) : ref
    if (!a?.hash) return null
    if (this.store.has(a.hash, a.ext)) return this.store.file(a.hash, a.ext)
    const elsewhere = [this.externalStore, ...Board.fallbackStores(this)].filter((s): s is AssetStore => !!s && s.dir !== this.store.dir)
    for (const s of elsewhere) {
      if (!s.has(a.hash, a.ext)) continue
      try {
        if (s.verify(a.hash, a.ext) && s.copyTo(this.store, a.hash, a.ext)) return this.store.file(a.hash, a.ext)
      } catch {
        return s.file(a.hash, a.ext)
      }
    }
    return null
  }

  readAsset(ref: string | Asset | undefined): Buffer | null {
    const p = this.assetPath(ref)
    try {
      return p ? fs.readFileSync(p) : null
    } catch {
      return null
    }
  }

  readAssetText(ref: string | undefined) {
    return ref ? (this.readAsset(ref)?.toString('utf8') ?? '') : ''
  }

  /** Inline snippet source as text, from its files (or from a 1.x-style inline snippet). */
  snippetSource(web: WebSnippet | undefined): { html: string; css: string; js: string } {
    if (!web || web.mode !== 'inline') return { html: '', css: '', js: '' }
    if (!web.src) return { html: web.html ?? '', css: web.css ?? '', js: web.js ?? '' }
    return { html: this.readAssetText(web.src.html), css: this.readAssetText(web.src.css), js: this.readAssetText(web.src.js) }
  }

  /** Copy asset files the external `Name.assets/` folder doesn't have yet. */
  syncExternalAssets() {
    const ext = this.externalStore
    if (!ext) return
    for (const a of this.assets.values()) {
      if (!a?.hash) continue
      const name = assetFileName(a)
      if (this.mirrored.has(`${ext.dir}/${name}`)) continue
      try {
        if (ext.has(a.hash, a.ext) || (this.assetPath(a) && this.store.copyTo(ext, a.hash, a.ext))) this.mirrored.add(`${ext.dir}/${name}`)
      } catch (e) {
        console.error(`[core] could not copy ${name} to ${ext.dir}:`, e)
      }
    }
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
  static fromBytes(id: string, data: Uint8Array, file?: string, opts: { persist?: boolean; store?: AssetStore } = {}): { board: Board; migration: MigrationResult; savedAt: number | null } {
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
    const store = opts.store ?? new AssetStore(assetsDirFor(id))
    const migration = migrate(b.doc, decoded.schema, undefined, undefined, { putFile: (bytes, ext) => store.put(bytes, ext).hash })
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

  encode(payload = Y.encodeStateAsUpdate(this.doc)) {
    return encodeContainer(payload, { savedAt: Date.now(), board: this.id, title: this.title, schema: this.schemaLabel, assets: this.assetFiles() })
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
      const payload = Y.encodeStateAsUpdate(this.doc)
      const bytes = this.encode(payload)
      writeFileAtomic(this.file, bytes)
      this.dirty = false
      this.pending = { added: 0, removed: 0, updated: 0 }
      this.updatedKeys.clear()
      this.lastSavedAt = Date.now()
      if (this.externalPath) {
        try {
          writeFileAtomic(this.externalPath, bytes)
          this.syncExternalAssets()
        } catch (e) {
          console.error(`[core] could not write ${this.externalPath}:`, e)
        }
      }
      readableCopies.schedule(this, payload)
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
    fs.rmSync(this.file, { force: true })
    readableCopies.remove(this.jsonFile)
    for (const f of this.store.list()) this.store.remove(f.hash, f.ext)
    fs.rmSync(this.assetsDir, { recursive: true, force: true })
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
      assets: [...this.assets.values()],
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

  constructor() {
    Board.fallbackStores = (b) => [
      ...backupPools(b.id).map((dir) => new AssetStore(dir)),
      ...[...this.boards.values()].filter((o) => o !== b).flatMap((o) => [o.store, o.externalStore].filter((s): s is AssetStore => !!s)),
    ]
  }

  /**
   * Bring in the files a board from a user file needs: from `Name.assets/` next to it, or the `assets/` pool
   * when it is a backup. Hash-checked, so a file whose bytes don't match its name is never taken in.
   */
  private importSiblingAssets(b: Board, file: string) {
    const sources = [new AssetStore(siblingAssetsDir(file)), new AssetStore(path.join(path.dirname(file), 'assets'))]
    for (const a of b.assets.values()) {
      if (!a?.hash || b.store.has(a.hash, a.ext)) continue
      for (const src of sources) {
        if (!src.has(a.hash, a.ext)) continue
        try {
          b.store.importFile(src.file(a.hash, a.ext), a.ext, a.hash)
          break
        } catch (e) {
          console.error(`[core] skipped ${assetFileName(a)} from ${src.dir}: ${(e as Error).message}`)
        }
      }
    }
  }

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
    this.importSiblingAssets(b, abs)
    if (!b.meta.get('title')) b.meta.set('title', path.basename(abs, '.aifig'))
    if (migration.applied.length) backupFile(b.id, b.title, data, `before-format-${formatSchema(migration.from)}`)
    b.externalPath = abs
    b.saveNow(true)
    this.add(b)
    this.saveExternalIndex()
    return b
  }

  /** A new board with a copy of a file's content (the file itself is not linked or changed). */
  importCopy(file: string, title?: string): Board {
    const { board: b } = Board.fromBytes(`b${newId()}`, fs.readFileSync(path.resolve(file)), path.resolve(file))
    this.importSiblingAssets(b, path.resolve(file))
    b.doc.transact(() => {
      if (title) b.meta.set('title', title)
      b.meta.set('createdAt', Date.now())
      b.meta.set('updatedAt', Date.now())
    })
    b.saveNow(true)
    this.add(b)
    return b
  }

  /** Save As: write the board to a file and keep mirroring saves there. */
  saveAs(b: Board, file: string) {
    b.externalPath = path.resolve(file)
    b.saveNow(true)
    b.syncExternalAssets()
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
        try {
          const n = migrateHistory(id, board.store)
          if (n) console.error(`[core] moved the files of ${n} version${n === 1 ? '' : 's'} of “${board.title}” to its assets folder`)
        } catch (e) {
          console.error(`[core] history of ${id} not migrated (it still opens as is):`, e)
        }
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
    readableCopies.remove(path.join(boardsDir(), `${id}.json`))
    for (const c of candidates) {
      try {
        const bytes = c.read()
        const { board } = Board.fromBytes(id, bytes)
        board.externalPath = externalPath
        board.saveNow(true)
        this.safety.onRecovered(board, c.label)
        this.notices.add({
          id: `recovered:${id}`,
          kind: 'recovered',
          level: 'warning',
          boardId: id,
          boardTitle: board.title,
          title: `“${board.title}” was damaged and has been restored`,
          detail: `The board file couldn’t be read (${reason}). It was restored from ${c.label}; edits made after that may be missing. The damaged file was kept.`,
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
    readableCopies.flushSync()
    return ok
  }
}
