# ai-figma

> Code name. A local-first infinite canvas shared by you and your AI agents.

ai-figma is a whiteboard that feels good to use by hand and that Claude Code, Cursor and other agents can drive
through MCP or a CLI. Whatever an agent adds is laid out by the engine (tokens, 8px grid, layout intents), shows up
live with the agent's cursor, and waits in a change set for you to accept or reject.

This is the **Phase 0 prototype**: one polished slice — canvas, core, design system, agent access and review. No
execution, skills or sync yet.

## Quick start

Requires Node 22+.

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:47820**. `npm run dev` starts two processes:

| Process | Port | What it is |
|---|---|---|
| core | 47821 | Owns every board as a Yjs document, persists to disk, serves the Canvas API (HTTP) and live sync (WebSocket) |
| ui | 47820 | The canvas app (Vite + React + our own canvas engine), a client of the core. `/api` and `/sync` are proxied to the core |

Run them separately with `npm run core` and `npm run ui`. If the browser ever shows
`504 (Outdated Optimize Dep)` (for example after changing dependencies), run `npm run dev:clean`, which clears
Vite's dependency cache and re-bundles, then reload the page. For a single process, `npm start` builds the UI and
the core serves it on port 47821.

Boards live in `~/.aifig/boards/<id>.aifig` (Yjs state) with a readable `<id>.json` next to it. Override the
location with `AIFIG_HOME`, and ports with `AIFIG_CORE_PORT` / `AIFIG_UI_PORT`.

## Connect an agent

The MCP server and the CLI are the same `bin/aifig.mjs` entry point. If the core isn't running they start it in the
background, so agents work even when the canvas isn't open (edits appear when you open it).

**Claude Code**

```bash
claude mcp add ai-figma -- node /absolute/path/to/ai-figma/bin/aifig.mjs mcp
```

**Cursor** — `~/.cursor/mcp.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ai-figma": {
      "command": "node",
      "args": ["/absolute/path/to/ai-figma/bin/aifig.mjs", "mcp"]
    }
  }
}
```

The **Connect agent** button in the canvas shows both snippets with the correct path filled in. The agent's name
and color come from its MCP client info (Claude Code, Cursor, Codex); set `AIFIG_AGENT_NAME` to override.

