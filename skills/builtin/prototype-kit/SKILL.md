---
name: prototype-kit
description: Build an AI prototype wall on an ai-figma board — several interactive HTML/CSS/JS variants of the same screen side by side as sandboxed web snippets, each with its rationale, review feedback and a final decision — then iterate on what people say. Use when asked to explore UI directions, compare designs or prototype a flow on the canvas.
metadata:
  aifig:
    version: 1.0.0
    canvas: canvas/blocks.json
    capability: L0
---

# Prototype Kit

A wall of live variants: you write 2–4 small interactive prototypes of the same brief, people click through them
on the canvas and leave feedback, you iterate, and the board ends with a decision.

## Block types

| Type | Base | Use it for | Fields |
|---|---|---|---|
| `prototype-kit.brief` | card | the job — title = the screen or flow, body = the problem in two sentences | `audience`, `success`, `constraints` |
| `prototype-kit.variant` | card | one direction, above its snippet — title = a name people can say ("Guided wizard") | `label` (A, B, C), `approach`, `round`, `status` (exploring / shortlisted / chosen / dropped) |
| `prototype-kit.feedback` | sticky | one review note | `variant`, `verdict` (keep / change / drop), `author` |
| `prototype-kit.decision` | card | what goes forward and why | `chosen`, `status` (proposed / decided), `date` |

The prototype itself is a **web snippet** (`create_snippet` with inline `html` / `css` / `js`). Snippets run
sandboxed on a separate origin with **no network**: inline everything (no CDN scripts, fonts or images; use
`data:` URLs or CSS), keep each under ~200 lines, and use `aifig.getState()` / `aifig.setState()` if a prototype
needs to remember something. They show a static preview until a person double-clicks them.

Layouts: `prototype-kit.feedback-by-variant` (a column per variant), `prototype-kit.feedback-matrix`
(verdict × variant).

## Workflow: brief → variants → decision

1. **Start the board.** `create_board { template: "prototype-wall", language }` enables this skill and lays out
   a Brief frame, three variant frames and a Decision frame. `get_board`, then replace the example content (or
   `delete_blocks` the example variant frames).
2. **Brief.** One `prototype-kit.brief` card: audience, what success looks like, constraints. If the person gave
   no success criterion, ask for one before building.
3. **Variants.** `begin_change_set { intent: "Prototype wall, round 1" }`. For each of 2–4 genuinely different
   directions (different interaction models, not different colors):
   - `create_blocks { frame: "A · Guided wizard", right_of: <previous frame>, layout: "stack", blocks: [{ type: "prototype-kit.variant", title, text: why this direction, fields: { label: "A", approach, round: 1 } }] }`
   - `create_snippet { inside: "A · Guided wizard", html, css, js, title: "A · Guided wizard", width: 360, height: 480 }`
     — same width and height for every variant so they compare side by side. Make the core interaction really
     work (clicks, state, validation), with realistic copy.
   Connect the brief → each variant card (*explored by*). `lint_layout`, `render_snapshot` to check the previews,
   commit, and ask people to double-click each variant and comment (`M`) or add feedback stickies.
4. **Collect feedback.** `get_threads` for comments on the snippets and cards. Turn each into a
   `prototype-kit.feedback` sticky in a "Feedback" frame (`variant`, `verdict`, `author` = who said it), resolve the
   thread with `reply_thread` + `resolve_thread`. Apply `prototype-kit.feedback-matrix`.
5. **Iterate.** For variants with `keep` / `change` feedback: `update_snippet { id, html | css | js }` (the person
   sees a source diff in review), bump `round`, and reply to the feedback. Set clearly rejected variants to
   `status: dropped`; the best one or two to `shortlisted`.
6. **Decide.** When the person picks, one `prototype-kit.decision` card (`chosen`, `status: decided`, `date`) in
   the Decision frame; connect the winning variant → decision and the feedback that informed it. Set the variant's
   status to `chosen`. `export_board { format: "md" }` summarizes the wall; the chosen snippet's source is in
   `get_board { format: "json" }` for implementation.

## Rules

- Variants must differ in approach. Three color swaps are one variant.
- Accessible by default: real `<button>`s and `<label>`s, visible focus, 4.5:1 text contrast.
- Keep each snippet self-contained; never load anything from the network (it will be blocked).
- Don't delete dropped variants — the wall is the record of what was tried.
