import type { Block, Connector } from './model'

/** Why a version was taken. Checkpoints are named by a person or agent and never pruned automatically. */
export type VersionKind = 'auto' | 'checkpoint' | 'before-restore' | 'recovered' | 'opened'

export interface VersionInfo {
  id: string
  boardId: string
  kind: VersionKind
  /** Checkpoint name, or a short description for automatic versions. */
  name: string
  createdAt: number
  blockCount: number
  connectorCount: number
  /** Bytes on disk. */
  size: number
  /** Who asked for it (checkpoints and restores). */
  by?: string
}

export type NoticeKind = 'recovered' | 'unreadable' | 'future-version' | 'save-failed'

/** Something the person must hear about their data (shown as a banner until dismissed). */
export interface DataNotice {
  id: string
  kind: NoticeKind
  level: 'warning' | 'error'
  boardId?: string
  boardTitle?: string
  title: string
  detail: string
  /** Where a damaged or unreadable file was kept. */
  file?: string
  createdAt: number
}

export interface RestorePlan {
  upsertBlocks: Block[]
  deleteBlocks: string[]
  upsertConnectors: Connector[]
  deleteConnectors: string[]
}

export interface DiffSummary {
  added: number
  removed: number
  changed: number
}

type Entity = { id: string; pending?: boolean; changeSet?: string | null }

/** Restored content is plain content: suggestion state from back then no longer means anything. */
function settle<T extends Entity>(v: T): T {
  return { ...v, pending: false, changeSet: null }
}

function comparable(v: Entity) {
  const { pending: _p, changeSet: _c, updatedAt: _u, editedBy: _e, ...rest } = v as Entity & { updatedAt?: number; editedBy?: unknown }
  return JSON.stringify(rest, Object.keys(rest).sort())
}

function planMap<T extends Entity>(current: Iterable<T>, target: Iterable<T>) {
  const cur = new Map([...current].map((v) => [v.id, v]))
  const want = new Map([...target].map((v) => [v.id, v]))
  const upsert: T[] = []
  const remove: string[] = []
  for (const [id, v] of want) {
    const now = cur.get(id)
    if (!now || now.pending || comparable(now) !== comparable(v)) upsert.push(settle(v))
  }
  for (const id of cur.keys()) if (!want.has(id)) remove.push(id)
  return { upsert, remove }
}

/**
 * The edits that turn the current board into a version. Apply upserts before deletes: once parents and
 * endpoints are restored, deleting what's left never cascades into restored content.
 */
export function planRestore(current: { blocks: Iterable<Block>; connectors: Iterable<Connector> }, target: { blocks: Iterable<Block>; connectors: Iterable<Connector> }): RestorePlan {
  const b = planMap(current.blocks, target.blocks)
  const c = planMap(current.connectors, target.connectors)
  return { upsertBlocks: b.upsert, deleteBlocks: b.remove, upsertConnectors: c.upsert, deleteConnectors: c.remove }
}

/** Blocks added / removed / changed going from `from` to `to`. */
export function diffBlocks(from: Iterable<Block>, to: Iterable<Block>): DiffSummary {
  const a = new Map([...from].map((v) => [v.id, v]))
  const b = new Map([...to].map((v) => [v.id, v]))
  let added = 0
  let removed = 0
  let changed = 0
  for (const [id, v] of b) {
    const old = a.get(id)
    if (!old) added++
    else if (comparable(old) !== comparable(v)) changed++
  }
  for (const id of a.keys()) if (!b.has(id)) removed++
  return { added, removed, changed }
}

export function isEmptyPlan(p: RestorePlan) {
  return !p.upsertBlocks.length && !p.deleteBlocks.length && !p.upsertConnectors.length && !p.deleteConnectors.length
}
