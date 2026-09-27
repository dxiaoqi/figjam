import type { RouteStyle } from './routing'
import type { ColorToken, SizeToken } from './tokens'
import type { WebSnippet } from './snippet'
import type { FieldValue, Relation, TypeId } from './types'

export type BlockKind = 'sticky' | 'card' | 'text' | 'frame' | 'image' | 'web' | 'video'
export const BLOCK_KINDS: BlockKind[] = ['sticky', 'card', 'text', 'frame', 'image', 'web', 'video']

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
  /** Built-in block type (stickies and cards). Untyped blocks are plain. */
  type?: TypeId
  /**
   * Field values per type. Demoting keeps them, so promoting back restores them; `_color` remembers the
   * block's own color from before it was first typed.
   */
  typeData?: Record<string, Record<string, FieldValue>>
  /** Text blocks placed by a matrix layout as row / column labels (replaced on the next matrix tidy). */
  layoutRole?: 'axis'
  /** Rendered height the content needs (reported by the canvas, which measures real layout). */
  contentH?: number
  /** Long content shown in full instead of collapsed behind "Show more". */
  expanded?: boolean
  /** Web snippet blocks: an embedded URL or inline HTML/CSS/JS (see snippet.ts). */
  web?: WebSnippet
  /** Image and video blocks: id of an entry in the board's `assets` map. */
  asset?: string
  /** Video blocks: poster image (asset id), shown until the video plays. */
  poster?: string
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
  /** Optional meaning between typed blocks, e.g. a quote *supports* an insight. */
  relation?: Relation
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

/** What an asset is for; decides how it is listed and opened. */
export type AssetRole = 'image' | 'video' | 'poster' | 'preview' | 'snippet-html' | 'snippet-css' | 'snippet-js'

/**
 * A file the board uses (`assets` map). The bytes live next to the board as `<sha256>.<ext>` in its assets
 * folder (see packages/core/src/assets.ts), so identical files are stored once and history and backups
 * refer to them instead of copying them.
 */
export interface Asset {
  id: string
  /** SHA-256 of the file (hex); with `ext` it names the file in the assets folder. */
  hash: string
  ext: string
  mime: string
  size: number
  role: AssetRole
  /** Natural size of images, posters and videos. */
  w?: number
  h?: number
  /** Seconds (videos). */
  duration?: number
  name?: string
  createdAt: number
}

/** Schema 1.x kept asset bytes inside the document; the 2.0 migration moves them to files. */
export interface LegacyAsset {
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
/** A snippet's working-copy file was saved in an editor and applied, sent to review, or refused. */
export interface SnippetFileEvent {
  type: 'snippet-file'
  boardId: string
  blockId: string
  file: string
  status: 'applied' | 'review' | 'error'
  by: string
  changeSet?: string | null
  message?: string
}

export type ServerMessage =
  | { type: 'presence'; agents: AgentPresence[] }
  | { type: 'board-deleted'; boardId: string }
  | SnippetFileEvent
  | import('./security').SecurityServerMessage

export type ClientMessage =
  | { type: 'viewport'; bounds: Rect; focused?: boolean }
