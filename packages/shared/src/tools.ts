import { z } from 'zod'
import { COLOR_TOKENS, SIZE_TOKENS } from './tokens'
import { RELATIONS } from './types'

/**
 * Canvas API contract. Every surface (MCP, CLI, UI) calls the core with one of these tools.
 * Schemas are zod raw shapes so the MCP server can register them directly.
 */

const board = z
  .string()
  .optional()
  .describe(
    'Board id or title. Recommended: always pass it. Without it the core uses the board this session last used, else the board open in the canvas (and returns a warning when that is ambiguous).',
  )
const strict = z.boolean().optional().describe('Fail instead of adjusting silently-fixable input (e.g. unknown colors). Default false: adjustments are listed in `warnings`.')
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

const blockType = z.string().describe('Built-in type (insight, question, quote, hypothesis, idea, todo) or a skill type enabled on the board (e.g. research.quote; see list_types / list_skills).')
const typeFieldsInput = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
const relation = z.string().optional().describe(`Optional meaning (${RELATIONS.join(', ')}, or a verb a skill declares), e.g. a quote "supports" an insight. Suggested automatically between typed blocks.`)

const blockInput = z.object({
  kind: z
    .enum(['sticky', 'card', 'text'])
    .optional()
    .describe('sticky (default): short thought. card: title + body, for structured items. text: headings and labels.'),
  text: z.string().optional().describe('Sticky/text content, or the card body. Markdown subset allowed: **bold**, *italic*, `code`, [link](url), "- " and "1. " lists.'),
  title: z.string().optional().describe('Card title.'),
  color,
  size,
  type: blockType.optional().describe('Optional built-in type (see list_types): insight, question, quote, hypothesis, idea, todo. Sets the color and icon.'),
  fields: typeFieldsInput.optional().describe('Field values for the type, e.g. {"status":"unverified"} for a hypothesis (see list_types).'),
  group: z.string().optional().describe('Group name, used by layout "cluster" (one column per group, with a heading).'),
  row: z.string().optional().describe('Layout "matrix": row label.'),
  col: z.string().optional().describe('Layout "matrix": column label.'),
  date: z.string().optional().describe('Layout "timeline": date or sortable label (e.g. 2026-03, Q2, v1.4).'),
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
      layout: z.enum(['grid', 'row', 'stack', 'cluster', 'tree', 'matrix', 'timeline', 'flow']).optional().describe('grid, row, stack, cluster (by `group`), tree (by `parent`), matrix (by `row` × `col`), timeline (ordered by `date`), flow (steps in order, joined by arrows).'),
      columns: z.number().int().min(1).max(60).optional().describe('Columns for grid layout.'),
      direction: z.enum(['right', 'down']).optional().describe('Tree direction (default right).'),
      frame: z.string().optional().describe('Wrap the new blocks in a new frame with this title.'),
      inside: z.string().optional().describe('Existing frame id or title to place blocks in (frame grows to fit).'),
      right_of: z.string().optional().describe('Existing block/frame id to place the new blocks to the right of.'),
      below: z.string().optional().describe('Existing block/frame id to place the new blocks below.'),
      at: z.object({ x: z.number(), y: z.number() }).optional().describe('Explicit top-left override (page coords, snapped to the 8px grid). Ignored with `inside`.'),
      intent,
      strict,
    },
  },
  update_blocks: {
    title: 'Update blocks',
    description:
      'Edit text, title, color, size, position or rotation of existing blocks. Sizes are re-measured automatically. Positions snap to the 8px grid and rotation to 15° unless `snap: false`; any adjustment is reported in `warnings`.',
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
            rotation: z.number().optional().describe('Rotation in degrees, snapped to 15° (pass `snap: false` for exact values).'),
          }),
        )
        .min(1),
      snap: z.boolean().optional().describe('Default true: x/y snap to the 8px grid and rotation to 15°. false keeps exact values.'),
      intent,
      strict,
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
        .array(z.object({ from: z.string(), to: z.string(), label: z.string().optional(), route: routeStyle, relation }))
        .min(1)
        .optional()
        .describe('Several connectors. For a single one you can instead pass `from` / `to` (/ `label`, `relation`) at the top level.'),
      from: z.string().optional(),
      to: z.string().optional(),
      label: z.string().optional(),
      relation,
      route: routeStyle.describe('Default routing for all connectors in this call.'),
      intent,
    },
  },
  update_connectors: {
    title: 'Update connectors',
    description:
      'Change the routing style, label or waypoints of existing connectors (ids from get_board). Either apply the same change to `ids`, or pass per-connector changes in `connectors: [{ id, route, label, waypoints }]` (the same array shape as `connect`).',
    input: {
      board,
      ids: z.array(z.string()).min(1).optional(),
      connectors: z
        .array(z.object({ id: z.string(), route: routeStyle, label: z.string().optional(), relation: z.string().optional(), waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional() }))
        .min(1)
        .optional(),
      route: routeStyle,
      label: z.string().optional(),
      relation: z.string().optional().describe('Set the relation, or "none" to clear it.'),
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
      layout: z.enum(['grid', 'row', 'stack', 'matrix', 'timeline', 'flow']),
      columns: z.number().int().min(1).max(12).optional(),
      rows_field: z.string().optional().describe('matrix: field of typed blocks for rows ("type" for the block type).'),
      cols_field: z.string().optional().describe('matrix: field for columns.'),
      date_field: z.string().optional().describe('timeline: field with the date; blocks without it keep their order.'),
      intent,
    },
  },
  tidy: {
    title: 'Tidy',
    description: 'Snap to the 8px grid, align rows, even out spacing and remove overlaps in a frame (or the whole board). Frames resize to fit.',
    input: {
      board,
      frame: z.string().optional().describe('Frame id or title; omit for top level.'),
      by: z.enum(['position', 'type', 'matrix']).optional().describe('position (default): keep rows. type: group blocks by type. matrix: rows = types, columns = values of `matrix_field`.'),
      matrix_field: z.string().optional().describe('Field for matrix columns, e.g. "status" (hypotheses) or "done" (todos).'),
      intent,
    },
  },
  create_snippet: {
    title: 'Create web snippet',
    description: [
      'Add a web snippet block: either an embedded https URL (YouTube, Figma prototype, CodePen, Loom, Google Slides, …)',
      'or an inline HTML/CSS/JS snippet you write (a small interactive demo, chart or prototype).',
      'Snippets show a static preview and only run when a person double-clicks them, in a sandboxed frame on a separate origin.',
      'Inline snippets have NO network access (no fetch, no external scripts/images/fonts — inline everything, use data: URLs)',
      'and cannot see the board. They can keep a small JSON state (≤16 KB) via `await aifig.getState()` / `aifig.setState(obj)`.',
      'Placement works like create_blocks. Goes through change-set review.',
    ].join(' '),
    input: {
      board,
      url: z.string().optional().describe('https URL to embed.'),
      html: z.string().optional().describe('Inline snippet: body HTML.'),
      css: z.string().optional(),
      js: z.string().optional().describe('Runs after the HTML. Syntax is checked on save. Top-level `await` works (the script is then wrapped in an async function, so use addEventListener instead of inline on*= handlers). Runtime errors show in the snippet.'),
      title: z.string().optional().describe('Label on the block badge, in exports and get_board. Defaults to the first <h1>–<h3> or <title> in the html. The preview itself shows whatever your html renders.'),
      width: z.number().optional().describe('Default 480.'),
      height: z.number().optional().describe('Default 320 (270 for 16:9 video).'),
      inside: z.string().optional(),
      right_of: z.string().optional(),
      below: z.string().optional(),
      at: z.object({ x: z.number(), y: z.number() }).optional(),
      intent,
    },
  },
  update_snippet: {
    title: 'Update web snippet',
    description:
      'Change a snippet\'s URL, HTML, CSS, JS or title (only the fields you pass). Goes through change-set review, where the person sees a source diff; the result lists what changed (`changed`, e.g. js: "+3 / −1 lines").',
    input: {
      board,
      id: z.string(),
      url: z.string().optional(),
      html: z.string().optional(),
      css: z.string().optional(),
      js: z.string().optional(),
      title: z.string().optional(),
      intent,
    },
  },
  list_skills: {
    title: 'List skills',
    description:
      'Skills installed on this machine and which are enabled on the board. An enabled skill adds block types (use them in create_blocks / set_type), layouts, prompt templates and actions — read get_skill for its instructions before using it.',
    input: { board },
  },
  get_skill: {
    title: 'Read a skill',
    description: 'A skill\'s instructions (its SKILL.md), block types with fields and card templates, layouts, prompts and actions. Follow the instructions when working with its blocks.',
    input: { name: z.string() },
  },
  apply_skill_layout: {
    title: 'Apply a skill layout',
    description: 'Arrange blocks with one of an enabled skill\'s layouts (e.g. competitor-kit.positioning-matrix). Goes through review.',
    input: { board, layout: z.string().describe('<skill>.<layout> from get_skill'), frame: z.string().optional(), intent },
  },
  run_skill_action: {
    title: 'Run a skill action',
    description:
      'Run an action an enabled skill defines (it calls a tool by name, e.g. web search) on blocks. The first time a skill uses a tool the person is asked in the canvas (the call waits for their answer); results arrive as a change set. Every call is logged.',
    input: { board, skill: z.string(), action: z.string(), ids: z.array(z.string()).min(1).describe('Blocks to run it on') },
  },
  list_types: {
    title: 'List block types',
    description: 'The built-in block types (insight, question, quote, hypothesis, idea, todo) with their fields, colors, prefixes and suggested connector relations.',
    input: {},
  },
  set_type: {
    title: 'Set block type',
    description:
      'Promote stickies/cards to a type (with optional field values), update fields, or demote with type "none". Demoting keeps field values hidden, so promoting back restores them. Types are optional and small; at most a few fields.',
    input: {
      board,
      ids: z.array(z.string()).min(1),
      type: z.string().optional().describe('New type (built-in or an enabled skill type), or "none" to demote to a plain block. Omit to only update fields.'),
      fields: typeFieldsInput.optional(),
      intent,
    },
  },
  query_blocks: {
    title: 'Query blocks',
    description: 'Find blocks by type and field values, e.g. type "hypothesis" where {"status":"unverified"}. Returns ids, text and fields.',
    input: {
      board,
      type: z.string().optional().describe('Built-in or skill type; "none" finds untyped stickies/cards.'),
      where: typeFieldsInput.optional(),
      frame: z.string().optional(),
    },
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
      raw: z.boolean().optional().describe('With format svg: return the SVG markup itself as the text result instead of JSON.'),
      theme: z.enum(['light', 'dark']).optional(),
    },
  },
  export_board: {
    title: 'Export board',
    description: 'Export the board (or one frame) as readable Markdown or structured JSON — for documents, reports or version control.',
    input: {
      board,
      format: z.enum(['markdown', 'json']).describe('markdown (readable document) or json (full structure, no image bytes)'),
      frame: z.string().optional(),
      images: z.enum(['link', 'inline']).optional().describe('Markdown only. link (default): image file names. inline: embed images as data: URIs so the document stands alone.'),
    },
  },
  set_status: {
    title: 'Set status',
    description: 'Show a short status next to your cursor on the canvas, e.g. "Clustering interview notes…". Pass an empty string to clear.',
    input: { board, status: z.string() },
  },
  get_threads: {
    title: 'Read comments',
    description: 'Read comment threads people left on blocks (open ones by default), with the block they point at. Use this to pick up feedback and revise.',
    input: { board, include_resolved: z.boolean().optional() },
  },
  reply_thread: {
    title: 'Reply to comment',
    description: 'Reply to a comment thread, e.g. to say what you changed.',
    input: { board, thread: z.string(), text: z.string() },
  },
  resolve_thread: {
    title: 'Resolve comment',
    description: 'Mark a comment thread as resolved once the feedback is addressed.',
    input: { board, thread: z.string() },
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
    description: 'See your change sets and whether the human accepted, rejected (with reasons), partly accepted or undid them.',
    input: { board, status: z.enum(['open', 'pending', 'accepted', 'rejected', 'partial', 'undone']).optional() },
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
      items: z.array(z.string()).optional().describe('Only these block / connector ids within the change set'),
      reason: z.string().optional(),
    },
  },
  undo_changes: {
    input: {
      board,
      author: z.string().optional().describe('Agent id or name — undo everything it did'),
      authors: z.array(z.string()).optional().describe('Author ids (all sessions of one agent)'),
      change_set: z.string().optional(),
    },
  },
  report_snippet_thumb: {
    input: { board, id: z.string(), hash: z.string(), png: z.string().describe('base64 PNG captured inside the sandbox') },
  },
  enable_skill: { input: { board, name: z.string() } },
  disable_skill: { input: { board, name: z.string() } },
  install_skill: { input: { path: z.string().describe('Folder containing SKILL.md') } },
  load_dev_skill: { input: { path: z.string() } },
  list_activity: { input: { board, skill: z.string().optional(), limit: z.number().optional() } },
  save_block_type: {
    input: {
      board,
      block: z.string().describe('Sticky or card to learn the type from'),
      label: z.string(),
      skill: z.string().optional().describe('Skill folder name (kebab-case); default "<board>-types"'),
      color: z.string().optional(),
      icon: z.string().optional(),
      fields: z.array(z.object({ key: z.string(), label: z.string(), kind: z.enum(['text', 'number', 'enum', 'boolean']), options: z.array(z.string()).optional() })).optional(),
    },
  },
  report_layout: {
    input: {
      board,
      items: z
        .array(z.object({ id: z.string(), content_h: z.number().optional(), expanded: z.boolean().optional() }))
        .describe('Measured content heights from the canvas, and expand/collapse toggles'),
    },
  },
  rename_board: { input: { board, title: z.string() } },
  open_file: { input: { path: z.string() } },
  save_file: { input: { board: z.string(), path: z.string() } },
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
