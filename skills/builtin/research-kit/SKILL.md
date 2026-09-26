---
name: research-kit
description: Synthesize user research on an ai-figma board — interview cards, verbatim quotes with their source, affinity clusters, insights, opportunities and hypotheses — then export a research report. Use when turning interview transcripts, usability notes, surveys or support tickets into findings on the canvas.
metadata:
  aifig:
    version: 1.1.0
    canvas: canvas/blocks.json
    capability: L1
    permissions:
      tools: [web.search]
---

# Research Kit

You do the heavy lifting (reading transcripts, pulling quotes, first clustering); the person corrects the
clusters and owns the conclusions. Every insight must trace back to verbatim quotes with a source.

## Block types

| Type | Base | Use it for | Fields |
|---|---|---|---|
| `research-kit.interview` | card | one session — title = "P3 · Staff engineer", body = one-line summary | `participant`, `role`, `date`, `segment`, `method` |
| `research-kit.quote` | sticky | one verbatim quote, never paraphrased | `participant`, `source`, `ref` (file:line or timestamp), `theme`, `sentiment`, `stage` |
| `research-kit.insight` | card | a finding backed by **three or more** quotes — title = the finding in plain words, body = why it matters | `theme`, `confidence` (by evidence), `evidence` (quote count), `participants` (people count), `stage` |
| `research-kit.opportunity` | card | "How might we …" framed from an insight | `impact`, `effort` |
| `hypothesis` (built-in) | card | a belief to test next | `status`, `confidence` |

Relations: interview *yields* quote, quote *supports* insight, insight *inspires* opportunity, insight *raises*
hypothesis.

Layouts: `research-kit.by-participant` (coverage check), `research-kit.quote-affinity` (quotes by theme),
`research-kit.affinity` (insights by theme), `research-kit.opportunity-matrix` (impact × effort, high impact on
top), `research-kit.journey` (by `stage`).

## Workflow: interviews → report

1. **Start the board.** `create_board { template: "interview-synthesis", language }` enables this skill with
   frames for Interviews, Quotes, Insights and Opportunities. `get_board`, then delete the example blocks.
2. **Interviews.** `begin_change_set { intent: "Log interviews" }`; one `research-kit.interview` card per
   transcript in the "Interviews" frame (`layout: "row"`), fields from the transcript header. Commit.
3. **Pull quotes.** For each transcript, 4–8 quotes that carry a need, a pain or a workaround. Keep the
   participant's words, trimmed to the essential sentence. Fill `participant`, `source` and `ref` (the file and
   line, or the timestamp) so every quote can be checked. Create them in "Quotes"; the `participant` field links
   each quote to its interview, so don't draw interview → quote connectors (too many lines).
   Apply `research-kit.by-participant` to show coverage.
4. **Cluster.** Give each quote a short `theme` (`set_type` with `fields: { theme }`, 3–6 themes in total, names
   the team would use). Apply `research-kit.quote-affinity`. Commit this as its own change set — this is the step
   the person corrects most; wait for their review (`list_change_sets`) before building on it.
5. **Insights.** For each theme with 3+ quotes from 2+ participants, one `research-kit.insight` in "Insights"
   with `theme`, `evidence` (quotes), `participants` (people) and `confidence` (high = 3+ participants, medium = 2,
   low = otherwise). Connect every supporting quote → insight. Apply `research-kit.affinity`. Themes with fewer
   quotes stay as quotes; mention them in a comment.
6. **Opportunities and hypotheses.** One or two `research-kit.opportunity` cards per insight ("How might we …?")
   with `impact` / `effort`; apply `research-kit.opportunity-matrix`. Turn the riskiest assumption behind each top
   opportunity into a built-in `hypothesis` card (`status: unverified`) and connect insight → hypothesis.
7. **Check and hand over.** `lint_layout`, `render_snapshot`, commit. Ask the person to review the clusters and
   insights; read `get_threads` and fix what they rejected.
8. **Report.** `export_board { format: "md" }` gives the evidence organized by type; write the report as the
   `report` prompt describes and reply with it (or save it where the person asks).

## Rules

- Quotes are verbatim. Never merge two people's words into one quote; never invent participants or numbers.
- An insight without three connected quotes is a hunch — make it a `question` or `hypothesis` instead.
- Keep personal data out: use P1, P2… and roles, not names or emails.

Action: **Find related sources** runs a web search for an insight (needs a `web` MCP server with a `search` tool
in `~/.aifig/mcp.json`) and adds the results as stickies next to it, for review.
