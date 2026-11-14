// arch-kit: the agent maps this repository's own packages, following skills/builtin/arch-kit/SKILL.md.
import fs from 'node:fs'
import path from 'node:path'
import { blocksOf, root } from './lib.mjs'

export const skill = 'arch-kit'
export const template = 'architecture-map'

const T = {
  en: {
    title: 'nodboard architecture',
    comment: 'Which package starts the snippet host? Draw it.',
    hosts: 'starts',
    reply: 'The core starts it next to the API (packages/core/src/snippet-host.ts) — connected on the board.',
    modules: 'Modules',
    contracts: 'Contracts',
    state: 'State and decisions',
    riskFrame: 'Risks',
    external: 'External',
    jobs: {
      '@nodboard/shared': 'Tokens, the board model, text measurement and the Canvas API tool schemas.',
      '@nodboard/core': 'Owns every board as a Yjs document: persistence, Canvas API, layout, snapshots, skills.',
      '@nodboard/canvas-engine': 'Our whiteboard engine: camera, selection, move and resize, connectors, undo.',
      '@nodboard/cli': 'The nodboard CLI and the MCP stdio server, with core auto-start.',
      '@nodboard/canvas': 'The canvas app: block renderers, agent layer, review UI, dialogs.',
      '@nodboard/desktop': 'Electron shell: native menus, files, keychain, bundled core.',
    },
    core: 'Local core server', coreText: 'HTTP API, MCP over HTTP, live sync and snapshots on 127.0.0.1.',
    snippet: 'Snippet host', snippetText: 'Serves inline web snippets on a separate origin with a no-network CSP.',
    ifaces: {
      call: 'Runs any tool; every call is attributed to a caller.',
      mcp: 'Streamable HTTP MCP for agents; token required.',
      stdio: 'The same tools over stdio for Claude Code and Cursor.',
      sync: 'Yjs sync and agent presence for the canvas.',
      cli: 'Terminal access to the whole Canvas API.',
      file: 'Checksummed Yjs state with a schema version header.',
    },
    stores: { boards: 'Boards', boardsText: 'One file per board plus a readable JSON copy.', history: 'Versions and backups', historyText: 'Automatic versions, named checkpoints, rolling backups.', home: 'Token, grants, activity', homeText: 'Access token (0600), permission grants, activity log.' },
    decisions: [
      ['Own canvas engine instead of tldraw', 'No license key or watermark; semantic blocks stay ours.', 'accepted', '2026-06'],
      ['The core owns the truth', 'Every client, including the canvas, is a replica of the core’s Yjs document.', 'accepted', '2026-05'],
      ['Built-in assistant stays behind a flag', 'External agents drive the canvas; scenarios ship as skills.', 'accepted', '2026-09'],
    ],
    risks: [
      ['One core process serves every client', 'high', 'low', 'Crash-safe saves, auto-restart from the CLI'],
      ['api.ts has grown past 2,000 lines', 'medium', 'high', 'Split tools by area'],
      ['Same-user malware can read the token', 'high', 'low', 'Documented as out of scope'],
    ],
  },
  'zh-CN': {
    title: 'nodboard 架构',
    comment: '网页片段宿主是哪个包启动的？画出来。',
    hosts: '启动',
    reply: '由核心服务在 API 旁边启动（packages/core/src/snippet-host.ts），已在画板上连好。',
    modules: '模块',
    contracts: '接口契约',
    state: '状态与决策',
    riskFrame: '风险',
    external: '外部依赖',
    jobs: {
      '@nodboard/shared': '设计令牌、画板数据模型、文字测量，以及 Canvas API 的工具定义。',
      '@nodboard/core': '以 Yjs 文档持有所有画板：持久化、Canvas API、布局、快照和 Skill。',
      '@nodboard/canvas-engine': '自研白板引擎：视口、选择、移动缩放、连线和撤销。',
      '@nodboard/cli': 'nodboard 命令行和 MCP stdio 服务，会自动拉起核心服务。',
      '@nodboard/canvas': '画布应用：块渲染、Agent 图层、审阅界面和各类对话框。',
      '@nodboard/desktop': 'Electron 外壳：原生菜单、文件、钥匙串，内置核心服务。',
    },
    core: '本地核心服务', coreText: '在 127.0.0.1 上提供 HTTP API、HTTP MCP、实时同步和快照。',
    snippet: '网页片段宿主', snippetText: '在独立源上托管内嵌网页片段，CSP 禁止一切网络访问。',
    ifaces: {
      call: '执行任意工具，每次调用都记录调用方。',
      mcp: '给 Agent 用的 Streamable HTTP MCP，需要令牌。',
      stdio: '同一套工具走 stdio，供 Claude Code 和 Cursor 使用。',
      sync: '画布的 Yjs 同步和 Agent 在线状态。',
      cli: '在终端里使用完整的 Canvas API。',
      file: '带校验和的 Yjs 状态，文件头含格式版本。',
    },
    stores: { boards: '画板文件', boardsText: '每块画板一个文件，另附可读的 JSON 副本。', history: '版本与备份', historyText: '自动版本、命名检查点和滚动备份。', home: '令牌、授权与活动', homeText: '访问令牌（0600）、权限授权和活动日志。' },
    decisions: [
      ['自研画布引擎，不用 tldraw', '无需许可证密钥和水印，语义块完全自主。', 'accepted', '2026-06'],
      ['核心服务掌握唯一事实', '包括画布在内的所有客户端都是核心 Yjs 文档的副本。', 'accepted', '2026-05'],
      ['内置助手放在开关后面', '画布由外部 Agent 驱动，场景以 Skill 交付。', 'accepted', '2026-09'],
    ],
    risks: [
      ['单个核心进程服务所有客户端', 'high', 'low', '崩溃安全的保存，CLI 自动重启'],
      ['api.ts 已超过 2000 行', 'medium', 'high', '按领域拆分工具'],
      ['同用户下的恶意软件能读到令牌', 'high', 'low', '已在文档中列为不在范围内'],
    ],
  },
}

