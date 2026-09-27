---
name: lit-kit
description: Run a literature review on an ai-figma board — papers, claims, supporting evidence and counter-evidence with exact citations, research questions and gaps — built into an argument map, then exported as a review outline. Use when reading papers, reports or preprints and synthesizing what they say on the canvas.
metadata:
  aifig:
    version: 1.0.0
    canvas: canvas/blocks.json
    capability: L0
---

# Literature Kit

You read the papers and extract; the person judges. Every claim on the board traces to evidence with a citation
and a location (page, table, section), and disagreement stays visible as counter-evidence instead of being
averaged away.

## Block types

| Type | Base | Use it for | Fields |
|---|---|---|---|
| `lit-kit.question` | card | a research question — title = the question | `rq` (RQ1…), `status` (open / partly answered / answered / contested) |
| `lit-kit.paper` | card | one source — title = short title, body = one-sentence contribution | `authors`, `year`, `venue`, `method`, `cite` (key), `url` |
| `lit-kit.claim` | card | an argument, in one sentence | `rq`, `consensus` (strong / moderate / weak / contested), `sources` (papers) |
| `lit-kit.evidence` | sticky | a finding or short quote that supports a claim | `cite`, `loc` (p. 7, Table 2), `strength`, `rq` |
| `lit-kit.counter` | sticky | a finding that challenges a claim | `cite`, `loc`, `kind` (opposing result / limitation / failed replication / confound), `rq` |
| `lit-kit.gap` | sticky | what nobody has answered yet | `rq`, `priority` |

Relations: evidence *supports* claim, counter *contradicts* claim, claim *answers* question, paper *reports*
evidence, gap *leaves open* question.

Layouts: `lit-kit.argument-map` (a row per `rq`: supporting evidence → claims ← counter-evidence, then gaps),
`lit-kit.papers-timeline` (by year), `lit-kit.papers-by-method`, `lit-kit.consensus` (consensus × RQ).

## Workflow: papers → argument map → outline

1. **Start the board.** `create_board { template: "literature-review", language }` enables this skill with frames
   for Questions, Papers, Argument map and Gaps. `get_board`, then replace the example content.
2. **Questions.** One `lit-kit.question` card per research question (`rq: "RQ1"`, …). Ask the person to confirm
   them before reading — they decide what counts as relevant.
3. **Papers.** `begin_change_set { intent: "Log papers" }`. One `lit-kit.paper` card per source in "Papers",
   fields from the paper itself (never guess a year or venue), `cite` = a short key (`lee2024`). Apply
   `lit-kit.papers-timeline`. Commit.
4. **Extract.** For each paper, the findings that bear on a research question: `lit-kit.evidence` stickies (or
   `lit-kit.counter` when it challenges the emerging answer), each with `cite`, `loc` and `rq`. Short verbatim
   quotes in quotation marks; otherwise a faithful one-line paraphrase of the result, with the numbers.
5. **Claims.** Group evidence into `lit-kit.claim` cards — one sentence each, `rq`, `sources` (distinct papers)
   and `consensus` (strong = 3+ papers agree and no counter-evidence; contested = counter-evidence of similar
   strength). Connect evidence → claim and counter → claim (relations are filled in), claim → question.
   Put claims, evidence and counters in "Argument map".
6. **Gaps.** `lit-kit.gap` stickies (with `rq`) for what the papers leave open, in the same frame; connect each to
   its question. Apply `lit-kit.argument-map`, update question `status`, and commit as its own change set — this is
   the part the person reviews hardest.
7. **Check and export.** `lint_layout`, `render_snapshot`, commit. Write the review outline as the `outline`
   prompt describes (start from `export_board { format: "markdown" }`).

## Rules

- Never cite something that isn't on the board, and never invent a page number — leave `loc` empty if unsure.
- Keep counter-evidence even when it's inconvenient; a contested claim is a finding.
- Distinguish what a paper shows (its results) from what it cites or speculates.
