# ai-figma

> Code name. A local-first infinite canvas shared by you and your AI agents.

ai-figma is a whiteboard that feels good to use by hand and that Claude Code, Cursor and other agents can drive
through MCP or a CLI. Whatever an agent adds is laid out by the engine (tokens, 8px grid, layout intents), shows up
live with the agent's cursor, and waits in a change set for you to accept or reject.

This is **Phase 0** (the MVP in §8 of the product concept): desktop app, canvas, core, design system, agent access
over MCP (stdio and local HTTP) and the CLI, review, comments, exports and an optional built-in assistant. No
execution, skills or sync yet.

## Install

Download the installer for macOS (`.dmg`, Apple silicon or Intel), Windows (`.exe`, x64 or Arm64) or Linux
(`.AppImage` or `.deb`) from the website's Download page. Nothing else is needed: the canvas, the core, the CLI and the
MCP server for Claude Code and Cursor are inside the app, running on its own Node. Beta builds may be unsigned — the
Download page and [docs/distribution.md](docs/distribution.md#first-launch-on-unsigned-builds) show the one-time
Gatekeeper / SmartScreen step. After installing, **Help › Connect agent** sets up Claude Code and Cursor.

## Quick start (from source)

Requires Node 22+.

```bash
npm install
npm run dev
```

Open the link `npm run dev` prints (`http://127.0.0.1:47820/#token=…`), or run `npx aifig open --dev`. The core only
answers clients holding its per-install access token (see [Security](#security)); the link signs this browser in once.
`npm run dev` starts two processes:

| Process | Port | What it is |
|---|---|---|
| core | 47821 | Owns every board as a Yjs document, persists to disk, serves the Canvas API (HTTP) and live sync (WebSocket) |
| ui | 47820 | The canvas app (Vite + React + our own canvas engine), a client of the core. `/api` and `/sync` are proxied to the core |

Run them separately with `npm run core` and `npm run ui`. Opening the plain address shows a sign-in screen where you can
paste the token from `npx aifig token`. If the browser ever shows
`504 (Outdated Optimize Dep)` (for example after changing dependencies), run `npm run dev:clean`, which clears
Vite's dependency cache and re-bundles, then reload the page. For a single process, `npm start` builds the UI and
the core serves it on port 47821.

### Desktop app

```bash
npm run desktop          # build the UI and run the Electron app (starts or reuses the core)
npm run desktop:dev      # same, but load the Vite dev server for hot reload (run `npm run dev` first)
npm run desktop:build    # package for this OS (electron-builder; add `-- --dir` for an unpacked build)
npm run release:linux    # AppImage + .deb → release/<version>/ with SHA256SUMS.txt and latest.json
npm run release:win      # NSIS installers, x64 + arm64 (on Linux: needs wine)
npm run release:mac      # .dmg + .zip, arm64 + x64 — on a Mac; signs/notarizes when CSC_LINK / APPLE_ID… are set
```

Releases, signing, publishing (S3-compatible bucket, HTTP PUT or a folder), auto-update and the install counter are
described in [docs/distribution.md](docs/distribution.md).

The desktop app runs the core with Electron's own Node, so nothing else needs to be installed, and signs in to it on its own. It has native menus
and shortcuts (New Board ⌘N, Open… ⌘O, Open Recent, Save As… ⇧⌘S, Export PNG/SVG/JSON/Markdown, Undo/Redo, zoom,
minimap, Appearance), opens `.aifig` files from anywhere (Save As keeps the chosen file in sync), follows the OS
light/dark setting, and its **Connect agent** dialog points agents at the bundled CLI/MCP.

Boards live in `~/.aifig/boards/<id>.aifig` (checksummed Yjs state, see below) with a readable `<id>.json` next to it.
The same folder (kept at `0700`) holds `access-token`, `permissions.json` and `activity.jsonl`. Override the
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

The stdio server and the CLI read the access token from `AIFIG_HOME` themselves — nothing to configure.

**Local HTTP** (Streamable HTTP, while the core runs — nothing to launch) needs the token as a header:

```bash
claude mcp add --transport http ai-figma http://127.0.0.1:47821/mcp --header "Authorization: Bearer $(npx aifig token)"
```

(Cursor: `{ "mcpServers": { "ai-figma": { "url": "http://127.0.0.1:47821/mcp", "headers": { "Authorization": "Bearer <token>" } } } }`.)
The endpoint only answers on `127.0.0.1`, rejects other `Host` headers (DNS rebinding) and browser `Origin`s other than
the app, and requires the token on every request. Keep configs with the token out of shared or committed files;
`aifig token --rotate` replaces it.

**One-click setup.** The **Connect agent** dialog (and the last step of the welcome tour) detects Claude Code and
Cursor on this machine and adds ai-figma to their MCP settings — `~/.claude.json` (user MCP servers) and
`~/.cursor/mcp.json` — after you confirm. It writes a stdio entry for the right CLI (in the desktop app, the bundled
one), backs the existing file up next to it (`*.aifig-backup-<time>`), keeps every other setting and the file's
indentation, writes atomically, never touches a file it can't parse, and does nothing when the entry is already
there. **Test connection** launches the configured command and does a real MCP handshake (`initialize` →
`tools/list`). The endpoints (`/api/agents…`) only answer the app itself on this machine (loopback Host and
Origin). `AIFIG_AGENT_CONFIG_HOME` / `AIFIG_AGENT_PATH` point detection at another home folder / PATH (tests).

The same dialog keeps the copy-paste fallback: all of these configs with the correct paths and the token filled in (in the
desktop app, for its bundled CLI). The agent's name
and color come from its MCP client info (Claude Code, Cursor, Codex); set `AIFIG_AGENT_NAME` to override.

[`skills/ai-figma-canvas/SKILL.md`](skills/ai-figma-canvas/SKILL.md) is an Agent Skill that teaches agents how to
use the canvas well. Copy it into `~/.claude/skills/` (or your agent's skills folder).

### MCP tools

| Group | Tools |
|---|---|
| Read | `list_boards`, `get_board` (markdown or JSON outline), `get_design_tokens`, `list_templates` |
| Write | `create_blocks` (layout intents `grid` / `row` / `stack` / `cluster` / `tree`; placement `inside` / `right_of` / `below` / new `frame`), `update_blocks` (incl. `rotation`), `delete_blocks`, `connect` (routing `curved` / `elbow` / `straight`), `update_connectors` (routing, label, elbow `waypoints`), `add_image` (file path, URL or base64 — stored inside the board), `group_into_frame`, `create_board` (optionally `template` + `language`) |
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
aifig new-board --template research-synthesis --lang zh-CN   # or: aifig new-board "Title"; aifig templates
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
aifig open [--dev] [--print]                       # open the canvas in a browser, signed in
aifig token [--rotate]                             # the local access token (for HTTP MCP configs)
aifig permissions                                  # remembered grants and pending requests
aifig permissions allow agent:claude-code network example.com   # or revoke agent:claude-code
aifig activity [-c network|secret|permission|auth] # recent network / secret / permission / auth events
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

### First run, templates

The first launch shows a short welcome (what it is, a try-it canvas, one-click agent setup) — skippable at every
step with `Esc`, shown once, and available again from **Settings ▸ Welcome tour**. Automated browsers skip it
unless the URL has `?welcome=1`. An empty board shows the tool keys, three templates to fill it in place, and
**Connect an agent**.

**New board…** (board menu, ⌘N in the desktop app) opens a dialog with Blank and five templates: **Research
synthesis**, **Competitor analysis**, **User journey map**, **Brainstorm** and **Meeting notes**. Templates are
ordinary typed blocks placed by the layout engine (frames, `cluster` / `grid` / `stack` intents, no coordinates),
written in the UI language (English or Chinese), and lint clean. Agents get the same through
`create_board { template, language }` and the CLI through `aifig new-board --template …`; template content applies
directly instead of as a change set. Templates live in `packages/core/src/templates.ts` (content) and
`packages/shared/src/templates.ts` (ids, titles).

### Typed blocks

Stickies and cards can take a type — **Insight, Question, Quote** (who, source), **Hypothesis** (status, confidence),
**Idea, Todo** (owner, done) — each with its own token color and icon. Types are optional and never required: press
`/` on a selection (or type `/` in an empty sticky), use right-click › **Set as…**, or start a sticky with a prefix
(`?` question, `!` insight, `"` quote, `h:` hypothesis, `idea:`, `[]` todo; switch detection off in Set as…).
Fields stay collapsed as a one-line summary; click it to edit. Demote to plain at any time — fields are kept and come
back when you re-promote. The filter bar (top) highlights one type and field values (e.g. unverified hypotheses);
connectors between typed blocks get a suggested relation (a quote *supports* an insight). Markdown exports are
organized by type. Types stay small on purpose: anything deeper belongs to Skills.

### Skills

A skill is a standard [Agent Skill](https://agentskills.io) folder — any agent can read its `SKILL.md` — with an
optional canvas extension that ai-figma reads:

```
competitor-kit/
  SKILL.md              # frontmatter: name, description, metadata.aifig { version, canvas, capability, permissions }
  canvas/blocks.json    # block types (fields + card template), relations, layouts, actions, prompts
  canvas/prompts/*.md   # prompt templates
```

- **Block types** build on typed blocks: namespaced ids (`competitor-kit.competitor`), a sticky or card base, token
  color and icon, up to 8 fields (text, number, choice, yes/no) and a card template (`rows` shown on the block,
  `summary` as a one-liner). Relations between types are suggested on connectors.
- **Layouts** use the `matrix`, `timeline`, `flow`, `cluster` and `type` intents (also available to agents directly:
  `create_blocks` `layout: "matrix" | "timeline" | "flow"` with `row` / `col` / `date`, and `arrange`).
- **Capabilities**: **L0** is declarative (types, templates, layouts, instructions). **L1** can also call tools by
  name — built-in ones (`aifig.get_board`, `aifig.create_blocks`, …) or tools of MCP servers you configure in
  `~/.aifig/mcp.json` (`{ "mcpServers": { "web": { "command": "…", "args": [] } } }` → `web.search`). The first
  use of a tool on a board asks you (allow once / always on this board / deny); results arrive as a change set,
  and every call and decision is in the board's activity log (Skills › Activity), where grants can be revoked.
  L2 (sandboxed scripts) is not supported yet.
- Skills come from `skills/builtin` (`research-kit`, `competitor-kit`), `~/.aifig/skills` (installed) and folders
  under `aifig skill dev`. Enable them per board in the **Skills** panel (puzzle icon, top right); disabling keeps
  blocks' types and fields. Agents see them through MCP: `list_skills`, `get_skill` (instructions, types, layouts),
  `apply_skill_layout`, `run_skill_action`, and `aifig://skills/<name>/SKILL.md` resources.
- **Save as block type** (right-click a card › Set as… › Save as block type…) turns a card into a type — `Key: value`
  lines become fields — and writes a standard skill folder to `~/.aifig/skills`, downloadable as a zip.

```bash
aifig skill new persona-kit            # scaffold SKILL.md + canvas/blocks.json
aifig skill dev ./persona-kit --enable # validate on every save, hot-reload into boards that use it
aifig skill validate ./persona-kit     # errors point at file › path
aifig skill install ./persona-kit      # copy into ~/.aifig/skills
aifig skill list | show <name> | enable <name> | disable <name> | activity
```

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
In the desktop app, snippets run in `<webview>`s instead, each in its own in-memory partition (`snippet-<board>-<block>`:
separate storage, cache, cookies and permission state). The main process decides every webview's settings (sandboxed,
context-isolated, no Node, no popups; only inline snippets get a small preload that relays the bridge), refuses any
other source or a persistent/shared partition, keeps inline snippets on their own document, and cancels requests from
snippet partitions to this machine or the LAN. The window itself is sandboxed and denies permission prompts and
navigation for anything that isn't the app.

## Security

**Access token.** On first start the core creates `AIFIG_HOME/access-token` (32 random bytes, mode `0600`, folder
`0700`). The HTTP API, MCP over HTTP and the sync WebSocket (token as a subprotocol) all require it; so does every other
route except a bare liveness answer from `/api/health`. The core listens on `127.0.0.1` only, checks `Host` (DNS
rebinding) and `Origin` (other web pages) on every request, and sends no CORS headers. The CLI and stdio MCP read the
token file, the desktop app gets it from its shell, a browser gets it once from the `aifig open` link (a `#fragment`,
never sent to a server) and keeps it in localStorage. `AIFIG_TOKEN` overrides the file; `aifig token --rotate` replaces
it (running cores notice).

**Permissions and activity.** Agents, skills and the built-in assistant ask the core's permission broker before they
touch the network or a secret. People (the canvas, `--human`) are trusted; an agent needs a remembered grant or a yes in
the canvas prompt (Deny / Allow once / Always allow this agent), otherwise the tool call fails with an explanation. With
no canvas open the answer is no, and the error says how to allow it ahead of time. Grants are per agent client (or
skill) and host, stored in `permissions.json`. Every decision, fetch, secret access and rejected client goes to
`activity.jsonl` (names and hosts only, credentials redacted) and the **Activity & permissions** dialog (board menu, or
File menu in the desktop app). Outbound fetches by the core (images by URL, video posters) never go to loopback, private, link-local or
metadata addresses, and redirects are re-checked. For Skills: `core.security.permissions.request({ capability, target,
actor, source: { kind: 'skill', id }, reason })` and `activity.record(…)`, types in `@aifig/shared` (`security.ts`).

**API keys.** Keys are only persisted in an OS keychain and never in boards or plain files:

| Where you set the key | Stored in | No keychain available |
|---|---|---|
| Desktop app (Assistant Settings) | Electron `safeStorage` (macOS Keychain, Windows DPAPI, Linux Secret Service/KWallet) | Kept in memory for this session; Linux `basic_text` counts as no keychain |
| Browser canvas / core | `SecretStore`: macOS Keychain via `security` (secret passed on stdin, not argv), Linux `secret-tool` | Kept in memory for this session |

The settings dialog says which one applies. Tests use `AIFIG_SECRET_STORE=mock` (core) and `AIFIG_DESKTOP_KEYCHAIN=mock`
or `none` (desktop), both in-memory or obfuscated test doubles that are never selected automatically.

Verifying on macOS:

1. Desktop: `npm run desktop`, File › Assistant Settings…, choose Anthropic, paste a key, Save. Keychain Access shows an
   **ai-figma Safe Storage** item (the encryption key Electron keeps in your login keychain), and
   `strings ~/Library/Application\ Support/ai-figma/assistant.bin | grep sk-` finds nothing.
2. Browser/core: `npm run dev`, open the signed-in link, board menu › Assistant settings…, save a key. Then `security find-generic-password -s ai-figma -a assistant.anthropic`
   lists the item (add `-w` to print it after a Keychain prompt), `grep -r sk- ~/.aifig` finds nothing, and
   `aifig activity -c secret` shows `store assistant.anthropic (macos-keychain)`.
3. Restart the core: the assistant stays configured (the key is read back from the Keychain).

### Threat model

| Threat | Mitigation |
|---|---|
| A website you visit calls `127.0.0.1:47821` (CSRF, reading boards) | Token required; `Origin` must be the app; no CORS headers; preflights refused |
| DNS rebinding (`evil.example` resolving to 127.0.0.1) | `Host` must be a loopback name on the core/UI port (API, MCP, WebSocket, app files) |
| Other users on the same machine, or the LAN | Listens on 127.0.0.1 only; token file `0600`, `AIFIG_HOME` `0700`; the token is never printed to log files |
| Prompt-injected agent exfiltrating data or reaching local services via the core | Network needs a grant or a yes in the canvas; SSRF guard blocks loopback/private/metadata addresses; everything is logged |
| Malicious web snippet | Separate site, opaque origin, strict CSP (no network), sandboxed frame / webview with its own partition, narrow state bridge, watchdog |
| API keys leaking into files, boards or logs | OS keychain or session memory only; boards never hold keys; logs record names, never values |
| The app window being framed | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |

Out of scope: malware running as your own user (it can read the token file, your keychain session and the boards, and
could call the permission API directly — prompts guard the agent tool surface, not arbitrary local code); a
compromised Electron/Chromium; physical access. Known gaps: the SSRF check resolves DNS before the fetch (a rebinding
race remains); URL embeds may load any https page inside their own partition; `/api/call` trusts the `caller` a token
holder declares (the CLI's `--human`), so permission prompts apply to MCP agents rather than to every local client.

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

## Languages (i18n)

The UI ships in English and Simplified Chinese. It follows the OS / browser language (any `zh*` → 简体中文,
otherwise English); **Settings** (gear, top right; ⌘, in the desktop app) and the desktop **View ▸ Language** menu
override it. The choice is stored per machine (`localStorage` `aifig:locale`) and the desktop menus follow it.

**How to add strings**

1. Add the key to `apps/canvas/src/i18n/en.ts` (the source of truth), then the same key to `zh-CN.ts` —
   `npm run typecheck` fails until every locale has it. Keys are namespaced by area: `menu.*`, `review.*`, …
2. In a component: `const t = useT()` (re-renders on language change), then `t('menu.copy')`. Outside React
   (toasts, helpers) import `t` directly.
3. Placeholders: `'board.deleted': 'Deleted “{title}”'` → `t('board.deleted', { title })`. Counts:
   `{ one: '{count} reply', other: '{count} replies' }` → `t('comments.replies', { count })` (Chinese uses a
   plain string). Inline markup: `tn('connect.http', { url: <code>{url}</code> })`.
4. Native desktop menus and dialogs live in `apps/desktop/src/i18n.mjs` (same two locales).

Chinese copy: full-width punctuation, a space between Chinese and Latin words (`连接 Agent`), product names and
shortcuts unchanged. CJK typography (font fallbacks, line-height, no negative tracking) is set in
`index.css` under `:lang(zh-CN)`; check new layouts in both languages — Chinese strings are shorter but taller,
English ones longer.

## Development

```bash
npm run typecheck                                     # every workspace
npm run test:e2e                                      # canvas engine + app, real pointer/keyboard input (166 checks)
npm run test:onboarding                               # languages, welcome, templates (UI/CLI/MCP), one-click agent setup; isolated core
npm run test:aesthetics                               # agent-output aesthetics vs baselines (update: test:aesthetics:update)
npm run test:data-safety                              # format, migrations, retention, kill -9 / SIGTERM, recovery, versions over MCP + CLI
node scripts/desktop-e2e.mjs                          # Electron app (window, menus, files, theme, bundled MCP, keychain)
npm run test:api                                      # Canvas API regressions (own isolated core)
npm run test:security                                 # token, Host/Origin, WebSocket, permissions, activity, secrets, SSRF
node scripts/mcp-http-smoke.mjs                       # MCP over local HTTP
node scripts/mcp-smoke.mjs                            # MCP over stdio
node scripts/mvp-run.mjs <out-dir>                    # the recorded Phase 0 validation run
node scripts/shot.mjs out.png [--dark] [--w=390]      # screenshot the running canvas (headless Chrome)
npm run test:contrast                                 # WCAG AA contrast of tokens and theme, light and dark
npm run bench                                         # performance report + budgets (see below)
npm run test:telemetry                                # install counting (opt-in, env off, no PII), release manifest, counter service
npm run test:packaging                                # packaged AppImage: core, window, consent, one-click setup, MCP without Node
npm run telemetry:dev                                 # counter service with mock data: http://127.0.0.1:47910/admin
```

### Performance and quality budgets

`npm run bench` generates deterministic 200 / 1k / 10k-block boards (frames, typed blocks, cards, images, web
snippets, connectors) in a temporary home, builds the app and measures:

- cold start: core (empty and with 11k blocks), web (cold browser profile, medium board), desktop (Electron spawning
  its own core)
- open-board time for 1k and 10k boards, browser heap and DOM size, core memory
- 10k board in headless Chrome: fps and main-thread time for pan (100% / 40% / fit) and zoom through the level of
  detail; input→frame latency for hover, select, drag, frame drag and marquee
- Canvas API over MCP (HTTP): `create_blocks` ×10 / ×100 on an empty and a 10k board, `get_board`, `lint_layout`,
  `render_snapshot`, and how responsive the core stays during a large PNG snapshot

It writes `bench-results/latest.json` (`--out=…`) and exits 1 when a metric misses its budget in
`scripts/bench/budgets.json`. Options: `--quick`, `--only=core,web,frames,mcp,desktop`, `--skip-desktop`,
`--skip-build`, `--no-budgets`. Headless Chrome renders in software, so latencies include software raster; fps and
main-thread time are the numbers to watch. `node scripts/bench/profile.mjs <app-url> <board> <scenario>` prints the
hottest functions for one interaction (point it at `npm run dev` for readable names).

How the canvas stays fast on big boards: a spatial grid indexes block bounds incrementally from Yjs changes, so hit
tests, culling, snapping, marquee and connector obstacles only look at nearby blocks; connector routes and labels are
cached against the grid cells around them rather than the whole document; only blocks and connectors near the
viewport are rendered, and new ones outside it are mounted a batch per frame; far zoom draws on a canvas (a cached
bitmap once the view holds thousands of blocks) while mounted blocks stay hidden, so zooming back in is instant. The
core renders snapshots from the same grid, draws unreadably small text as bars, caps PNGs at 16 megapixels and
rasterizes them in a worker thread.