const LAYER = { '@nodboard/canvas': 'ui', '@nodboard/desktop': 'ui', '@nodboard/canvas-engine': 'ui', '@nodboard/cli': 'api', '@nodboard/core': 'domain', '@nodboard/shared': 'domain' }
const GROUP = { ui: 'UI', api: 'API', domain: { en: 'Domain', 'zh-CN': '领域' }, data: { en: 'Data', 'zh-CN': '数据' }, infra: { en: 'Infra', 'zh-CN': '基础设施' } }
const group = (layer, lang) => (typeof GROUP[layer] === 'string' ? GROUP[layer] : GROUP[layer][lang])

/** What an agent learns from reading the repo: workspaces, their manifests, languages and internal imports. */
export function readRepo() {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const dirs = rootPkg.workspaces.flatMap((w) => (w.endsWith('/*') ? fs.readdirSync(path.join(root, w.slice(0, -2))).map((d) => `${w.slice(0, -2)}/${d}`) : [w])).filter((d) => fs.existsSync(path.join(root, d, 'package.json')))
  const pkgs = dirs.map((dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'))
    const src = path.join(root, dir, 'src')
    const files = fs.existsSync(src) ? fs.readdirSync(src, { recursive: true }).map(String) : []
    const ts = files.filter((f) => /\.tsx?$/.test(f)).length
    const js = files.filter((f) => /\.(mjs|cjs|js)$/.test(f)).length
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    return { dir, name: pkg.name, language: ts >= js ? 'TypeScript' : 'JavaScript', internal: deps.filter((d) => d.startsWith('@nodboard/')), external: deps.filter((d) => !d.startsWith('@nodboard/') && !d.startsWith('@types/')), versions: { ...pkg.dependencies, ...pkg.devDependencies } }
  })
  const server = fs.readFileSync(path.join(root, 'packages/core/src/server.ts'), 'utf8')
  const desktopMain = fs.readFileSync(path.join(root, 'apps/desktop/src/main.mjs'), 'utf8')
  return { pkgs, routes: { call: server.includes("'/api/call'"), mcp: server.includes("'/mcp'"), sync: server.includes('/sync') || server.includes('WebSocketServer') }, desktopSpawnsCore: desktopMain.includes("'core'") || desktopMain.includes('ensureCore') }
}

