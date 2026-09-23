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
| ui | 47820 | The canvas (Vite + React + tldraw), a client of the core. `/api` and `/sync` are proxied to the core |

Run them separately with `npm run core` and `npm run ui`. For a single process, `npm start` builds the UI and
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
| Write | `create_blocks` (layout intents `grid` / `row` / `stack` / `cluster` / `tree`; placement `inside` / `right_of` / `below` / new `frame`), `update_blocks`, `delete_blocks`, `connect`, `group_into_frame`, `create_board` |
| Layout | `arrange`, `tidy`, `lint_layout` |
| Look | `render_snapshot` (PNG or SVG, rendered headlessly by the core) |
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
aifig connect <fromId> <toId> --label "leads to"
aifig tidy --frame "Principles"
aifig lint
aifig snapshot -o board.png                        # --dark, --frame, .svg
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
| `V` / `H` | Select / pan |
| `⌥A` / `⌥R` | Accept / reject the latest agent change set |

Selecting blocks shows color and size tokens, plus **Tidy frame** and **Arrange in grid** (both run in the core's
layout engine, the same one agents use). Light and dark themes are in the top-right corner.

## How it fits together

```
 Claude Code / Cursor ──MCP stdio──┐
 scripts / terminal ────aifig CLI──┼──HTTP /api/call──► aifig core (Node)
                                   │                     ├─ Canvas API (zod-validated tools)
 Canvas UI (tldraw) ◄──WebSocket───┘                     ├─ Yjs board documents  ─► ~/.aifig/boards
   Yjs sync + agent presence                             ├─ layout engine: tokens, intents, tidy, lint
                                                         ├─ change sets / suggestion layer
                                                         └─ headless SVG/PNG snapshots
```

- **The core owns the truth.** Each board is a Yjs document with `blocks`, `connectors`, `changeSets` and `meta`
  maps. The canvas keeps a Yjs replica and a two-way adapter (`src/ui/canvas/binding.ts`) projects it into tldraw's
  store; tldraw is the renderer and interaction layer, not the data model.
- **Layout lives in the core** (`src/core/layout.ts`), so CLI, MCP and hand-made edits share the same grid, sizes
  and spacing — even with no UI open.
- **Design tokens** (`src/shared/tokens.ts`) are the only visual values: 9 soft colors with light/dark variants,
  4 type sizes, fixed sticky sizes and card widths, 8px spacing. Hex colors from agents are quantized.
- **Change sets.** Every agent write is recorded with its intent and a `before` snapshot. Accept clears the
  pending state; reject reverts exactly (creations removed, edits and deletions restored).

```
src/
  shared/   tokens, model types, text measurement, Canvas API tool schemas
  core/     server (HTTP + Yjs WebSocket), boards + persistence, Canvas API, layout, snapshots, presence
  mcp/      MCP stdio server
  cli/      aifig CLI (also launches core / mcp)
  client/   HTTP client with core auto-start (used by MCP and CLI)
  ui/       canvas app: tldraw shapes, Yjs binding, agent layer, chrome (shadcn/ui)
```

## tldraw license

The canvas uses the [tldraw SDK](https://tldraw.dev) (v5). tldraw is free for development: on localhost it runs
without a key and shows a small "Get a license for production" watermark, which you'll see in the bottom-right
corner. **Any production or commercial deployment needs a tldraw license key** (see
[tldraw.dev/pricing](https://tldraw.dev/pricing)). Put it in `.env.local` as `VITE_TLDRAW_LICENSE_KEY=…`; it's passed
to `<Tldraw licenseKey>`. Because the document model, layout, change sets and snapshots live in the core, replacing
the renderer later only touches `src/ui/canvas/`.

## Phase 0 status

**Done**

- Local core with Yjs boards persisted to `.aifig` files plus JSON export; multiple boards
- Canvas on tldraw with custom token-driven sticky / card / heading shapes, frames and connectors; 8px grid
  snapping, light/dark themes, double-click and `Tab` sticky flow, empty, loading, offline and error states
- Layout engine: intents (grid, row, stack, cluster, tree), free-space placement near the user's viewport, frame
  auto-grow, size normalization, tidy, lint (overlap, overflow, outside-frame, off-grid, too many colors)
- MCP server (stdio) with 16 tools, a tokens resource and a best-practices prompt; CLI with the same surface
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
- Images, files, shapes, text formatting, export menu in the UI, semantic zoom
- Skills, execution, sync (Phases 1–3)

## Development

```bash
npm run typecheck                                     # UI + node projects
node scripts/mcp-smoke.mjs                            # drive the canvas through the real MCP server
node scripts/shot.mjs out.png [--dark] [--w=390]      # screenshot the running canvas (headless Chrome)
```
