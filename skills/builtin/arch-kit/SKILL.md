---
name: arch-kit
description: Map a codebase or a system design on an ai-figma board — modules, services, interface contracts, data stores, external dependencies, architecture decisions (ADRs) and risks — so a person can review the architecture before code is written, and run incident reviews as a timeline. Use when asked to explain, map, review or plan the architecture of a repository.
metadata:
  aifig:
    version: 1.0.0
    canvas: canvas/blocks.json
    capability: L0
---

# Architecture Kit

The board is the shared design document: you read the code, lay out what is there (or what you propose), the
person reviews it item by item, and then you implement exactly what the board says.

## Block types

| Type | Base | Use it for | Fields |
|---|---|---|---|
| `arch-kit.module` | card | a package, library or folder with one job | `path`, `layer` (ui / api / domain / data / infra / tooling), `language`, `owner`, `status` (stable / changing / new / deprecated) |
| `arch-kit.service` | card | something that runs (process, server, worker, app) | `runtime`, `port`, `entry`, `layer` |
| `arch-kit.interface` | card | a contract: endpoint, MCP tool, CLI command, event, file format | `kind` (http / websocket / mcp / cli / event / function / file), `signature`, `stability`, `auth` |
| `arch-kit.datastore` | card | where state lives | `engine`, `holds`, `location` |
| `arch-kit.external` | card | a dependency you don't own | `kind` (library / service / platform / tool), `version`, `license` |
| `arch-kit.decision` | card | an ADR — title = the decision, body = context and consequences | `status` (proposed / accepted / superseded / rejected), `date`, `deciders` |
| `arch-kit.risk` | sticky | what could go wrong | `severity`, `likelihood`, `mitigation` |
| `arch-kit.event` | sticky | one moment of an incident | `time`, `phase` (trigger / detect / impact / respond / recover / learn), `actor` |

Connectors get a suggested relation: module *depends on* module, module *exposes* interface, service *runs*
module, module *stores in* data store, decision *shapes* module, risk *threatens* module, event *leads to* event.

Layouts (`apply_skill_layout`): `arch-kit.layers` (columns by layer), `arch-kit.contracts` (interfaces by
kind × stability), `arch-kit.risk-matrix` (severity × likelihood), `arch-kit.adr-log` and
`arch-kit.incident-timeline` (in date order).

## Workflow: map a repository

Work in one change set per step so the person can review each layer separately.

1. **Start the board.** `create_board { template: "architecture-map", language: "en" | "zh-CN" }` gives a board
   with this skill enabled and the frames below (or ask the person to enable arch-kit on an existing board).
   Call `get_board` and remove the example content you won't reuse (`delete_blocks`).
2. **Read the repo.** Workspace manifests (`package.json` workspaces, `pnpm-workspace.yaml`, `go.work`,
   `Cargo.toml`, `pyproject.toml`), entry points (`bin/`, `main`, `cmd/`), each package's own manifest and imports.
   Note for each package: path, language, what it does in one sentence, what it imports from the others.
3. **Modules and services.** `set_status "Mapping modules…"`, `begin_change_set { intent: "Map modules" }`, then
   `create_blocks { frame: "Modules", layout: "grid", blocks: [...] }` — one `arch-kit.module` card per package
   (title = package name, text = one sentence on its job) and one `arch-kit.service` per running process. Always
   fill `path` and `layer`. Apply `arch-kit.layers` with `frame: "Modules"`.
4. **Dependencies.** `connect` module → module for every internal import (`relation` is filled in), and
   module → `arch-kit.external` for the few external dependencies that shape the design (frameworks, storage,
   protocols) — not every npm package.
5. **Contracts.** `create_blocks { frame: "Contracts", right_of: "Modules" }` with one `arch-kit.interface` per
   boundary people call across (HTTP routes, MCP tools, CLI commands, WebSocket, file formats). `signature` is the
   shortest faithful form (`POST /api/call {tool,args,caller}`). Connect module *exposes* interface. Apply
   `arch-kit.contracts`.
6. **State, decisions, risks.** `arch-kit.datastore` cards for where state lives; `arch-kit.decision` cards for
   decisions visible in the code or docs (status `accepted`) or that you propose (status `proposed`);
   `arch-kit.risk` stickies for coupling, single points of failure, missing auth, scaling limits. Apply
   `arch-kit.risk-matrix`.
7. **Check your work.** `lint_layout` (fix every issue), then `render_snapshot` and look at it. Commit the change
   set and tell the person what to review: "Review the Modules frame first; reject anything I got wrong."
8. **Review loop.** `list_change_sets` shows accepted / rejected items with reasons; `get_threads` shows comments.
   Fix what was rejected, answer threads with `reply_thread`, resolve them when done.
9. **Implement from the board.** When the person accepts a proposal (a `proposed` decision, a `new` module, a
   changed interface), implement exactly that, then update the board: status `accepted`, module status `stable`,
   and a `reply_thread` linking the commit.

## Workflow: incident review

1. `create_board { template: "incident-review" }` (or reuse the architecture board).
2. One `arch-kit.event` sticky per fact from logs, alerts and chat, with `time` (ISO, e.g. `2026-09-12 14:05`),
   `phase` and `actor`. Facts only — no blame, no guesses.
3. `apply_skill_layout { layout: "arch-kit.incident-timeline" }` orders them and joins them with arrows.
4. Connect events to the modules / interfaces involved (*involves*), add `arch-kit.risk` stickies for contributing
   factors and `arch-kit.decision` cards (status `proposed`) for follow-ups, each connected from the event that
   prompted it.
5. `export_board { format: "md" }` gives the write-up, organized by type.

## Rules

- Describe what the code does, not what the README hopes. When unsure, say so in the text and leave fields empty.
- One card per package or boundary; don't draw every file. 8–20 modules is a readable map.
- Keep titles to the name people use in conversation; put paths in `path`, not the title.
- Never write secrets, tokens or internal hostnames onto the board.
