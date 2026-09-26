# ai-figma

> Code name. A local-first infinite canvas shared by you and your AI agents.

ai-figma is a whiteboard that feels good to use by hand and that Claude Code, Cursor and other agents can drive
through MCP or a CLI. Whatever an agent adds is laid out by the engine (tokens, 8px grid, layout intents), shows up
live with the agent's cursor, and waits in a change set for you to accept or reject.

This is **Phase 0** (the MVP in §8 of the product concept): desktop app, canvas, core, design system, agent access
over MCP (stdio and local HTTP) and the CLI, review, comments, exports and an optional built-in assistant. No
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

### Desktop app

```bash
npm run desktop          # build the UI and run the Electron app (starts or reuses the core)
npm run desktop:dev      # same, but load the Vite dev server for hot reload (run `npm run dev` first)
npm run desktop:build    # package it (electron-builder; add `-- --dir` for an unpacked build)
```

The desktop app runs the core with Electron's own Node, so nothing else needs to be installed. It has native menus
and shortcuts (New Board ⌘N, Open… ⌘O, Open Recent, Save As… ⇧⌘S, Export PNG/SVG/JSON/Markdown, Undo/Redo, zoom,
minimap, Appearance), opens `.aifig` files from anywhere (Save As keeps the chosen file in sync), follows the OS
light/dark setting, and its **Connect agent** dialog points agents at the bundled CLI/MCP.

Boards live in `~/.aifig/boards/<id>.aifig` (checksummed Yjs state, see below) with a readable `<id>.json` next to it. Override the
location with `AIFIG_HOME`, and ports with `AIFIG_CORE_PORT` / `AIFIG_UI_PORT`. `~/.aifig/state.json` remembers the
board last active in the canvas, which is the default for tools called without `board` (agents should pass it anyway).

### Your data is safe

- **Autosave** is atomic (temp file, fsync, rename) and coalesced: a burst of edits is written once, at most 2 s after
  the first unsaved edit. Ctrl-C, SIGTERM (quitting the desktop app), SIGHUP and crashes flush unsaved edits first;
  `kill -9` or a power cut can lose at most that last 2 s window, never corrupt the file.
- **Version history** (board menu › *Version history…*, or the history button): a version is kept from just before
  any large edit (5+ items removed, or 25+ changed at once), every 10 minutes while a board changes, when a board is
  opened with unversioned edits, and before every restore or agent undo. Name a checkpoint any time. Versions are
  previewed read-only; restoring checkpoints the current state first and ⌘Z undoes it. Retention keeps the newest 20
  automatic versions, then one per hour for 48 hours, then one per day for 30 days; named checkpoints stay until you
  delete them. History lives in `~/.aifig/history/<board>/`.
- **File format.** `.aifig` files carry a header with a schema version (currently `1.0`) and a SHA-256 checksum of the
  Yjs document. Older files are migrated forward on open (the original is kept in the backups); files from a newer
  *major* version are refused with a message saying to update, and are left untouched.
- **Corruption recovery.** If a board file is truncated or fails its checksum, the core keeps the damaged file aside
  (`backups/damaged/`), loads the newest copy that verifies (Save As mirror, version or backup) and shows a banner saying
  what happened. If there's no good copy it says so — it never silently starts an empty board.
- **Backups.** Rolling copies of every board (10 per board, at most hourly, plus one on each start and a last one when a
  board is deleted) in `~/.aifig/backups`, or wherever `AIFIG_BACKUP_DIR` / `~/.aifig/config.json` point:

  ```json
  { "backups": { "dir": "~/Dropbox/aifig-backups", "keep": 20, "intervalMinutes": 30 },
    "versions": { "keepRecent": 30, "hourlyForHours": 72, "dailyForDays": 60, "intervalMinutes": 10 } }
  ```

  *Open backup folder* is in the board menu and in Version history; `aifig backups --open` from a terminal. Backups are
  plain `.aifig` files — open one with **Open…** to look inside.

