import { site } from '@/config/site'

const { cli, mcpServer, cloneUrl, repoDir, corePort } = site
const bin = `/absolute/path/to/${repoDir}/bin/${cli}.mjs`

export const commands = {
  clone: `git clone ${cloneUrl}\ncd ${repoDir}`,
  install: 'npm install',
  dev: 'npm run dev',
  desktop: 'npm run desktop',
  package: 'npm run desktop:build -- --dir',
  quickstart: `git clone ${cloneUrl}\ncd ${repoDir}\nnpm install\nnpm run dev`,
  desktopAll: `npm run desktop          # build the canvas and run the Electron app\nnpm run desktop:dev      # same, with hot reload (run npm run dev first)\nnpm run desktop:build    # package it with electron-builder`,
  claude: `claude mcp add ${mcpServer} -- node ${bin} mcp`,
  cursor: JSON.stringify({ mcpServers: { [mcpServer]: { command: 'node', args: [bin, 'mcp'] } } }, null, 2),
  http: `claude mcp add --transport http ${mcpServer} http://127.0.0.1:${corePort}/mcp \\\n  --header "Authorization: Bearer $(npx ${cli} token)"`,
  skillCopy: `cp -r skills/ai-figma-canvas ~/.claude/skills/`,
  cli: [
    `${cli} read                                   # outline of the open board`,
    `${cli} add "Fast onboarding" "Offline first" --frame "Principles"`,
    `${cli} connect <fromId> <toId> --label "leads to" --route elbow`,
    `${cli} tidy --frame "Principles"`,
    `${cli} snapshot -o board.png`,
    `${cli} changes                                # change sets and their review status`,
    `${cli} accept | ${cli} reject [id] --reason "…"`,
  ].join('\n'),
  skillTree: `competitor-kit/\n  SKILL.md              # name, description, metadata.nodboard\n  canvas/blocks.json    # block types, relations, layouts, actions, prompts\n  canvas/prompts/*.md   # prompt templates`,
  skillMd: `---\nname: competitor-kit\ndescription: Map competitors on the board as cards with pricing\n  and positioning, then compare them as a positioning matrix.\nmetadata:\n  nodboard:\n    version: 1.0.0\n    canvas: canvas/blocks.json\n    capability: L1\n    permissions:\n      tools: [fetch.fetch]\n---\n\n# Competitor Kit\n\n- \`competitor-kit.competitor\` (card) — one per product.\n  Fields: segment, positioning, price, url.`,
  blocksJson: `{
  "version": 1,
  "types": {
    "competitor": {
      "label": "Competitor",
      "base": "card",
      "color": "blue",
      "icon": "Building2",
      "fields": [
        { "key": "segment", "label": "Segment", "kind": "text" },
        { "key": "positioning", "label": "Positioning", "kind": "enum",
          "options": ["budget", "mainstream", "premium"] },
        { "key": "price", "label": "Price", "kind": "number", "unit": "$/seat/mo" }
      ],
      "template": { "rows": ["segment", "positioning", "price"] }
    }
  },
  "layouts": [
    { "id": "positioning-matrix", "intent": "matrix",
      "types": ["competitor"], "rows": "segment", "cols": "positioning" }
  ]
}`,
  skillCli: [
    `${cli} skill new persona-kit            # scaffold SKILL.md + canvas/blocks.json`,
    `${cli} skill dev ./persona-kit --enable # validate on save, hot-reload into boards`,
    `${cli} skill validate ./persona-kit     # errors point at file › path`,
    `${cli} skill install ./persona-kit      # copy into ~/.nodboard/skills`,
  ].join('\n'),
} as const
