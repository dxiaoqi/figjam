import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import * as Y from 'yjs'
import type { Block, BoardSummary, ChangeSet, Connector, Rect } from '../shared/model'

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
  private saveTimer: NodeJS.Timeout | null = null
  deleted = false

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
    fs.writeFileSync(tmp, Y.encodeStateAsUpdate(this.doc))
    fs.renameSync(tmp, this.file)
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
    }
  }

  summary(): BoardSummary {
    return {
      id: this.id,
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

  loadAll() {
    fs.mkdirSync(boardsDir(), { recursive: true })
    for (const f of fs.readdirSync(boardsDir())) {
      if (!f.endsWith('.aifig')) continue
      const id = f.slice(0, -'.aifig'.length)
      try {
        this.add(Board.load(id))
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
