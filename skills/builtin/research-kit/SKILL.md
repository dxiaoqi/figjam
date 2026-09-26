---
name: research-kit
description: Turn interview notes and desk research into quotes, insights and opportunities on an ai-figma board, then lay them out as an affinity map, an opportunity matrix or a journey timeline. Use when synthesizing user research on the canvas.
metadata:
  aifig:
    version: 1.0.0
    canvas: canvas/blocks.json
    capability: L1
    permissions:
      tools: [web.search]
---

# Research Kit

Synthesis in three steps, each with its own block type:

1. **`research-kit.quote`** (sticky) — one verbatim quote per sticky, never paraphrased. Fill `participant`
   (P1, P2, …) and `source` (interview, survey, review…). Set `sentiment` only when it is obvious.
2. **`research-kit.insight`** (card) — a finding backed by **three or more** quotes. Title = the finding in plain
   words ("Setup takes longer than people expect"); body = why it matters. Set `theme` (short, shared across
   related insights), `confidence` (low / medium / high, by how much evidence there is) and `evidence` (count of
   supporting quotes). Connect each supporting quote to the insight (the relation "supports" is filled in).
3. **`research-kit.opportunity`** (card) — "How might we …" framed from an insight, with `impact` and `effort`.

Layouts (apply_skill_layout):

- `research-kit.affinity` — insights grouped by `theme`.
- `research-kit.opportunity-matrix` — opportunities by impact × effort.
- `research-kit.journey` — quotes and insights along a journey `stage`.

Action: **Find related sources** runs a web search for an insight (needs a `web` MCP server with a `search` tool
in `~/.aifig/mcp.json`) and adds the results as stickies next to it, for review.

Keep quotes short (trim to the essential sentence). Don't invent participants or numbers.
