// Fixed agent sessions for the "agent output aesthetics" regression set (§6.8).
// Each scenario is what an agent would send over MCP with default parameters; the engine owns the layout.

export const scenarios = [
  {
    name: 'research-synthesis',
    title: 'Research synthesis',
    steps: [
      {
        tool: 'create_blocks',
        args: {
          frame: 'Interview synthesis',
          layout: 'cluster',
          intent: 'Cluster eight interviews by theme',
          blocks: [
            { text: 'Setup took 40 minutes before the first idea', group: 'Pain points', color: 'red' },
            { text: 'Blank canvas is intimidating', group: 'Pain points', color: 'red' },
            { text: 'AI output needs manual cleanup', group: 'Pain points', color: 'red' },
            { text: 'Keyboard shortcuts feel instant', group: 'Delights', color: 'green' },
            { text: 'Stickies look good without effort', group: 'Delights', color: 'green' },
            { text: 'Seeing the agent work builds trust', group: 'Delights', color: 'green' },
            { text: 'Import from FigJam', group: 'Requests', color: 'blue' },
            { text: 'Templates for research', group: 'Requests', color: 'blue' },
            { text: 'Undo everything the agent did', group: 'Requests', color: 'blue' },
          ],
        },
      },
      {
        tool: 'create_blocks',
        args: {
          frame: 'Insights',
          right_of: 'Interview synthesis',
          layout: 'stack',
          blocks: [
            { kind: 'card', title: 'Start from a question', text: 'Open on a prompt; the agent drafts the first board.', color: 'purple' },
            { kind: 'card', title: 'Tidy by default', text: 'Every write goes through tokens and layout intents.', color: 'teal' },
            { kind: 'card', title: 'Review, don’t redo', text: 'Change sets make agent edits reversible.', color: 'blue' },
          ],
        },
      },
      { tool: 'connect', args: { connectors: [{ from: 'Blank canvas is intimidating', to: 'Start from a question' }, { from: 'AI output needs manual cleanup', to: 'Tidy by default' }, { from: 'Undo everything the agent did', to: 'Review, don’t redo' }] } },
    ],
  },
  {
    name: 'competitor-matrix',
    title: 'Competitor matrix',
    steps: [
      {
        tool: 'create_blocks',
        args: {
          frame: 'Competitive landscape',
          layout: 'grid',
          columns: 3,
          blocks: [
            { kind: 'card', title: 'FigJam', text: 'Warm sticky feel, cloud-first; AI is a side button.', color: 'purple' },
            { kind: 'card', title: 'Miro', text: 'Huge template library; MCP output needs cleanup.', color: 'purple' },
            { kind: 'card', title: 'Excalidraw', text: 'Open source and friendly; hand-drawn only.', color: 'purple' },
            { kind: 'card', title: 'tldraw', text: 'Best-in-class canvas SDK; licensing for production.', color: 'blue' },
            { kind: 'card', title: 'Heptabase', text: 'Local-first knowledge cards; weak agent story.', color: 'teal' },
            { kind: 'card', title: 'Obsidian Canvas', text: 'Local files, plugin ecosystem; manual layout.', color: 'teal' },
          ],
        },
      },
    ],
  },
  {
    name: 'journey-map',
    title: 'Journey map',
    steps: [
      {
        tool: 'create_blocks',
        args: {
          frame: 'First-week journey',
          layout: 'cluster',
          blocks: [
            { text: 'Downloads the app from a friend’s link', group: 'Discover', color: 'blue' },
            { text: 'Unsure what it is for', group: 'Discover', color: 'red' },
            { text: 'Connects Claude Code in one line', group: 'Set up', color: 'green' },
            { text: 'Can’t find the MCP config', group: 'Set up', color: 'red' },
            { text: 'Agent drafts a research board', group: 'First value', color: 'green' },
            { text: 'Accepts most of the change set', group: 'First value', color: 'green' },
            { text: 'Shares a PNG with the team', group: 'Share', color: 'blue' },
            { text: 'Wants comments from teammates', group: 'Share', color: 'yellow' },
          ],
        },
      },
    ],
  },
  {
    name: 'architecture-tree',
    title: 'Architecture tree',
    steps: [
      {
        tool: 'create_blocks',
        args: {
          frame: 'System architecture',
          layout: 'tree',
          blocks: [
            { ref: 'core', kind: 'card', title: 'nodboard core', text: 'Yjs boards, layout engine, change sets', color: 'gray' },
            { ref: 'ui', parent: 'core', kind: 'card', title: 'Canvas app', text: 'Engine + review UI', color: 'blue' },
            { ref: 'mcp', parent: 'core', kind: 'card', title: 'MCP server', text: 'stdio and local HTTP', color: 'purple' },
            { ref: 'cli', parent: 'core', kind: 'card', title: 'CLI', text: 'Scripts and terminals', color: 'teal' },
            { parent: 'ui', kind: 'card', title: 'Desktop shell', text: 'Electron, files, keychain', color: 'blue' },
            { parent: 'mcp', kind: 'card', title: 'Claude Code / Cursor', text: 'External agents', color: 'purple' },
          ],
        },
      },
    ],
  },
  {
    name: 'brainstorm-bilingual',
    title: 'Bilingual brainstorm',
    steps: [
      {
        tool: 'create_blocks',
        args: {
          frame: 'Ideas 想法',
          blocks: [
            { text: 'Voice notes become stickies' },
            { text: '把会议纪要一键拆成便签', color: 'orange' },
            { text: 'Daily digest of board changes' },
            { text: '支持中文输入法不丢字', color: 'orange' },
            { text: 'Templates for retros' },
            { text: 'Presentation mode for frames' },
            { text: '按颜色筛选便签', color: 'orange' },
            { text: 'Link a card to a GitHub issue' },
          ],
        },
      },
    ],
  },
  {
    name: 'prioritization',
    title: 'Prioritization',
    steps: [
      {
        tool: 'create_blocks',
        args: { frame: 'Now', layout: 'stack', blocks: [{ kind: 'card', title: 'Electron shell', text: 'Files, menus, keychain', color: 'green' }, { kind: 'card', title: 'Review per item', text: 'J / K, accept or reject', color: 'green' }] },
      },
      {
        tool: 'create_blocks',
        args: { frame: 'Later', right_of: 'Now', layout: 'stack', blocks: [{ kind: 'card', title: 'Sync service', text: 'Optional, local-first stays', color: 'gray' }, { kind: 'card', title: 'Skill library', text: 'Signed, versioned', color: 'gray' }] },
      },
      { tool: 'connect', args: { route: 'elbow', connectors: [{ from: 'Review per item', to: 'Skill library', label: 'unblocks' }] } },
    ],
  },
]
