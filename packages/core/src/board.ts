import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import * as Y from 'yjs'
import { skillTypeRegistry } from '@aifig/shared'
import type { SkillActivityEntry, Asset, Block, BoardSkill, BoardSummary, ChangeSet, Connector, SkillPermissionRequest, Rect, SkillGrant, Thread, TypeRegistry } from '@aifig/shared'

export const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)

export function aifigHome() {
  return process.env.AIFIG_HOME ?? path.join(os.homedir(), '.aifig')
}

export function boardsDir() {
  return path.join(aifigHome(), 'boards')
}

/** One board = one Yjs document, persisted as `<id>.aifig` (Yjs state) plus a readable `<id>.json` export. */
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
  /** Audit log of skill activity: tool calls, permission decisions, enable/disable. */
  readonly activity = this.doc.getArray<SkillActivityEntry>('activity')
  readonly permissionRequests = this.doc.getMap<SkillPermissionRequest>('permissionRequests')
  readonly skillGrants = this.doc.getMap<SkillGrant>('skillGrants')

  /** Built-in types plus the types of the skills enabled on this board. */
  types(): TypeRegistry {
    return skillTypeRegistry(this.skills.values())
  }
  private saveTimer: NodeJS.Timeout | null = null
  deleted = false
  /** A user-chosen .aifig file (Open / Save As) that every save is mirrored to. */
  externalPath: string | null = null

  constructor(readonly id: string) {
    this.doc.on('update', () => this.scheduleSave())
  }

  get file() {
    return path.join(boardsDir(), `${this.id}.aifig`)
  }

  get title() {
    return (this.meta.get('title') as string) ?? 'Untitled board'
  }

  static load(id: string): Board {
    const b = new Board(id)
    const data = fs.readFileSync(b.file)
    Y.applyUpdate(b.doc, new Uint8Array(data), 'load')
    return b
  }

  static create(title: string): Board {
    const b = new Board(`b${newId()}`)
    b.doc.transact(() => {
      b.meta.set('title', title)
      b.meta.set('createdAt', Date.now())
      b.meta.set('updatedAt', Date.now())
      b.meta.set('format', 'aifig/0')
    })
    b.saveNow()
    return b
  }

  scheduleSave() {
    if (this.deleted) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveNow(), 250)
  }

  saveNow() {
    if (this.deleted) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    fs.mkdirSync(boardsDir(), { recursive: true })
    const tmp = `${this.file}.tmp`
    const state = Y.encodeStateAsUpdate(this.doc)
    fs.writeFileSync(tmp, state)
    fs.renameSync(tmp, this.file)
    if (this.externalPath) {
      try {
        fs.writeFileSync(`${this.externalPath}.tmp`, state)
        fs.renameSync(`${this.externalPath}.tmp`, this.externalPath)
      } catch (e) {
        console.error(`[core] could not write ${this.externalPath}:`, e)
      }
    }
    fs.writeFileSync(path.join(boardsDir(), `${this.id}.json`), JSON.stringify(this.toJSON(), null, 2))
  }

  remove() {
    this.deleted = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    for (const ext of ['.aifig', '.json']) fs.rmSync(path.join(boardsDir(), `${this.id}${ext}`), { force: true })
  }

  touch() {
    this.meta.set('updatedAt', Date.now())
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
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

export class BoardRegistry {
  private boards = new Map<string, Board>()
  onBoardAdded: ((b: Board) => void) | null = null

  private externalIndex() {
    return path.join(aifigHome(), 'external.json')
  }

  private saveExternalIndex() {
    const map: Record<string, string> = {}
    for (const b of this.boards.values()) if (b.externalPath) map[b.id] = b.externalPath
    fs.writeFileSync(this.externalIndex(), JSON.stringify(map, null, 2))
  }

  /** Open a .aifig file from anywhere; saves are mirrored back to it. */
  openFile(file: string): Board {
    const abs = path.resolve(file)
    const open = [...this.boards.values()].find((b) => b.externalPath === abs)
    if (open) return open
    const data = fs.readFileSync(abs)
    const b = new Board(`b${newId()}`)
    Y.applyUpdate(b.doc, new Uint8Array(data), 'load')
    if (!b.meta.get('title')) b.meta.set('title', path.basename(abs, '.aifig'))
    b.externalPath = abs
    b.saveNow()
    this.add(b)
    this.saveExternalIndex()
    return b
  }

  /** Save As: write the board to a file and keep mirroring saves there. */
  saveAs(b: Board, file: string) {
    b.externalPath = path.resolve(file)
    b.saveNow()
    this.saveExternalIndex()
  }

  loadAll() {
    fs.mkdirSync(boardsDir(), { recursive: true })
    let external: Record<string, string> = {}
    try {
      external = JSON.parse(fs.readFileSync(this.externalIndex(), 'utf8'))
    } catch {
      /* none yet */
    }
    for (const f of fs.readdirSync(boardsDir())) {
      if (!f.endsWith('.aifig')) continue
      const id = f.slice(0, -'.aifig'.length)
      try {
        const b = Board.load(id)
        if (external[id]) b.externalPath = external[id]
        this.add(b)
      } catch (e) {
        console.error(`[core] could not load board ${id}:`, e)
      }
    }
  }

  add(b: Board) {
    this.boards.set(b.id, b)
    this.onBoardAdded?.(b)
    return b
  }

  create(title: string) {
    return this.add(Board.create(title))
  }

  delete(id: string) {
    const b = this.boards.get(id)
    if (!b) return false
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

  flush() {
    for (const b of this.boards.values()) b.saveNow()
  }
}
