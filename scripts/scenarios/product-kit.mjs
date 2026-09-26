// product-kit: competitor matrix → opportunities → solutions on a priority matrix → experiments → a person picks →
// requirements → PRD outline, following skills/builtin/product-kit/SKILL.md.
import fs from 'node:fs'
import path from 'node:path'
import { blocksOf } from './lib.mjs'

export const skill = 'product-kit'
export const template = 'product-discovery'

const T = {
  en: {
    title: 'Agent review: discovery',
    frames: { competitors: 'Competitors', opportunities: 'Opportunities', solutions: 'Solutions', experiments: 'Experiments', prd: 'PRD' },
    competitors: [
      ['Cloud whiteboard', 'Real-time boards for product teams.', 'Design and product teams', 'mainstream'],
      ['Canvas SDK', 'Build your own infinite canvas.', 'Developers', 'budget'],
      ['Local sketch tool', 'Hand-drawn diagrams, saved as files.', 'Individuals', 'budget'],
      ['Notes + canvas app', 'Linked notes with a canvas view.', 'Knowledge workers', 'premium'],
    ],
    caps: ['Local files', 'Agent access', 'Item-level review', 'Templates'],
    matrix: [
      [['missing', 'Cloud only'], ['partial', 'Built-in AI, no external agents'], ['missing', 'Undo the whole board'], ['has', 'Large library']],
      [['partial', 'Browser storage'], ['partial', 'Build it yourself'], ['missing', 'Not built in'], ['missing', 'None']],
      [['has', 'Files on disk'], ['missing', 'No API'], ['missing', 'No review step'], ['partial', 'Shape libraries']],
      [['has', 'Markdown vault'], ['partial', 'Through plugins'], ['missing', 'AI edits apply directly'], ['has', 'Community templates']],
    ],
    opportunities: [
      ['“I can’t trust what the agent changed”', 'Agent teams, small and mid-size', 'No competitor reviews item by item', 'large'],
      ['“Agents start every session from zero”', 'Developers using coding agents', '3 of 3 interviews', 'large'],
      ['“Sensitive boards can’t live in the cloud”', 'Security-minded teams', 'Only local tools offer files', 'medium'],
    ],
    solutions: [
      [0, 'Change sets with per-item accept', 'Every agent edit is reviewable, alone.', 'high', 'low', 'high'],
      [0, 'Agent activity replay', 'Scrub through what the agent did.', 'medium', 'high', 'low'],
      [1, 'Board context the agent reads first', 'The board is the brief.', 'high', 'medium', 'medium'],
      [1, 'Decisions pinned as ADR cards', 'Decisions and reasons stay put.', 'medium', 'low', 'medium'],
      [2, 'Local-first board files', 'Boards are files on your machine.', 'high', 'medium', 'high'],
      [2, 'Self-hosted sync server', 'Team sync without a vendor cloud.', 'medium', 'high', 'low'],
    ],
    experiments: [
      [0, 'Review prototype with 5 teams', 'People accept more when they can pick items', 'Clickable prototype', 'passed'],
      [2, 'Concierge context test', 'Agents need fewer corrections with board context', 'Paste the board into the prompt by hand', 'running'],
    ],
    metrics: [
      [0, 'Accepted agent items per week', '40', '100', 'north star'],
      [0, 'Change sets rejected whole', '35%', '15%', 'guardrail'],
      [1, 'Corrections per task', '4.2', '2', 'input'],
    ],
    pick: 'Let’s commit to per-item change sets.',
    picked: 'Done: committed, the others stay in exploring; replay is dropped for now.',
    requirements: [
      ['Accept or reject each item', 'must', 'Review'],
      ['Keyboard review: J/K, A/R', 'must', 'Review'],
      ['Undo a whole change set later', 'must', 'Review'],
      ['Reject with a reason the agent can read', 'should', 'Agents'],
      ['Show before and after while reviewing', 'should', 'Review'],
      ['Auto-accept per agent', 'could', 'Trust'],
      ['Multi-person approval', "won't", 'Teams'],
    ],
    prd: { problem: 'Problem', goal: 'Goal and metrics', solution: 'Solution', alternatives: 'Alternatives considered', reqs: 'Requirements', validation: 'Validation', context: 'Competitive context', open: 'Open questions', openQ: 'Does per-item review slow down trusted agents?' },
  },
  'zh-CN': {
    title: 'Agent 审阅：产品探索',
    frames: { competitors: '竞品', opportunities: '机会', solutions: '方案', experiments: '实验', prd: 'PRD' },
    competitors: [
      ['云端白板', '面向产品团队的实时白板。', '设计与产品团队', 'mainstream'],
      ['画布 SDK', '自己搭一个无限画布。', '开发者', 'budget'],
      ['本地手绘工具', '手绘风格的图，存成文件。', '个人', 'budget'],
      ['笔记 + 画布应用', '双链笔记，附带画布视图。', '知识工作者', 'premium'],
    ],
    caps: ['本地文件', 'Agent 接入', '逐条审阅', '模板'],
    matrix: [
      [['missing', '只有云端'], ['partial', '自带 AI，不接外部 Agent'], ['missing', '只能整板撤销'], ['has', '模板库丰富']],
      [['partial', '浏览器存储'], ['partial', '需要自己开发'], ['missing', '没有内置'], ['missing', '没有']],
      [['has', '磁盘上的文件'], ['missing', '没有接口'], ['missing', '没有审阅环节'], ['partial', '图形库']],
      [['has', 'Markdown 库'], ['partial', '通过插件'], ['missing', 'AI 修改直接生效'], ['has', '社区模板']],
    ],
    opportunities: [
      ['“我没法信任 Agent 改了什么”', '中小型的 Agent 团队', '没有竞品支持逐条审阅', 'large'],
      ['“Agent 每次都从零开始”', '使用编码 Agent 的开发者', '3 场访谈全部提到', 'large'],
      ['“敏感的画板不能放在云上”', '重视安全的团队', '只有本地工具提供文件', 'medium'],
    ],
    solutions: [
      [0, '可逐条接受的变更集', 'Agent 的每处修改都能单独审阅。', 'high', 'low', 'high'],
      [0, 'Agent 操作回放', '拖动时间轴查看 Agent 做了什么。', 'medium', 'high', 'low'],
      [1, 'Agent 先读画板上下文', '画板就是需求简报。', 'high', 'medium', 'medium'],
      [1, '把决策钉成 ADR 卡片', '决策和理由一直留着。', 'medium', 'low', 'medium'],
      [2, '本地优先的画板文件', '画板就是你电脑上的文件。', 'high', 'medium', 'high'],
      [2, '自托管同步服务', '不依赖厂商云的团队同步。', 'medium', 'high', 'low'],
    ],
    experiments: [
      [0, '找 5 个团队试用审阅原型', '能挑着接受时，大家会接受得更多', '可点击原型', 'passed'],
      [2, '人工上下文测试', '有画板上下文时，Agent 需要的纠正更少', '手动把画板贴进提示词', 'running'],
    ],
    metrics: [
      [0, '每周被接受的 Agent 条目', '40', '100', 'north star'],
      [0, '被整组拒绝的变更集', '35%', '15%', 'guardrail'],
      [1, '每个任务的纠正次数', '4.2', '2', 'input'],
    ],
    pick: '就做逐条接受的变更集吧。',
    picked: '已设为“已承诺”，其余保持“探索中”；回放暂时放弃。',
    requirements: [
      ['每一条都能接受或拒绝', 'must', '审阅'],
      ['键盘审阅：J/K、A/R', 'must', '审阅'],
      ['之后可以整组撤销', 'must', '审阅'],
      ['拒绝时写 Agent 能读到的理由', 'should', 'Agent'],
      ['审阅时显示修改前后对比', 'should', '审阅'],
      ['按 Agent 自动接受', 'could', '信任'],
      ['多人审批', "won't", '团队'],
    ],
    prd: { problem: '问题', goal: '目标与指标', solution: '方案', alternatives: '考虑过的其他方案', reqs: '需求', validation: '验证', context: '竞争格局', open: '待解决的问题', openQ: '对已信任的 Agent，逐条审阅会不会拖慢速度？' },
  },
}

