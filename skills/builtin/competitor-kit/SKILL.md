---
name: competitor-kit
description: Map competitors on an ai-figma board — competitor cards with pricing and positioning, feature checks and launch history — and compare them as a positioning matrix, a feature grid or a launch timeline. Use for competitive analysis on the canvas.
metadata:
  aifig:
    version: 1.0.0
    canvas: canvas/blocks.json
    capability: L1
    permissions:
      tools: [fetch.fetch]
---

# Competitor Kit

- **`competitor-kit.competitor`** (card) — one per product. Title = product name; body = one-line pitch in their
  words. Fields: `segment` (who it's for), `positioning` (budget / mainstream / premium), `price` (entry price
  per seat per month, a number), `url`.
- **`competitor-kit.feature`** (sticky) — "<Competitor>: <feature>" with `status` (has / partial / missing).
  Connect it to its competitor.
- **`competitor-kit.launch`** (sticky) — a dated release or event, with `date` (YYYY-MM or YYYY-MM-DD) and
  `competitor`.

Layouts: `competitor-kit.positioning-matrix` (segment × positioning), `competitor-kit.feature-grid`
(features by status), `competitor-kit.launches` (timeline by date).

Action: **Fetch homepage** reads a competitor's `url` (needs a `fetch` MCP server, e.g. the reference
`mcp-server-fetch`) and adds the page summary as a sticky for review.

Only use prices you can cite; leave `price` empty otherwise. Don't guess launch dates.