export async function run({ core, agent, lang, check }) {
  const t = T[lang]
  const { tool } = agent
  const repo = readRepo()

  // 1. start the board from the scenario template, read the skill, clear the example content
  const created = await tool('create_board', { title: t.title, template, language: lang })
  const board = created.board.id
  check('create_board with the scenario template enables arch-kit', created.skill === skill && /get_skill/.test(created.next), created.next)
  const sk = await tool('get_skill', { name: skill })
  check('get_skill returns the SKILL.md workflow and 8 block types', sk.instructions.includes('Workflow: map a repository') && sk.types.length === 8)
  const first = await blocksOf(tool, board)
  await tool('delete_blocks', { board, ids: first.board.frames.map((f) => f.id), intent: 'Clear the example' })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 3. modules and services
  await tool('set_status', { board, status: lang === 'zh-CN' ? '正在梳理模块…' : 'Mapping modules…' })
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '梳理模块与服务' : 'Map modules and services' })
  const modules = repo.pkgs.map((p) => ({
    type: 'arch-kit.module',
    title: p.name.replace('@nodboard/', ''),
    text: t.jobs[p.name] ?? p.name,
    group: group(LAYER[p.name] ?? 'domain', lang),
    fields: { path: p.dir, layer: LAYER[p.name] ?? 'domain', language: p.language, status: p.name === '@nodboard/core' ? 'changing' : 'stable' },
  }))
  const services = [
    { type: 'arch-kit.service', title: t.core, text: t.coreText, group: 'API', fields: { runtime: 'Node 22', port: '47821', entry: 'bin/nodboard.mjs core', layer: 'api' } },
    { type: 'arch-kit.service', title: t.snippet, text: t.snippetText, group: group('infra', lang), fields: { runtime: 'Node 22', port: '47822', entry: 'packages/core/src/snippet-host.ts', layer: 'infra' } },
  ]
  await tool('create_blocks', { board, frame: t.modules, layout: 'grid', blocks: [...modules, ...services] })
  await tool('apply_skill_layout', { board, layout: 'arch-kit.layers', frame: t.modules })

  // 4. dependencies: every internal import, plus the few externals that shape the design
  const conns = []
  for (const p of repo.pkgs) for (const d of p.internal) conns.push({ from: p.name.replace('@nodboard/', ''), to: d.replace('@nodboard/', '') })
  conns.push({ from: t.core, to: 'core' })
  if (repo.desktopSpawnsCore) conns.push({ from: 'desktop', to: t.core })
  await tool('connect', { board, connectors: conns })
  const all = Object.assign({}, ...repo.pkgs.map((p) => p.versions))
  const externals = ['yjs', 'react', '@modelcontextprotocol/sdk', 'electron'].filter((e) => all[e])
  await tool('create_blocks', {
    board,
    frame: t.external,
    below: t.modules,
    layout: 'row',
    blocks: externals.map((e) => ({ type: 'arch-kit.external', title: e, fields: { kind: e === 'electron' ? 'platform' : 'library', version: String(all[e]).replace(/^[\^~]/, ''), license: 'MIT' } })),
  })
  const mainUser = { yjs: 'core', react: 'canvas', '@modelcontextprotocol/sdk': 'cli', electron: 'desktop' }
  await tool('connect', { board, connectors: externals.map((e) => ({ from: mainUser[e], to: e })) })
  await tool('commit_change_set', { board })

  // 5. contracts
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '标注接口契约' : 'Annotate interface contracts' })
  const ifaces = [
    repo.routes.call && { type: 'arch-kit.interface', title: 'POST /api/call', text: t.ifaces.call, fields: { kind: 'http', signature: '{tool, args, caller} → {ok, result}', auth: 'Bearer token' }, from: 'core' },
    repo.routes.mcp && { type: 'arch-kit.interface', title: 'POST /mcp', text: t.ifaces.mcp, fields: { kind: 'mcp', signature: 'Streamable HTTP · tools/list, tools/call', auth: 'Bearer token' }, from: 'core' },
    { type: 'arch-kit.interface', title: 'nodboard mcp', text: t.ifaces.stdio, fields: { kind: 'mcp', signature: 'stdio · same tools as HTTP', auth: 'Token file' }, from: 'cli' },
    repo.routes.sync && { type: 'arch-kit.interface', title: 'WS /sync', text: t.ifaces.sync, fields: { kind: 'websocket', signature: 'y-protocols sync + awareness', auth: 'Token subprotocol' }, from: 'core' },
    { type: 'arch-kit.interface', title: 'nodboard <command>', text: t.ifaces.cli, fields: { kind: 'cli', signature: 'nodboard add | connect | tidy | export …', auth: 'Token file' }, from: 'cli' },
    { type: 'arch-kit.interface', title: '.nodboard file', text: t.ifaces.file, fields: { kind: 'file', signature: 'header {schema, sha256} + Yjs update', stability: 'stable' }, from: 'core' },
  ].filter(Boolean)
  await tool('create_blocks', { board, frame: t.contracts, right_of: t.modules, layout: 'grid', columns: 2, blocks: ifaces.map(({ from: _f, ...b }) => b) })
  await tool('connect', { board, connectors: ifaces.map((i) => ({ from: i.from, to: i.title })) })
  await tool('apply_skill_layout', { board, layout: 'arch-kit.contracts', frame: t.contracts })
  await tool('commit_change_set', { board })

  // 6. state, decisions, risks
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '补充状态、决策与风险' : 'State, decisions and risks' })
  await tool('create_blocks', {
    board,
    frame: t.state,
    below: t.external,
    layout: 'grid',
    columns: 3,
    blocks: [
      { type: 'arch-kit.datastore', title: t.stores.boards, text: t.stores.boardsText, fields: { engine: 'Yjs + .nodboard', holds: 'boards', location: '~/.nodboard/boards' } },
      { type: 'arch-kit.datastore', title: t.stores.history, text: t.stores.historyText, fields: { engine: '.nodboard copies', holds: 'versions', location: '~/.nodboard/history' } },
      { type: 'arch-kit.datastore', title: t.stores.home, text: t.stores.homeText, fields: { engine: 'files (0600)', holds: 'token, grants', location: '~/.nodboard' } },
      ...t.decisions.map(([title, text, status, date]) => ({ type: 'arch-kit.decision', title, text, fields: { status, date } })),
    ],
  })
  await tool('connect', { board, connectors: [{ from: 'core', to: t.stores.boards }, { from: t.decisions[0][0], to: 'canvas-engine' }] })
  await tool('create_blocks', { board, frame: t.riskFrame, right_of: t.state, layout: 'row', blocks: t.risks.map(([text, severity, likelihood, mitigation]) => ({ type: 'arch-kit.risk', text, fields: { severity, likelihood, mitigation } })) })
  await tool('apply_skill_layout', { board, layout: 'arch-kit.risk-matrix', frame: t.riskFrame })
  await tool('commit_change_set', { board })

  // 7. check the work, hand over; the person reviews and accepts
  const lint = await tool('lint_layout', { board })
  check('lint_layout is clean before handing over', lint.issues.length === 0, lint.issues.map((i) => i.message).slice(0, 3).join(' | '))
  const snap = await agent.raw('render_snapshot', { board })
  check('render_snapshot returns an image to look at', snap.content.some((c) => c.type === 'image'))
  const pending = await tool('list_change_sets', { board })
  check('each step arrives as its own change set for review', (pending.changeSets ?? []).filter((c) => c.status === 'pending').length >= 3)
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 8. review loop: the person comments, the agent reads the thread, fixes the board, replies and resolves
  const before = await blocksOf(tool, board)
  const snippetCard = before.blocks.find((b) => b.title === t.snippet)
  await core.human('add_comment', { board, target: snippetCard.id, text: t.comment })
  const threads = await tool('get_threads', { board })
  const th = threads.threads.find((x) => x.on?.id === snippetCard.id)
  await tool('connect', { board, connectors: [{ from: 'core', to: t.snippet, label: t.hosts }] })
  await tool('reply_thread', { board, thread: th.id, text: t.reply })
  await tool('resolve_thread', { board, thread: th.id })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })
  const open = await tool('get_threads', { board })
  check('the agent picks up a comment, fixes the board, replies and resolves it', !!th && !open.threads.length)
  const doc = await tool('export_board', { board, format: 'markdown' })
  check('export_board gives a write-up organized by type', /## Modules/.test(doc.text) && doc.text.includes('POST /api/call'), doc.text.split('\n')[4])

  const { blocks, connectors } = await blocksOf(tool, board)
  const mods = blocks.filter((b) => b.type === 'arch-kit.module')
  check('one module card per workspace package, with its real path', repo.pkgs.every((p) => mods.some((m) => m.typeData['arch-kit.module'].path === p.dir)) && mods.length === repo.pkgs.length, mods.map((m) => m.title).join(', '))
  const idOf = (title) => blocks.find((b) => b.title === title)?.id
  const internalEdges = repo.pkgs.flatMap((p) => p.internal.map((d) => [idOf(p.name.replace('@nodboard/', '')), idOf(d.replace('@nodboard/', ''))]))
  check('every internal import is a "depends on" connector', internalEdges.every(([a, b]) => connectors.some((c) => c.from === a && c.to === b && c.relation === 'depends on')), `${internalEdges.length} imports`)
  const ifaceCards = blocks.filter((b) => b.type === 'arch-kit.interface')
  check('contracts cover HTTP, MCP (HTTP + stdio), WebSocket, CLI and the file format', ['http', 'mcp', 'websocket', 'cli', 'file'].every((k) => ifaceCards.some((b) => b.typeData['arch-kit.interface'].kind === k)) && ifaceCards.every((b) => connectors.some((c) => c.to === b.id && c.relation === 'exposes')))
  const layers = blocks.filter((b) => b.layoutRole === 'axis').map((b) => b.text.replace(/\*/g, ''))
  check('arch-kit.layers put modules in layer columns', (lang === 'zh-CN' ? ['界面', '接口层', '领域'] : ['UI', 'API', 'Domain']).every((l) => layers.includes(l)), layers.join(', '))
  const riskAxes = (lang === 'zh-CN' ? ['高', '中'] : ['high', 'medium']).every((l) => layers.includes(l))
  check('arch-kit.risk-matrix lays risks out by severity × likelihood', riskAxes && blocks.filter((b) => b.type === 'arch-kit.risk').length === 3)
  return { board }
}