export async function run({ core, agent, lang, check, out }) {
  const t = T[lang]
  const { tool } = agent
  const F = t.frames

  // 1. start the board
  const created = await tool('create_board', { title: t.title, template, language: lang })
  const board = created.board.id
  check('create_board with the scenario template enables product-kit (with competitor-kit folded in)', created.skill === skill)
  const sk = await tool('get_skill', { name: skill })
  check('get_skill: competitor, opportunity, solution, experiment, metric, requirement types', ['competitor', 'feature', 'opportunity', 'solution', 'experiment', 'metric', 'requirement'].every((x) => sk.types.some((y) => y.id === `product-kit.${x}`)))
  const first = await blocksOf(tool, board)
  await tool('delete_blocks', { board, ids: first.board.frames.map((f) => f.id), intent: 'Clear the example' })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 2. competitor matrix (fetch-homepage needs a fetch MCP server; none is configured here, so it says so)
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '竞品矩阵' : 'Competitor matrix' })
  const comp = await tool('create_blocks', { board, frame: F.competitors, layout: 'row', blocks: t.competitors.map(([title, text, segment, positioning]) => ({ type: 'product-kit.competitor', title, text, fields: { segment, positioning } })) })
  const fetchTry = await tool('run_skill_action', { board, skill, action: 'fetch-homepage', ids: [comp.created.find((c) => c.kind === 'card').id] }).catch((e) => e.message)
  check('run_skill_action fetch-homepage explains a missing fetch server instead of failing silently', typeof fetchTry === 'string' && /fetch/.test(fetchTry), String(fetchTry).slice(0, 100))
  const featureBlocks = t.competitors.flatMap(([competitor], ci) => t.caps.map((capability, k) => ({ type: 'product-kit.feature', text: t.matrix[ci][k][1], fields: { competitor, capability, status: t.matrix[ci][k][0] } })))
  const feats = await tool('create_blocks', { board, inside: F.competitors, blocks: featureBlocks })
  await tool('apply_skill_layout', { board, layout: 'product-kit.competitor-matrix', frame: F.competitors })
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 3–4. opportunities, solutions under them (the connectors are the tree), priority matrix
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '机会-方案树与优先级' : 'Opportunity-solution tree and priorities' })
  await tool('create_blocks', { board, frame: F.opportunities, below: F.competitors, layout: 'stack', blocks: t.opportunities.map(([title, segment, evidence, size]) => ({ type: 'product-kit.opportunity', title, fields: { segment, evidence, size } })) })
  const reviewCol = feats.created.filter((c) => c.kind === 'sticky').filter((_, i) => i % t.caps.length === 2).map((c) => c.id)
  await tool('connect', { board, connectors: reviewCol.slice(0, 2).map((id) => ({ from: id, to: t.opportunities[0][0] })) })
  await tool('create_blocks', { board, frame: F.solutions, right_of: F.opportunities, blocks: t.solutions.map(([, title, text, impact, effort, confidence]) => ({ type: 'product-kit.solution', title, text, fields: { impact, effort, confidence, status: 'exploring' } })) })
  await tool('connect', { board, connectors: t.solutions.map(([o, title]) => ({ from: t.opportunities[o][0], to: title })) })
  await tool('apply_skill_layout', { board, layout: 'product-kit.priority-matrix', frame: F.solutions })
  // 5. experiments and metrics for the most promising solutions
  await tool('create_blocks', {
    board,
    frame: F.experiments,
    right_of: F.solutions,
    layout: 'stack',
    blocks: [...t.experiments.map(([, title, assumption, method, status]) => ({ type: 'product-kit.experiment', title, fields: { assumption, method, status } })), ...t.metrics.map(([, text, baseline, target, kind]) => ({ type: 'product-kit.metric', text, fields: { baseline, target, kind } }))],
  })
  await tool('connect', { board, connectors: [...t.experiments.map(([s, title]) => ({ from: t.solutions[s][1], to: title })), ...t.metrics.map(([e, text]) => ({ from: t.experiments[e][1], to: text }))] })
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // the person picks in a comment; the agent records it
  const now = await blocksOf(tool, board)
  const pickId = now.blocks.find((b) => b.title === t.solutions[0][1]).id
  await core.human('add_comment', { board, target: pickId, text: t.pick })
  const th = (await tool('get_threads', { board })).threads.find((x) => x.on?.id === pickId)
  const sol = await tool('query_blocks', { board, type: 'product-kit.solution' })
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '记录选择并写需求' : 'Record the pick, write requirements' })
  await tool('set_type', { board, ids: [pickId], fields: { status: 'committed' } })
  await tool('set_type', { board, ids: sol.blocks.filter((b) => b.text.startsWith(t.solutions[1][1])).map((b) => b.id), fields: { status: 'dropped' } })
  // 6. requirements
  await tool('create_blocks', { board, frame: F.prd, below: F.solutions, blocks: t.requirements.map(([title, priority, area]) => ({ type: 'product-kit.requirement', title, fields: { priority, area, status: priority === "won't" ? 'draft' : 'agreed' } })) })
  await tool('apply_skill_layout', { board, layout: 'product-kit.requirements', frame: F.prd })
  await tool('reply_thread', { board, thread: th.id, text: t.picked })
  await tool('resolve_thread', { board, thread: th.id })
  // 7. check, commit, PRD outline
  const lint = await tool('lint_layout', { board })
  check('lint_layout is clean before handing over', lint.issues.length === 0, lint.issues.map((i) => i.message).slice(0, 3).join(' | '))
  const snap = await agent.raw('render_snapshot', { board })
  check('render_snapshot returns an image', snap.content.some((c) => c.type === 'image'))
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  const md = (await tool('export_board', { board, format: 'markdown' })).text
  const { blocks, connectors } = await blocksOf(tool, board)
  const f = (b, type, k) => b.typeData?.[type]?.[k]
  const committed = blocks.find((b) => b.type === 'product-kit.solution' && f(b, 'product-kit.solution', 'status') === 'committed')
  const incoming = (id) => connectors.filter((c) => c.to === id).map((c) => blocks.find((b) => b.id === c.from))
  const outgoing = (id) => connectors.filter((c) => c.from === id).map((c) => blocks.find((b) => b.id === c.to))
  const opp = incoming(committed.id).find((b) => b?.type === 'product-kit.opportunity')
  const alternatives = blocks.filter((b) => b.type === 'product-kit.solution' && b.id !== committed.id && incoming(b.id).some((x) => x?.id === opp.id))
  const exps = outgoing(committed.id).filter((b) => b?.type === 'product-kit.experiment')
  const mets = exps.flatMap((e) => outgoing(e.id)).filter((b) => b?.type === 'product-kit.metric')
  const reqs = blocks.filter((b) => b.type === 'product-kit.requirement')
  const P = t.prd
  const prd = [
    `# PRD: ${committed.title}`,
    '',
    `## ${P.problem}`,
    '',
    `${opp.title} — ${f(opp, 'product-kit.opportunity', 'segment')}. ${f(opp, 'product-kit.opportunity', 'evidence')}.`,
    '',
    `## ${P.goal}`,
    '',
    ...mets.map((m) => `- ${m.text}: ${f(m, 'product-kit.metric', 'baseline')} → ${f(m, 'product-kit.metric', 'target')} (${f(m, 'product-kit.metric', 'kind')})`),
    '',
    `## ${P.solution}`,
    '',
    committed.text,
    '',
    `### ${P.alternatives}`,
    '',
    ...alternatives.map((a) => `- ${a.title} — impact ${f(a, 'product-kit.solution', 'impact')}, effort ${f(a, 'product-kit.solution', 'effort')}, confidence ${f(a, 'product-kit.solution', 'confidence')}`),
    '',
    `## ${P.reqs}`,
    ...['must', 'should', 'could', "won't"].flatMap((p) => ['', `**${p}**`, ...reqs.filter((r) => f(r, 'product-kit.requirement', 'priority') === p).map((r) => `- ${r.title} (${f(r, 'product-kit.requirement', 'area')})`)]),
    '',
    `## ${P.validation}`,
    '',
    ...exps.map((e) => `- ${e.title}: ${f(e, 'product-kit.experiment', 'assumption')} — ${f(e, 'product-kit.experiment', 'status')}`),
    '',
    `## ${P.context}`,
    '',
    ...t.competitors.map(([name], ci) => `- ${name}: ${t.caps[2]} — ${t.matrix[ci][2][1]}`),
    '',
    `## ${P.open}`,
    '',
    `- ${P.openQ}`,
    '',
  ].join('\n')
  if (out) fs.writeFileSync(path.join(out, `prd-${lang}.md`), prd)

  const fs2 = blocks.filter((b) => b.type === 'product-kit.feature')
  check('competitor matrix: one feature per competitor × capability', fs2.length === t.competitors.length * t.caps.length && new Set(fs2.map((b) => `${f(b, 'product-kit.feature', 'competitor')}|${f(b, 'product-kit.feature', 'capability')}`)).size === fs2.length)
  const cols = new Set(fs2.map((b) => b.x))
  const rows = new Set(fs2.map((b) => b.y))
  check('…laid out as a capability × competitor grid', cols.size === t.competitors.length && rows.size === t.caps.length, `${cols.size} columns × ${rows.size} rows`)
  check('every solution hangs under exactly one opportunity ("solved by")', blocks.filter((b) => b.type === 'product-kit.solution').every((s) => connectors.filter((c) => c.to === s.id && c.relation === 'solved by').length === 1))
  const sols = blocks.filter((b) => b.type === 'product-kit.solution')
  const hi = sols.filter((s) => f(s, 'product-kit.solution', 'impact') === 'high')
  const md2 = sols.filter((s) => f(s, 'product-kit.solution', 'impact') === 'medium')
  check('priority matrix: high impact on top, low effort on the left', Math.max(...hi.map((s) => s.y)) < Math.min(...md2.map((s) => s.y)) && hi.find((s) => f(s, 'product-kit.solution', 'effort') === 'low').x < hi.find((s) => f(s, 'product-kit.solution', 'effort') === 'medium').x)
  check('the person’s pick is committed and the thread resolved', f(committed, 'product-kit.solution', 'status') === 'committed' && committed.title === t.solutions[0][1] && !(await tool('get_threads', { board })).threads.length)
  check('the PRD outline traces problem → metrics → requirements (MoSCoW) → validation', prd.includes(opp.title) && mets.length === 2 && reqs.length === 7 && exps.length === 1 && alternatives.length === 1 && md.includes('Requirements'))
  return { board }
}
