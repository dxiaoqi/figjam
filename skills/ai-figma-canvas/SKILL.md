---
name: ai-figma-canvas
description: Put research, options, plans and diagrams on the user's local ai-figma canvas so they come out tidy and reviewable. Use when the user asks to "put this on the board/canvas", sketch a flow, cluster notes, or compare options visually.
metadata:
  aifig:
    version: 0.1.0
    capability: L1
---

# Using the ai-figma canvas

ai-figma is a local infinite canvas the user has open next to you. You drive it through the `ai-figma` MCP tools
(or the `aifig` CLI). Your edits show up live with your cursor and are grouped into a change set the user accepts
or rejects. The layout engine does positioning — you describe content and structure.

## Workflow

1. `get_board` — see frames, blocks and ids before writing. Note the board id it returns and pass `board` on every later call (the default is the board open in the canvas, which can change under you). Read `warnings` in results: they report snapping, color fallbacks and ignored arguments.
2. `begin_change_set` with a one-line intent ("Cluster interview notes by theme").
3. `create_blocks` with a layout intent. Put related content in a titled frame (`frame: "Competitors"`), or add to an
   existing one (`inside: "<frame id or title>"`). Place new sections with `right_of` / `below` an existing frame.
4. `connect` blocks that have a real relationship. Keep labels to one or two words.
5. `commit_change_set`, then `lint_layout`. If there are issues, `tidy` the frame. Use `render_snapshot` to look.
6. Tell the user what you added and that it's waiting for their review in the canvas.

## Choosing blocks

- **sticky** — one short thought, under ~12 words. Use for brainstorming, notes, quotes.
- **card** — `title` + `text` body. Use for options, competitors, features, steps — anything with detail.
- **text** — headings / labels (`size: "l"`). Clusters get headings automatically.

## Choosing layouts

| Intent | Use for |
|---|---|
| `grid` (default) | a set of peers: options, competitors, ideas |
| `row` | a short sequence or comparison (2–5 items) |
| `stack` | a ranked or ordered list |
| `cluster` | affinity maps: give each block a `group`; one column per group with a heading |
| `tree` | hierarchies, mind maps, flows: give blocks a `ref` and a `parent`; connectors are drawn for you |

## Style rules

- Colors are tokens only: yellow, orange, red, pink, purple, blue, teal, green, gray. Use color to mean something
  (e.g. red = risk, green = strength) and keep to ≤ 4 colors per frame.
- Don't pass coordinates unless the user asked for exact placement.
- Never delete or rewrite the user's own blocks unless asked. If the user rejected a change set, call
  `list_change_sets` to read their reason before trying again.

## Example

```json
{
  "tool": "create_blocks",
  "args": {
    "frame": "Interview synthesis",
    "layout": "cluster",
    "intent": "Cluster the five interviews by theme",
    "blocks": [
      { "text": "Setup took 40 minutes", "group": "Pain points", "color": "red" },
      { "text": "Loves the keyboard shortcuts", "group": "Delights", "color": "green" },
      { "text": "Wants a Figma import", "group": "Requests", "color": "blue" }
    ]
  }
}
```
