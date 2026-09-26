import type { Site } from '@/config/site'

/** Scenario pages and the Home section. Block order matches `scenarios[slug].blocks` in src/content/scenarios.ts. */
export default function scenariosEn(s: Site) {
  return {
    eyebrow: 'Scenarios',
    title: 'Work your agent already does, laid out where you can check it.',
    lede: 'Each scenario is a Skill: block types, layouts and a step-by-step workflow your agent follows. It does the reading, extracting and arranging; you review the board and decide what stays.',
    lead: 'Start here',
    open: 'See how it works',
    all: 'All scenarios',
    page: {
      metaTitle: '{title} with Claude Code or Cursor',
      problem: 'The problem',
      how: 'How your agent runs it',
      howLede: 'The workflow ships in the Skill’s SKILL.md, so every agent follows the same steps — and stops for you where it matters.',
      agent: 'Agent',
      you: 'You',
      blocks: 'Blocks on the board',
      blocksLede: 'Typed blocks from the Skill, each with its own fields, color and card layout. Your agent fills them; you can edit any field.',
      shot: 'On the board',
      illustration: 'Illustration',
      illustrationNote: 'An illustration of the board this Skill produces, drawn with the product’s tokens.',
      tryIt: 'Try it',
      tryLede: 'Three steps, about two minutes. You need Claude Code or Cursor.',
      install: {
        title: 'Install and connect',
        body: `Download ${s.name} and open Help › Connect agent. It adds the MCP server to Claude Code and Cursor after you confirm.`,
        cta: 'Download',
      },
      enable: {
        title: 'Enable the Skill',
        body: 'Open a board, click the puzzle icon (Skills, top right) and enable {skill}. From a terminal:',
      },
      paste: {
        title: 'Paste this into Claude Code',
        body: 'Run it from the folder your agent should read. It writes one change set and waits for your review.',
      },
      promptTitle: 'Prompt',
      others: 'Other scenarios',
      breadcrumb: 'Breadcrumb',
    },
    items: {
      architecture: {
        title: 'Architecture & code understanding',
        short: 'Architecture',
        tagline: 'Map a codebase before you change it.',
        summary: 'Your agent reads the repository and draws modules, calls and interface contracts on the board. You correct the picture, then it builds against it.',
        problem: {
          body: 'A new repository, a refactor, an incident review. The shape of the system lives across dozens of folders and a few people’s heads, and a wall of generated prose doesn’t show it. You need modules, calls and contracts side by side — and a chance to fix the picture before any code moves.',
          points: [
            'Generated summaries are linear; systems aren’t',
            'Diagrams drawn by hand go stale after the next merge',
            'Mistakes in an agent’s mental model surface only in its code',
          ],
        },
        steps: [
          { title: 'Read the repository', body: 'The agent walks the code with its own tools: entry points, imports, routes, schemas and config.', you: false },
          { title: 'Draw modules and calls', body: 'Modules, services, data stores and external dependencies become typed blocks, connected by the calls between them and laid out as a flow.', you: false },
          { title: 'Annotate the contracts', body: 'Endpoints, payloads and events go on the edges. Open decisions become ADR blocks; risks are pinned where they live.', you: false },
          { title: 'Review the picture', body: 'It all arrives as one change set. Reject a wrong edge with a reason or comment on a module — the agent reads it and redraws.', you: true },
          { title: 'Build from the board', body: 'Once the map is right, ask the agent to implement against it. For incidents, the kit adds a postmortem timeline template.', you: false },
        ],
        blocks: [
          { name: 'Module', body: 'A package or folder with a clear job.' },
          { name: 'Service', body: 'Something that runs: a process, worker or function.' },
          { name: 'Interface contract', body: 'An endpoint, event or API with its payload.' },
          { name: 'Data store', body: 'A database, queue, cache or bucket.' },
          { name: 'External dependency', body: 'A third-party API or SaaS the system calls.' },
          { name: 'Decision (ADR)', body: 'Context, the choice made, and its status.' },
          { name: 'Risk', body: 'What could break, how badly, and who owns it.' },
        ],
        board: {
          title: 'checkout-service — architecture',
          frames: [
            {
              title: 'Modules & calls',
              items: [
                { block: 0, title: 'api/routes', meta: 'HTTP entry · 14 routes' },
                { block: 1, title: 'PaymentService', meta: 'charges, refunds' },
                { block: 3, title: 'ledger', meta: 'Postgres · append-only' },
                { block: 4, title: 'Stripe API', meta: 'charges + webhooks' },
              ],
            },
            {
              title: 'Contracts & risks',
              items: [
                { block: 2, title: 'POST /v1/charges', meta: 'Idempotency-Key required' },
                { block: 5, title: 'ADR-7: outbox for events', meta: 'accepted' },
                { block: 6, title: 'Webhook retries double-post', meta: 'high · payments team' },
              ],
            },
          ],
        },
        prompt: `Use the arch-kit skill from ${s.name} (get_skill "arch-kit").\nRead this repository and map it on the board: modules, services, data stores and external dependencies, the calls between them, and the interface contract on each edge.\nFlag risks and open decisions as ADR blocks.\nPut everything in one change set and wait for my review before changing any code.`,
        shotAlt: 'An architecture board: modules, services, a data store and Stripe connected by calls, with contracts, an ADR and a risk',
      },
      'user-research': {
        title: 'User research synthesis',
        short: 'User research',
        tagline: 'From transcripts to insights you can trace.',
        summary: 'Your agent pulls verbatim quotes with their source, clusters them and drafts insights. You fix the clusters; every claim stays linked to who said it.',
        problem: {
          body: 'Six interviews, forty pages of notes. The quotes that matter are buried, affinity mapping takes a day, and by the time the deck is ready nobody can say which participant said what.',
          points: ['Synthesis is slow, so it gets skipped', 'Summaries lose the evidence behind them', 'Clusters reflect whoever sorted the stickies'],
        },
        steps: [
          { title: 'Read the transcripts', body: 'The agent reads interview notes or transcripts from a folder you point it at.', you: false },
          { title: 'Pull quotes with sources', body: 'Verbatim quotes become Quote blocks with the participant and timestamp, next to an Interview block per session.', you: false },
          { title: 'Cluster by affinity', body: 'Quotes are grouped into themes with the cluster layout, so similar evidence sits together.', you: false },
          { title: 'Draft insights and opportunities', body: 'Each insight links to the quotes that support it; opportunities and hypotheses follow from the insights.', you: false },
          { title: 'Correct the synthesis', body: 'Move a quote, merge two themes, reject an insight that overreaches. The agent reads your reasons.', you: true },
          { title: 'Export the report', body: 'The board exports as a Markdown research report, organized by theme, with every quote cited.', you: false },
        ],
        blocks: [
          { name: 'Interview', body: 'One session: participant, role, date.' },
          { name: 'Quote', body: 'Verbatim words, who said them and when.' },
          { name: 'Insight', body: 'What the evidence means, and how strongly.' },
          { name: 'Opportunity', body: 'A need worth solving, linked to insights.' },
          { name: 'Hypothesis', body: 'A testable bet with a status.' },
        ],
        board: {
          title: 'Onboarding interviews — synthesis',
          frames: [
            {
              title: 'Evidence',
              items: [
                { block: 0, title: 'P3 · Product designer', meta: '45 min · Sep 12' },
                { block: 1, title: '“A blank canvas makes me freeze.”', meta: 'P3 · 12:40' },
                { block: 1, title: '“I copy notes into slides by hand.”', meta: 'P5 · 31:05' },
              ],
            },
            {
              title: 'Synthesis',
              items: [
                { block: 2, title: 'Starting is the hardest part', meta: '4 of 6 participants' },
                { block: 3, title: 'Boards seeded from the brief', meta: 'linked to 3 quotes' },
                { block: 4, title: 'A starter board halves time to first note', meta: 'unverified' },
              ],
            },
          ],
        },
        prompt: `Use the research-kit skill from ${s.name} (get_skill "research-kit").\nRead the interview transcripts in ./interviews and synthesize them on the board: pull verbatim quotes with the participant and timestamp, cluster them by theme, then add insights and opportunities linked to the quotes that support them.\nOne change set, so I can review it.`,
        shotAlt: 'A research board: interview and quote blocks on the left, insights, an opportunity and a hypothesis on the right',
      },
      'product-discovery': {
        title: 'Product discovery',
        short: 'Product discovery',
        tagline: 'From a crowded market to a PRD outline.',
        summary: 'Your agent builds the competitor matrix, an opportunity–solution tree and a priority matrix. You make the calls; it exports the PRD outline.',
        problem: {
          body: 'Competitor research sits in one doc, opportunities in another, and the roadmap in a third. The reasoning that connects them — why this bet, not that one — gets lost between tabs.',
          points: ['Market scans go stale in weeks', 'Priorities are argued, not shown', 'PRDs start from a blank page'],
        },
        steps: [
          { title: 'Map the market', body: 'Competitor cards with segment, positioning and price, laid out as a positioning matrix.', you: false },
          { title: 'Grow the opportunity–solution tree', body: 'Opportunities from the market and your notes, with candidate solutions and experiments beneath them.', you: false },
          { title: 'Prioritize', body: 'Solutions go on an impact × effort matrix, each tied to a metric.', you: false },
          { title: 'Make the calls', body: 'Accept, reject or re-rank. Your comments on a card become the agent’s next brief.', you: true },
          { title: 'Export the PRD outline', body: 'Chosen solutions, their requirements and metrics export as a Markdown PRD outline.', you: false },
        ],
        blocks: [
          { name: 'Competitor', body: 'Segment, positioning, price, link.' },
          { name: 'Opportunity', body: 'A customer need, with reach.' },
          { name: 'Solution', body: 'A way to address an opportunity.' },
          { name: 'Experiment', body: 'How you’ll learn, and for how long.' },
          { name: 'Metric', body: 'What moves if it works, with a target.' },
          { name: 'Requirement', body: 'Must-have or nice-to-have, for the PRD.' },
        ],
        board: {
          title: 'Team whiteboards — discovery',
          frames: [
            {
              title: 'Market',
              items: [
                { block: 0, title: 'FigJam', meta: 'mainstream · $5/seat' },
                { block: 0, title: 'Miro', meta: 'premium · enterprise' },
                { block: 1, title: 'Agents can’t write to boards today', meta: 'high reach' },
              ],
            },
            {
              title: 'Bets',
              items: [
                { block: 2, title: 'MCP-native canvas', meta: 'addresses 2 opportunities' },
                { block: 3, title: 'Concierge test with 5 teams', meta: '2 weeks' },
                { block: 4, title: 'Boards with agent edits', meta: 'target: 3 per team / week' },
              ],
            },
          ],
        },
        prompt: `Use the product-kit skill from ${s.name} (get_skill "product-kit").\nOn the board, map the main competitors for team whiteboards as a positioning matrix, then build an opportunity–solution tree from it and place the solutions on an impact × effort matrix with a metric each.\nPut it in one change set; after I review, export a PRD outline for the solutions I keep.`,
        shotAlt: 'A discovery board: competitor cards and an opportunity in one frame, a solution, an experiment and a metric in another',
      },
      'prototype-wall': {
        title: 'AI prototype wall',
        short: 'Prototype wall',
        tagline: 'Several working directions, side by side.',
        summary: 'Your agent builds interactive HTML variants next to each other on the board. You annotate them in place; it iterates until you pick one.',
        problem: {
          body: 'Asking an agent for a UI gets you one answer at a time, in a chat. Comparing directions means screenshots, tabs and lost context — and feedback lands far from the thing it’s about.',
          points: ['One variant at a time hides the trade-offs', 'Feedback is detached from the design', 'Decisions leave no trail'],
        },
        steps: [
          { title: 'Generate variants side by side', body: 'The agent writes several interactive HTML/CSS/JS snippets in a row — each runs in a sandbox with no network.', you: false },
          { title: 'Annotate in place', body: 'Double-click to try a variant, then pin review notes and comments right next to it.', you: true },
          { title: 'Iterate', body: 'The agent reads your notes and revises the snippets; each edit arrives as a reviewable diff.', you: false },
          { title: 'Pick one', body: 'Record the choice as a Decision block that links to the winning variant and the notes behind it.', you: true },
        ],
        blocks: [
          { name: 'Variant', body: 'An interactive web snippet, runnable in place.' },
          { name: 'Review note', body: 'Feedback pinned to a variant.' },
          { name: 'Decision', body: 'What was chosen, and why.' },
        ],
        board: {
          title: 'Pricing page — prototype wall',
          frames: [
            {
              title: 'Variants',
              items: [
                { block: 0, title: 'A · Three tiers', meta: 'HTML snippet · runs in place' },
                { block: 0, title: 'B · Usage slider', meta: 'HTML snippet' },
                { block: 0, title: 'C · Calculator first', meta: 'HTML snippet' },
              ],
            },
            {
              title: 'Review',
              items: [
                { block: 1, title: 'The slider hides the free tier', meta: 'on B' },
                { block: 1, title: 'Clearest for teams', meta: 'on C' },
                { block: 2, title: 'Ship C with A’s free tier', meta: 'decided Sep 26' },
              ],
            },
          ],
        },
        prompt: `Use the prototype-kit skill from ${s.name} (get_skill "prototype-kit").\nBuild three interactive variants of a pricing page as web snippets, side by side on the board: three tiers, a usage slider, and calculator-first.\nWait for my review notes, then revise the variants I comment on.`,
        shotAlt: 'A prototype wall: three pricing-page variants in a row, with review notes and a decision',
      },
      'literature-review': {
        title: 'Literature review',
        short: 'Literature review',
        tagline: 'An argument map with every claim sourced.',
        summary: 'Your agent reads the papers, extracts claims and evidence with citations and builds an argument map. You check it; it exports the review outline.',
        problem: {
          body: 'Twenty PDFs, highlights in three apps, and a draft that cites from memory. The structure of the debate — who claims what, on which evidence, and who disagrees — never makes it onto one page.',
          points: ['Notes lose their page numbers', 'Counter-evidence is easy to miss', 'The outline hides the argument’s shape'],
        },
        steps: [
          { title: 'Read the papers', body: 'The agent reads the PDFs or notes in a folder you point it at.', you: false },
          { title: 'Extract claims and evidence', body: 'Claims, evidence and counterarguments become blocks, each with the paper, page or section it came from.', you: false },
          { title: 'Build the argument map', body: 'Evidence supports or contradicts claims; claims answer your research questions — as connectors with relations.', you: false },
          { title: 'Check the map', body: 'Reject a claim the paper doesn’t make, add a missing counterargument. Nothing is final until you accept it.', you: true },
          { title: 'Export the outline', body: 'The map exports as a Markdown review outline, grouped by research question, with citations.', you: false },
        ],
        blocks: [
          { name: 'Paper', body: 'Authors, year, venue, method.' },
          { name: 'Claim', body: 'A position a paper argues.' },
          { name: 'Evidence', body: 'A result, with page or section.' },
          { name: 'Counterargument', body: 'What pushes back, and from where.' },
          { name: 'Research question', body: 'What the review is trying to answer.' },
        ],
        board: {
          title: 'Remote pair programming — review',
          frames: [
            {
              title: 'Sources',
              items: [
                { block: 0, title: 'Smith et al. 2024', meta: 'CSCW · n = 48' },
                { block: 0, title: 'Chen & Ruiz 2025', meta: 'ICSE · field study' },
                { block: 4, title: 'Does async review hurt learning?', meta: 'RQ2' },
              ],
            },
            {
              title: 'Argument',
              items: [
                { block: 1, title: 'Remote pairing keeps defect rates flat', meta: '2 papers' },
                { block: 2, title: '−3% defects, 95% CI', meta: 'Smith 2024, p. 7' },
                { block: 3, title: 'Samples skew senior', meta: 'Chen 2025, §5' },
              ],
            },
          ],
        },
        prompt: `Use the lit-kit skill from ${s.name} (get_skill "lit-kit").\nRead the papers in ./papers and build an argument map on the board: claims, the evidence for and against each one with the page or section it came from, and the research questions they answer.\nOne change set for my review, then export a review outline.`,
        shotAlt: 'A literature board: papers and a research question on the left, a claim with evidence and a counterargument on the right',
      },
    },
  }
}

export type ScenariosDict = ReturnType<typeof scenariosEn>