**Sandboxed launchers** (agent IDEs or tools that can't write to your home folder or use the GPU): if the core fails
with `EACCES` or the desktop window stays white, point every writable location somewhere the sandbox allows:

```bash
AIFIG_HOME=/tmp/aifig npx aifig core                                   # boards, state, logs
AIFIG_HOME=/tmp/aifig npx electron apps/desktop --user-data-dir=/tmp/aifig-electron --disable-gpu
```

`--user-data-dir` moves Electron's profile (caches, recent files, keychain-encrypted settings) out of
`~/Library/Application Support` / `~/.config`; `--disable-gpu` avoids the GPU process and its shader cache. Use the
same `AIFIG_HOME` in your agent's MCP config (`"env": { "AIFIG_HOME": "/tmp/aifig" }`) so the agent and the app see
the same boards.

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

**Local HTTP** (Streamable HTTP, while the core runs — nothing to launch):

```bash
claude mcp add --transport http ai-figma http://127.0.0.1:47821/mcp
```

(Cursor: `{ "mcpServers": { "ai-figma": { "url": "http://127.0.0.1:47821/mcp" } } }`.) The endpoint only answers
on `127.0.0.1` and rejects other `Host` headers (DNS-rebinding protection).

The **Connect agent** button in the canvas shows all of these with the correct paths filled in (in the desktop app,
for its bundled CLI). The agent's name
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
| Collaborate | `set_status`, `begin_change_set`, `commit_change_set`, `list_change_sets` (incl. per-item rejections and reasons), `get_threads`, `reply_thread`, `resolve_thread` |
| Types | `list_types`, `set_type` (promote / demote with `none` / update fields), `query_blocks` (by type and field); `create_blocks` accepts `type` + `fields`, `connect` accepts `relation`, `tidy` accepts `by: "type" \| "matrix"` |
| Web snippets | `create_snippet` (https URL embed, or inline `html` / `css` / `js`), `update_snippet` — both through review |
| Export | `export_board` (Markdown document or JSON structure) |
| Versions | `list_versions`, `create_version` (named checkpoint), `restore_version` (checkpoints the current state first; from an agent it's a change set to review) |

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
aifig export --format md -o board.md               # md | json | png | svg (md/json print to stdout without -o)
aifig status "Clustering interview notes…"
aifig changes                                      # change sets and their review status
aifig accept | aifig reject [id] --reason "…"      # review from the terminal
aifig types                                        # built-in block types and their fields
aifig add "? why do teams churn" --type question
aifig set-type <id> hypothesis --status supported  # or: aifig set-type <id> none (fields are kept)
aifig query --type hypothesis --status unverified
aifig tidy --frame "Synthesis" --by matrix --field status
aifig snippet --url https://www.figma.com/proto/…  # or --html @demo.html --css @demo.css --js @demo.js
aifig snippet-update <id> --js @demo.js
aifig versions                                     # version history (auto snapshots, checkpoints, pre-restore states)
aifig checkpoint "Before clustering"               # named checkpoint
aifig --human restore <versionId>                  # restore now (without --human it goes through review)
aifig backups [--open]                             # print / open the backup folder
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

### Typed blocks

Stickies and cards can take a type — **Insight, Question, Quote** (who, source), **Hypothesis** (status, confidence),
**Idea, Todo** (owner, done) — each with its own token color and icon. Types are optional and never required: press
`/` on a selection (or type `/` in an empty sticky), use right-click › **Set as…**, or start a sticky with a prefix
(`?` question, `!` insight, `"` quote, `h:` hypothesis, `idea:`, `[]` todo; switch detection off in Set as…).
Fields stay collapsed as a one-line summary; click it to edit. Demote to plain at any time — fields are kept and come
back when you re-promote. The filter bar (top) highlights one type and field values (e.g. unverified hypotheses);
connectors between typed blocks get a suggested relation (a quote *supports* an insight). Markdown exports are
organized by type. Types stay small on purpose: anything deeper belongs to Skills.

### Web snippets

The globe in the toolbar (or pasting a YouTube / Figma / CodePen / Loom link) adds a web snippet: an embedded URL or
an inline HTML/CSS/JS snippet (agents can write these with `create_snippet`). Snippets show a static preview and only
run when you double-click them; `Esc` or clicking outside stops them, and they pause when idle or off screen.

Sandbox: inline snippets are served by a separate snippet host (`localhost:<core port + 1>`, a different site from
the app) into `sandbox="allow-scripts"` iframes (opaque origin, credentialless), with a CSP that blocks all network
(`connect-src 'none'`, no external scripts, images, fonts or frames). They can't reach the board, files or keys; the
only channel is `aifig.getState()` / `aifig.setState(obj)` for the snippet's own state (≤16 KB).
`aifig.requestPermission('network' | 'neighbors')` is the hook for v2 grants (denied in v1). A heartbeat watchdog stops
snippets that hang (endless loops) or use too much memory. URL embeds run as their own origin without top navigation.
In the desktop app, the window's session also denies permission prompts and navigation for anything that isn't the app.

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

Phase 0 is complete. The MVP validation run (`scripts/mvp-run.mjs`) records an agent synthesizing six interviews over
MCP, a person reviewing item by item and commenting, and the agent reading the comment and revising.

**Shipped**

- Desktop app (Electron) with native menus, files, recents, OS appearance, bundled CLI/MCP and a packaging script
- Local core with Yjs boards persisted to `.aifig` files; JSON and Markdown exports (UI, CLI, MCP) plus PNG/SVG
- Own canvas engine: token-driven stickies, cards, headings, images and frames; rich text; routed connectors with
  waypoints; rotation; snapping with guides and spacing labels; context menu, minimap, touch, level of detail
- Layout engine: intents, free-space placement, frame auto-grow, making room when blocks grow, tidy, lint
- MCP over stdio and local Streamable HTTP (23 tools), CLI with the same surface, Agent Skill
- Agent presence, suggestion layer, change sets; review item by item (`J`/`K`, `A`/`R`, reasons), accept the
  rest, partly accepted change sets; undo by change set or by author, including accepted work (later edits by people
  are kept)
- Comments on blocks (`M`) that agents read and answer (`get_threads`, `reply_thread`, `resolve_thread`)
- Optional built-in assistant (Extract ideas, Cluster into themes, Tidy up) — hidden unless a provider is set up in
  Assistant Settings; keys go to the OS keychain via Electron `safeStorage` and never into boards; a deterministic
  mock provider for tests and demos
- Agent-output aesthetics regression set (`npm run test:aesthetics`)

**Not yet (next phases)**

- Before/after diffs and ghosted deletions while reviewing; trust levels (auto-accept per agent or frame)
- Holding agent layout moves while a person is dragging or typing; animated tidy and layout pushes
- Rotating frames and multi-selections as a group, image cropping, curved-connector waypoints, rich text in exports
- Tray / always-on MCP and multi-window in the desktop app; code signing and auto-update
- Skills, execution, sync (Phases 1–3)

## Development

```bash
npm run typecheck                                     # every workspace
npm run test:e2e                                      # canvas engine + app, real pointer/keyboard input (84 checks)
npm run test:aesthetics                               # agent-output aesthetics vs baselines (update: test:aesthetics:update)
npm run test:api                                      # Canvas API regressions
npm run test:data-safety                              # format, migrations, retention, kill -9 / SIGTERM, recovery, versions over MCP + CLI
node scripts/desktop-e2e.mjs                          # Electron app (window, menus, files, theme, bundled MCP, keychain)
node scripts/mcp-http-smoke.mjs                       # MCP over local HTTP
node scripts/mcp-smoke.mjs                            # MCP over stdio
node scripts/mvp-run.mjs <out-dir>                    # the recorded Phase 0 validation run
node scripts/shot.mjs out.png [--dark] [--w=390]      # screenshot the running canvas (headless Chrome)
```