[`skills/ai-figma-canvas/SKILL.md`](skills/ai-figma-canvas/SKILL.md) is an Agent Skill that teaches agents how to
use the canvas well. Copy it into `~/.claude/skills/` (or your agent's skills folder).

### MCP tools

| Group | Tools |
|---|---|
| Read | `list_boards`, `get_board` (markdown or JSON outline), `get_design_tokens` |
| Write | `create_blocks` (layout intents `grid` / `row` / `stack` / `cluster` / `tree`; placement `inside` / `right_of` / `below` / new `frame`), `update_blocks` (incl. `rotation`), `delete_blocks`, `connect` (routing `curved` / `elbow` / `straight`), `update_connectors` (routing, label, elbow `waypoints`), `add_image` (file path, URL or base64 — stored inside the board), `group_into_frame`, `create_board` |
| Layout | `arrange`, `tidy`, `lint_layout` |
| Look | `render_snapshot` (PNG or SVG of the board, a frame or specific blocks, rendered headlessly by the core) |
| Collaborate | `set_status`, `begin_change_set`, `commit_change_set`, `list_change_sets` |

Also exposed: resource `aifig://design/tokens` and prompt `layout-best-practices`.

## CLI

```bash
npm link                       # optional: puts `aifig` on your PATH (otherwise: node bin/aifig.mjs …)

aifig boards
aifig read                                         # outline of the board open in the canvas
aifig add "Fast onboarding" "Offline first" --frame "Principles" --intent "Capture principles"
aifig add "FigJam::Great feel, cloud-first" "tldraw::Best canvas SDK" --kind card --layout row
aifig add --from-json plan.json                    # any create_blocks payload
aifig connect <fromId> <toId> --label "leads to" --route elbow
aifig route <connectorId...> --style curved         # curved | elbow | straight
aifig route <connectorId> --waypoints "400,120;400,480"   # elbow bends (--clear-waypoints to auto-route)
aifig update <id> --rotate 15
aifig image ./sketch.png --width 320 --inside "Inspiration"  # or an https:// URL
aifig tidy --frame "Principles"
aifig lint
aifig snapshot -o board.png                        # --dark, --frame, --ids a,b,c, .svg
aifig status "Clustering interview notes…"
aifig changes                                      # change sets and their review status
aifig accept | aifig reject [id] --reason "…"      # review from the terminal
aifig call <tool> '<json args>'                    # anything in the Canvas API
```

Global flags: `--board <id|title>`, `--as "<agent name>"` (shown on the canvas), `--human` (apply directly without
review), `--json`.

## Using the canvas

| Key | Action |
|---|---|
| `S` / double-click | Sticky note (`Tab` while writing starts the next one) |
| `C` | Card (title + details) |
| `T` | Heading |
| `F` | Frame |
| `A` | Connector (drag between blocks) |
| `V` / `H` / `Space`-drag | Select / pan (trackpad scroll pans, pinch or `⌘`/`Ctrl`+scroll zooms) |
| `⌘Z` / `⇧⌘Z` | Undo / redo (your own edits only — agent edits are reviewed, not undone) |
| `⌘C` / `⌘V` / `⌘D` | Copy / paste / duplicate |
| Arrows (`⇧` for 32px) | Nudge on the 8px grid |
| `Enter` / `Esc` | Edit the selection / stop editing, deselect |
| `⇧1` / `⇧2` / `⌘0` | Zoom to fit / to selection / 100% |
| `⌘G` / `⇧⌘C` | Group into a frame / copy the selection (or board) as PNG |
| Right-click | Context menu: edit, clipboard, arrange (front/back, group, tidy), align & distribute, connector routing, export PNG/SVG |
| `⌥A` / `⌥R` | Accept / reject the latest agent change set |

Hover a block to get connect handles: drag one onto another block to connect them, or drop it on empty canvas to
create a connected sticky. With the connector tool (`A`) you can also draw free-floating connectors; drag a selected
connector's endpoint onto a block to rebind it. Connectors are curved by default and route around blocks; elbow
routing is orthogonal with obstacle avoidance. Drag a frame by its title or header strip; once it's selected, dragging its empty area moves it too (on an
unselected frame, dragging the empty area draws a marquee). Double-click a frame's title (or its empty area) to
rename it. Selected blocks get a rotation handle (snaps to 15°, hold ⌥ for free rotation). Selected elbow
connectors show bend handles: drag a hollow dot to add a bend, drag a bend to move it, double-click it to remove it.
Connector labels slide along the route to stay clear of blocks. Text in stickies, cards and headings is rich text
(⌘B, ⌘I, ⌘E for code, ⌘K for links, `- ` / `1. ` for lists) and is stored as Markdown in the board, so agents can
write it too; ⌘/Ctrl-click opens links. Paste, drop or upload images (toolbar) — they are downscaled if huge,
stored inside the board file, resize with a locked aspect ratio and appear in exports. On touch screens, long-press
opens the context menu. On touch
screens, one finger pans and two fingers pinch-zoom. The minimap (bottom-left) can be toggled and clicked to navigate.
Far zoom switches to a canvas level of detail, so boards with thousands of blocks stay at 60fps. Dragging snaps to the 8px grid and shows alignment guides against nearby blocks; dropping
a block into a frame parents it (the frame grows to fit). Selecting blocks shows color and size tokens, plus **Tidy frame** and **Arrange in grid** (both run in the core's
layout engine, the same one agents use). Light and dark themes are in the top-right corner.

## How it fits together

```
 Claude Code / Cursor ──MCP stdio──┐
 scripts / terminal ────aifig CLI──┼──HTTP /api/call──► aifig core (Node)
                                   │                     ├─ Canvas API (zod-validated tools)
 Canvas app (engine) ◄─WebSocket──┘                     ├─ Yjs board documents  ─► ~/.aifig/boards
   Yjs sync + agent presence                             ├─ layout engine: tokens, intents, tidy, lint
                                                         ├─ change sets / suggestion layer
                                                         └─ headless SVG/PNG snapshots
```

- **The core owns the truth.** Each board is a Yjs document with `blocks`, `connectors`, `changeSets` and `meta`
  maps. The canvas app keeps a Yjs replica and the canvas engine renders and edits it directly — there is no second
  store or adapter.
- **Canvas engine** (`packages/canvas-engine`): a whiteboard engine we own, with no dependencies beyond React and Yjs — blocks are DOM
  in one CSS-transformed layer (native text editing and IME), connectors are SVG, handles and guides live in a
  screen-space overlay. It covers camera, selection and marquee, move/resize with grid and alignment snapping,
  frames, connectors, clipboard and undo (`Y.UndoManager` scoped to local edits). Block types plug in through a
  `ShapeDef` registry (`apps/canvas/src/canvas/shapes.tsx`).
