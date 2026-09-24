import type { RouteStyle } from './routing'
import type { ColorToken, SizeToken } from './tokens'

export type BlockKind = 'sticky' | 'card' | 'text' | 'frame' | 'image'
export const BLOCK_KINDS: BlockKind[] = ['sticky', 'card', 'text', 'frame', 'image']

export interface Author {
  kind: 'human' | 'agent'
  id: string
  name: string
  color?: string
}

/**
 * A block as stored in the board's Yjs document (`blocks` map).
 * `x`/`y` are relative to the parent frame when `parent` is set, else page coordinates.
 */
export interface Block {
  id: string
  kind: BlockKind
  x: number
  y: number
  w: number
  h: number
  parent?: string | null
  /** Body text (sticky / card body / text / image caption). Supports a Markdown subset: **bold**, *italic*, `code`, [links](url), - lists, 1. lists. */
  text: string
  /** Card title or frame title. */
  title?: string
  color: ColorToken
  size: SizeToken
  /** Degrees clockwise around the block center. */
  rotation?: number
  /** Image blocks: id of an entry in the board's `assets` map. */
  asset?: string
  /** Fractional z-index from the canvas; optional for agent-created blocks. */
  index?: string
  author?: Author
  /** Pending (suggested) change set this block belongs to. */
  changeSet?: string | null
  pending?: boolean
  createdAt: number
  updatedAt: number
}

export interface Point {
  x: number
  y: number
}

export interface Connector {
  id: string
  from?: string | null
  to?: string | null
  /** Page-space endpoints used when an end is not attached to a block. */
  fromPoint?: Point | null
  toPoint?: Point | null
  label?: string
  /** Routing style; defaults to curved. */
  route?: RouteStyle
  /** Manual waypoints (page space) for elbow routes. */
  waypoints?: Point[] | null
  author?: Author
  changeSet?: string | null
  pending?: boolean
  createdAt: number
  updatedAt: number
}

export type ChangeEntry =
  | { op: 'create'; target: 'block' | 'connector'; id: string }
  | { op: 'update'; target: 'block' | 'connector'; id: string; before: Block | Connector }
  | { op: 'delete'; target: 'block' | 'connector'; id: string; before: Block | Connector }

export type ChangeSetStatus = 'open' | 'pending' | 'accepted' | 'rejected'

export interface ChangeSet {
  id: string
  author: Author
  intent: string
  status: ChangeSetStatus
  entries: ChangeEntry[]
  createdAt: number
  updatedAt: number
  resolvedAt?: number
  resolvedReason?: string
}

/** Binary asset stored inside the board document (`assets` map). */
export interface Asset {
  id: string
  mime: string
  w: number
  h: number
  bytes: Uint8Array
  name?: string
  createdAt: number
}

export interface BoardSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  blockCount: number
  pendingChangeSets: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface AgentPresence {
  id: string
  name: string
  client: string
  color: string
  boardId: string | null
  status: string | null
  /** Page-space point the agent is "looking at". */
  cursor: Point | null
  /** Page-space region the agent is working in. */
  focus: Rect | null
  lastActive: number
}

/** JSON (text) messages on the sync websocket. Binary frames carry the Yjs sync protocol. */
export type ServerMessage =
  | { type: 'presence'; agents: AgentPresence[] }
  | { type: 'board-deleted'; boardId: string }

export type ClientMessage =
  | { type: 'viewport'; bounds: Rect }
