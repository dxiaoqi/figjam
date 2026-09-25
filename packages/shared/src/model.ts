import type { RouteStyle } from './routing'
import type { ColorToken, SizeToken } from './tokens'

export type BlockKind = 'sticky' | 'card' | 'text' | 'frame' | 'image'
export const BLOCK_KINDS: BlockKind[] = ['sticky', 'card', 'text', 'frame', 'image']

export interface Author {
  kind: 'human' | 'agent'
  id: string
  name: string
  color?: string
  /** MCP client name (e.g. "claude-code"); ids are per session, so this plus `name` identifies the agent across sessions. */
  client?: string
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
  /** Rendered height the content needs (reported by the canvas, which measures real layout). */
  contentH?: number
  /** Long content shown in full instead of collapsed behind "Show more". */
  expanded?: boolean
  /** Image blocks: id of an entry in the board's `assets` map. */
  asset?: string
  /** Fractional z-index from the canvas; optional for agent-created blocks. */
  index?: string
  author?: Author
  /** Who last edited it (used to keep human edits when undoing an agent). */
  editedBy?: Author
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
  editedBy?: Author
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

export type ChangeSetStatus = 'open' | 'pending' | 'accepted' | 'rejected' | 'partial' | 'undone'

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
  /** Per-item review decisions (block / connector ids). */
  decisions?: { id: string; action: 'accept' | 'reject'; at: number }[]
  /** Entries that were accepted (kept so accepted work can still be undone by author). */
  accepted?: ChangeEntry[]
  undoneAt?: number
  undoneBy?: string
}

/** A comment thread attached to a block (`threads` map). */
export interface ThreadMessage {
  id: string
  author: Author
  text: string
  createdAt: number
}

export interface Thread {
  id: string
  target: string
  author: Author
  text: string
  createdAt: number
  resolved: boolean
  resolvedAt?: number
  replies: ThreadMessage[]
  /** Where the pin sits on the target, as fractions of its unrotated rect. Default: top-right corner. */
  anchor?: { x: number; y: number }
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
  /** File the board is mirrored to (desktop Open / Save As), if any. */
  path?: string | null
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
  | { type: 'viewport'; bounds: Rect; focused?: boolean }
