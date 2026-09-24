import { z } from 'zod'
import { COLOR_TOKENS, SIZE_TOKENS } from './tokens'

/**
 * Canvas API contract. Every surface (MCP, CLI, UI) calls the core with one of these tools.
 * Schemas are zod raw shapes so the MCP server can register them directly.
 */

const board = z
  .string()
  .optional()
  .describe('Board id or title. Defaults to the board currently open in the canvas app.')
const intent = z
  .string()
  .optional()
  .describe('One short sentence describing why you are making this change. Shown to the human reviewer.')
const color = z
  .string()
  .optional()
  .describe(`Color token: ${COLOR_TOKENS.join(', ')}. Hex values are quantized to the nearest token.`)
const size = z.enum(SIZE_TOKENS).optional().describe('Size token: s, m (default), l, xl.')

const routeStyle = z
  .enum(['curved', 'elbow', 'straight'])
  .optional()
  .describe('Connector routing: curved (default, flows around blocks), elbow (right angles, avoids blocks) or straight.')

const blockInput = z.object({
  kind: z
    .enum(['sticky', 'card', 'text'])
    .optional()
    .describe('sticky (default): short thought. card: title + body, for structured items. text: headings and labels.'),
  text: z.string().optional().describe('Sticky/text content, or the card body. Markdown subset allowed: **bold**, *italic*, `code`, [link](url), "- " and "1. " lists.'),
  title: z.string().optional().describe('Card title.'),
  color,
  size,
  group: z.string().optional().describe('Group name, used by layout "cluster" (one column per group, with a heading).'),
  ref: z.string().optional().describe('Local name for this block, so other blocks in the same call can reference it as parent.'),
  parent: z
    .string()
    .optional()
    .describe('For layout "tree": ref of another block in this call, or an existing block id. A connector is drawn parent → child.'),
})