- **Layout lives in the core** (`packages/core/src/layout.ts`), so CLI, MCP and hand-made edits share the same grid, sizes
  and spacing — even with no UI open.
- **Design tokens** (`packages/shared/src/tokens.ts`) are the only visual values: 9 soft colors with light/dark variants,
  4 type sizes, fixed sticky sizes and card widths, 8px spacing. Hex colors from agents are quantized.
- **Change sets.** Every agent write is recorded with its intent and a `before` snapshot. Accept clears the
  pending state; reject reverts exactly (creations removed, edits and deletions restored).

npm-workspaces monorepo:

```
packages/
  shared/         @aifig/shared — tokens, model types, text measurement, Canvas API tool schemas
  core/           @aifig/core — server (HTTP + Yjs WebSocket), boards + persistence, Canvas API, layout, snapshots, presence
  canvas-engine/  @aifig/canvas-engine — Editor, CanvasView, input, geometry (React, Yjs)
  cli/            @aifig/cli — aifig CLI, MCP stdio server, HTTP client with core auto-start
apps/
  canvas/         @aifig/canvas — the canvas app: block renderers, agent layer, review UI, chrome (shadcn/ui)
bin/aifig.mjs     entry point for the CLI, `aifig core` and `aifig mcp`
```

Workspace packages export their TypeScript sources directly (no build step); `tsx` runs the node side and Vite
bundles the app.

## Why our own canvas engine

The first prototype used the tldraw SDK, whose license requires a key (with a watermark on the free hobby tier) for
production. We compared permissively licensed options (Excalidraw, BlockSuite, React Flow, Leafer, Konva/Pixi) and
chose a small in-house engine that renders the core's Yjs document directly. No license keys, no watermark, and
custom semantic blocks and executable edges are ours to extend. The evaluation is in the project docs
(`canvas-engine-evaluation.md`).

## Phase 0 status

**Done**

- Local core with Yjs boards persisted to `.aifig` files plus JSON export; multiple boards
- Own canvas engine with token-driven sticky / card / heading blocks, frames and routed connectors; 8px grid,
  alignment-guide and 24px spacing snapping with distance labels, context menu, minimap, touch gestures,
  canvas level of detail for large boards, export / copy as image, connect handles, undo/redo, clipboard, light/dark themes, double-click and `Tab` sticky flow, empty, loading, offline and error states
- Layout engine: intents (grid, row, stack, cluster, tree), free-space placement near the user's viewport, frame
  auto-grow, size normalization, tidy, lint (overlap, overflow, outside-frame, off-grid, too many colors)
- MCP server (stdio) with 19 tools, a tokens resource and a best-practices prompt; CLI with the same surface
- Agent presence: identity-colored cursor that glides to where the agent works, status capsule, breathing
  work-area highlight, off-screen indicator, agent list; the agent never moves your viewport
- Suggestion layer: dashed identity-color outlines and staggered entrance for agent blocks, change set cards with
  accept / reject / show, accept all, `⌥A` / `⌥R`, exact revert on reject
- Headless PNG/SVG snapshots so agents can check their own work

**Deferred (next steps)**

- Electron shell (tray, always-on MCP, multi-window). The web app plus local core is the same architecture, so the
  shell wraps `npm start`
- MCP over Streamable HTTP (only stdio today), `get_changes_since` / threads / comments
- Per-item review (`J`/`K` stepping, before/after diff, ghosted deletions), undo by change set after acceptance,
  trust levels (auto-accept per agent or frame)
- Waiting for the user to finish dragging or typing before applying agent layout moves; animated tidy
- Engine gaps vs tldraw: rotating frames and multi-selections as a group, rich text in exports (formatting is
  flattened to plain text), gesture tuning on real touch devices, image cropping, curved-connector waypoints
- Images, files, shapes, text formatting, export menu in the UI, semantic zoom
- Skills, execution, sync (Phases 1–3)

## Development

```bash
npm run typecheck                                     # every workspace
node scripts/engine-e2e.mjs                           # drive the canvas engine with real pointer/keyboard input
node scripts/mcp-smoke.mjs                            # drive the canvas through the real MCP server
node scripts/shot.mjs out.png [--dark] [--w=390]      # screenshot the running canvas (headless Chrome)
```
