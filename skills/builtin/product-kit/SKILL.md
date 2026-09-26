---
name: product-kit
description: Explore a product space and shape a solution on an ai-figma board — competitor matrix, opportunity-solution tree, priority matrix, experiments, metrics and requirements — then export a PRD outline. Use for competitive analysis, product discovery, prioritization and writing PRDs on the canvas. Includes everything competitor-kit had.
metadata:
  aifig:
    version: 2.0.0
    canvas: canvas/blocks.json
    capability: L1
    permissions:
      tools: [fetch.fetch]
---

# Product Kit

From "what's out there" to "what we'll build": compare the market, find opportunities, branch solutions under
them, pick with a priority matrix, and turn the committed solution into a PRD outline.

## Block types

| Type | Base | Use it for | Fields |
|---|---|---|---|
| `product-kit.competitor` | card | one product — title = name, body = one-line pitch in their words | `segment`, `positioning` (budget / mainstream / premium), `price` (number, per seat per month), `url` |
| `product-kit.feature` | sticky | one competitor × capability — text = what they offer, in a few words ("Cloud only") | `competitor`, `capability`, `status` (has / partial / missing) |
| `product-kit.launch` | sticky | a dated release | `date` (YYYY-MM), `competitor` |
| `product-kit.opportunity` | card | an unmet need — title as the customer would say it | `segment`, `evidence`, `size` |
| `product-kit.solution` | card | one way to address an opportunity | `impact`, `effort`, `confidence`, `status` (idea / exploring / committed / shipped / dropped) |
| `product-kit.experiment` | card | the cheapest test of a solution's riskiest assumption | `assumption`, `method`, `status` |
| `product-kit.metric` | sticky | how you'll know | `baseline`, `target`, `kind` (north star / input / guardrail) |
| `product-kit.requirement` | card | one line of the PRD | `priority` (must / should / could / won't), `area`, `status` |

Relations: feature *reveals* opportunity, opportunity *solved by* solution, solution *tested by* experiment,
experiment *measures* metric, solution *needs* requirement.

Layouts: `product-kit.competitor-matrix` (capability × competitor), `product-kit.positioning-matrix`,
`product-kit.feature-grid`, `product-kit.launches` (timeline), `product-kit.priority-matrix` (impact × effort,
high impact on top), `product-kit.requirements` (MoSCoW columns).

## Workflow: competitors → PRD

1. **Start the board.** `create_board { template: "product-discovery", language }` enables this skill with the
   frames Competitors, Opportunities, Solutions, Experiments and PRD. `get_board`; replace the example content.
2. **Competitor matrix.** `begin_change_set { intent: "Competitor matrix" }`. One `product-kit.competitor` card per
   product (only prices you can cite; `run_skill_action fetch-homepage` reads a site if a `fetch` MCP server is
   configured). Pick 4–6 capabilities that matter to the target segment and add one `product-kit.feature` per
   competitor × capability in the "Competitors" frame. Apply `product-kit.competitor-matrix`. Commit.
3. **Opportunities.** From competitor gaps, research insights on the board and the person's goals, write 2–4
   `product-kit.opportunity` cards with `evidence` in "Opportunities" (`layout: "stack"`). Connect the features
   that reveal each one.
4. **Opportunity-solution tree.** For each opportunity, 2–3 `product-kit.solution` cards with `impact`, `effort`
   and `confidence`, all in the "Solutions" frame to the right. Connect opportunity → solution (*solved by*): the
   connectors are the tree. Apply `product-kit.priority-matrix` with `frame: "Solutions"`, so the same cards also
   read as impact × effort — top-left first.
5. **Validate.** For the 1–2 most promising solutions, a `product-kit.experiment` (riskiest assumption, cheapest
   method) and the `product-kit.metric`s it moves, in "Experiments"; connect solution → experiment → metric.
   Commit and ask the person to pick. Set the pick to `status: committed` (`set_type` with `fields`), the rest to
   `exploring` or `dropped`.
6. **Requirements.** For the committed solution, 5–10 `product-kit.requirement` cards (`priority`, `area`) in
   "PRD"; connect solution *needs* each (or just the frame, if that's too many lines). Apply
   `product-kit.requirements`.
7. **Check and export.** `lint_layout`, `render_snapshot`, commit. Then write the PRD outline as the `prd` prompt
   describes (start from `export_board { format: "md" }`).

## Rules

- Only use prices, dates and numbers you can cite; leave fields empty otherwise. Don't guess launch dates.
- Opportunities are problems, not features ("I lose context switching tools", not "Add a sidebar").
- Every solution is connected from exactly one opportunity; every requirement traces to the committed solution.