export const toolDefs = {
  list_boards: {
    title: 'List boards',
    description: 'List all local boards with block counts and which one is open in the canvas app.',
    input: {},
  },
  create_board: {
    title: 'Create board',
    description: 'Create a new empty board.',
    input: { title: z.string().describe('Board title') },
  },
  get_board: {
    title: 'Read board',
    description:
      'Read a board as an outline: frames, blocks (id, kind, text, color, bounds) and connectors. Call this first to understand the canvas before writing.',
    input: {
      board,
      frame: z.string().optional().describe('Only read this frame (id or title).'),
      format: z.enum(['markdown', 'json']).optional().describe('markdown (default, compact) or json (full detail).'),
    },
  },
  create_blocks: {
    title: 'Create blocks',
    description: [
      'Add stickies, cards or text to the board. Describe content and structure; the layout engine computes positions,',
      'sizes, spacing and alignment on an 8px grid. Do NOT pass coordinates unless the user asked for exact placement.',
      'Placement: inside an existing frame (`inside`), next to a block (`right_of` / `below`), or in free space near the',
      "user's viewport (default). Pass `frame` to wrap the new blocks in a new titled frame.",
      'Layouts: grid (default), row, stack (vertical), cluster (columns by `group`), tree (uses `parent`, draws connectors).',
      "Changes are grouped into a change set the human can accept or reject; they appear live with the agent's cursor.",
    ].join(' '),
    input: {
      board,
      blocks: z.array(blockInput).min(1).describe('Blocks to create, in reading order.'),
      layout: z.enum(['grid', 'row', 'stack', 'cluster', 'tree']).optional(),
      columns: z.number().int().min(1).max(60).optional().describe('Columns for grid layout.'),
      direction: z.enum(['right', 'down']).optional().describe('Tree direction (default right).'),
      frame: z.string().optional().describe('Wrap the new blocks in a new frame with this title.'),
      inside: z.string().optional().describe('Existing frame id or title to place blocks in (frame grows to fit).'),
      right_of: z.string().optional().describe('Existing block/frame id to place the new blocks to the right of.'),
      below: z.string().optional().describe('Existing block/frame id to place the new blocks below.'),
      at: z.object({ x: z.number(), y: z.number() }).optional().describe('Explicit top-left override (page coords).'),
      intent,
    },
  },
  update_blocks: {
    title: 'Update blocks',
    description: 'Edit text, title, color or size of existing blocks. Sizes are re-measured automatically.',
    input: {
      board,
      updates: z
        .array(
          z.object({
            id: z.string(),
            text: z.string().optional(),
            title: z.string().optional(),
            color,
            size,
            x: z.number().optional().describe('Only when explicitly asked to move a block.'),
            y: z.number().optional(),
            rotation: z.number().optional().describe('Rotation in degrees (snapped to 15° unless precise values are needed).'),
          }),
        )
        .min(1),
      intent,
    },
  },
  delete_blocks: {
    title: 'Delete blocks',
    description: 'Delete blocks or connectors by id. Deleting a frame deletes its contents. Reversible by rejecting the change set.',
    input: { board, ids: z.array(z.string()).min(1), intent },
  },
  connect: {
    title: 'Connect blocks',
    description: 'Draw relation connectors (arrows) between blocks. `from`/`to` accept a block id or its exact text/title.',
    input: {
      board,
      connectors: z
        .array(z.object({ from: z.string(), to: z.string(), label: z.string().optional(), route: routeStyle }))
        .min(1),
      route: routeStyle.describe('Default routing for all connectors in this call.'),
      intent,
    },
  },
  update_connectors: {
    title: 'Update connectors',
    description: 'Change the routing style or label of existing connectors (ids from get_board).',
    input: {
      board,
      ids: z.array(z.string()).min(1),
      route: routeStyle,
      label: z.string().optional(),
      waypoints: z
        .array(z.object({ x: z.number(), y: z.number() }))
        .optional()
        .describe('Manual waypoints (page coordinates) for elbow connectors; pass [] to go back to automatic routing.'),
      intent,
    },
  },
  add_image: {
    title: 'Add image',
    description:
      'Place an image (PNG, JPEG, GIF or WebP) on the board. It is stored inside the board file. Provide a local file path, an http(s) URL, or base64 data. Placement works like create_blocks.',
    input: {
      board,
      path: z.string().optional().describe('Absolute path to a local image file.'),
      url: z.string().optional().describe('http(s) URL to download.'),
      data: z.string().optional().describe('Base64-encoded image bytes (with mime).'),
      mime: z.string().optional(),
      width: z.number().optional().describe('Display width in px (default: natural size, max 480).'),
      caption: z.string().optional(),
      inside: z.string().optional(),
      right_of: z.string().optional(),
      below: z.string().optional(),
      at: z.object({ x: z.number(), y: z.number() }).optional(),
      intent,
    },
  },
  group_into_frame: {
    title: 'Group into frame',
    description: 'Wrap existing top-level blocks in a new titled frame, keeping their arrangement.',
    input: { board, ids: z.array(z.string()).min(1), title: z.string(), intent },
  },
  arrange: {
    title: 'Arrange blocks',
    description: 'Re-lay out existing sibling blocks with a layout intent, anchored at their current top-left.',
    input: {
      board,
      ids: z.array(z.string()).min(1),
      layout: z.enum(['grid', 'row', 'stack']),
      columns: z.number().int().min(1).max(12).optional(),
      intent,
    },
  },
  tidy: {
    title: 'Tidy',
    description: 'Snap to the 8px grid, align rows, even out spacing and remove overlaps in a frame (or the whole board). Frames resize to fit.',
    input: { board, frame: z.string().optional().describe('Frame id or title; omit for top level.'), intent },
  },
  lint_layout: {
    title: 'Lint layout',
    description: 'Check for overlaps, overflowing text, blocks outside frames, off-grid positions and too many colors. Run before finishing.',
    input: { board, frame: z.string().optional() },
  },
  render_snapshot: {
    title: 'Render snapshot',
    description: 'Render the board (or one frame, or specific blocks) to an image so you can visually review your work.',
    input: {
      board,
      frame: z.string().optional(),
      ids: z.array(z.string()).optional().describe('Only render these blocks (and connectors between them).'),
      format: z.enum(['png', 'svg']).optional().describe('png (default) or svg'),
      theme: z.enum(['light', 'dark']).optional(),
    },
  },
  set_status: {
    title: 'Set status',
    description: 'Show a short status next to your cursor on the canvas, e.g. "Clustering interview notes…". Pass an empty string to clear.',
    input: { board, status: z.string() },
  },
  begin_change_set: {
    title: 'Begin change set',
    description: 'Group all following edits into one reviewable change set until commit_change_set. Optional — each write call otherwise gets its own.',
    input: { board, intent: z.string().describe('What this round of edits is for.') },
  },
  commit_change_set: {
    title: 'Commit change set',
    description: 'Finish the open change set and hand it to the human for review.',
    input: { board },
  },
  list_change_sets: {
    title: 'List change sets',
    description: 'See your change sets and whether the human accepted or rejected them (with reasons).',
    input: { board, status: z.enum(['open', 'pending', 'accepted', 'rejected']).optional() },
  },
  get_design_tokens: {
    title: 'Design tokens',
    description: 'The allowed colors, sizes and spacing. Blocks can only use these values.',
    input: {},
  },
} as const

export type ToolName = keyof typeof toolDefs

/** Tools callable by the canvas app / CLI but not exposed to agents over MCP. */
export const humanToolDefs = {
  review_change_set: {
    input: {
      board,
      id: z.string().describe('Change set id, or "all" for every pending change set'),
      action: z.enum(['accept', 'reject']),
      reason: z.string().optional(),
    },
  },
  rename_board: { input: { board, title: z.string() } },
  delete_board: { input: { board: z.string() } },
} as const

export type HumanToolName = keyof typeof humanToolDefs
export type AnyToolName = ToolName | HumanToolName

export interface CallerInfo {
  /** Stable id per agent session, e.g. "claude-code:4211". */
  id: string
  name: string
  client: string
  kind: 'human' | 'agent'
}

export interface CallRequest {
  tool: AnyToolName
  args: Record<string, unknown>
  caller: CallerInfo
}

export type CallResponse =
  | { ok: true; result: unknown; image?: { mimeType: string; data: string } }
  | { ok: false; error: string }

const env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {}
export const CORE_PORT = Number(env.AIFIG_CORE_PORT ?? 47821)
export const UI_PORT = Number(env.AIFIG_UI_PORT ?? 47820)
