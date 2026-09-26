// research-kit: the agent synthesizes three interview transcripts (tests/fixtures/scenarios/interviews), following
// skills/builtin/research-kit/SKILL.md — sourced quotes, affinity clusters a person corrects, insights, report.
import fs from 'node:fs'
import path from 'node:path'
import { blocksOf, fixtures } from './lib.mjs'

export const skill = 'research-kit'
export const template = 'interview-synthesis'

const T = {
  en: {
    title: 'Agent workflow interviews',
    frames: { interviews: 'Interviews', quotes: 'Quotes', insights: 'Insights', next: 'Opportunities' },
    source: 'Interview',
    themes: {
      'Lost context': /same architecture notes|services are called|brief the AI|forgets|architecture again|Context doesn't carry/,
      'Review burden': /Big diffs|twenty small changes|every line|can't see what changed|accept parts|all or nothing|silently rewrites/,
      'Seeing the work': /step by step|as it does it|cursor move/,
      'Scattered work': /Figma|decisions and their reasons/,
    },
    corrected: [/silently rewrites/, 'Seeing the work'],
    insights: {
      'Lost context': ['Context doesn’t survive between sessions', 'People rebuild the same briefing by hand every day before an agent is useful.'],
      'Review burden': ['Review is the bottleneck, not generation', 'All-or-nothing changes make people skim — or reject everything.'],
      'Seeing the work': ['Watching the agent work builds trust', 'Live progress, where the work happens, beats a summary at the end.'],
    },
    opportunities: {
      'Lost context': ['HMW keep shared context on the board so agents start informed?', 'high', 'medium'],
      'Review burden': ['HMW let people accept agent work item by item?', 'high', 'low'],
      'Seeing the work': ['HMW show agent progress live on the canvas?', 'medium', 'low'],
    },
    hypothesis: ['Item-level review doubles accepted agent work', 'Compare accepted items per week before and after.'],
    comment: 'Is this true for designers too, or only engineers?',
    reply: 'Both: P2 (designer) says it twice — see the connected quotes. Confidence stays high.',
    report: { title: 'Research report', summary: 'Summary', findings: 'Findings', opportunities: 'Opportunities', next: 'What we’ll test next', method: 'Method', thin: 'Themes with too little evidence' },
  },
  'zh-CN': {
    title: 'Agent 工作流访谈',
    frames: { interviews: '访谈', quotes: '原话', insights: '洞察', next: '机会点' },
    source: '访谈',
    themes: {
      上下文丢失: /架构说明|服务都叫什么|交代背景|记不住|重新讲一遍|上下文/,
      审阅负担: /一大片|小改动|每一行|看不出改了什么|只接受一部分|全收或全拒|悄悄改了/,
      看得见的过程: /一步步|边做边|光标/,
      工作散落: /Figma|决定和理由/,
    },
    corrected: [/悄悄改了/, '看得见的过程'],
    insights: {
      上下文丢失: ['上下文在会话之间留不住', '每次让 Agent 派上用场之前，大家都要手动重建同一份背景。'],
      审阅负担: ['瓶颈在审阅，不在生成', '要么全收要么全拒，逼得人只能草草扫过，或者干脆全拒。'],
      看得见的过程: ['看着 Agent 干活才会信任它', '在工作发生的地方实时呈现进度，胜过最后一份总结。'],
    },
    opportunities: {
      上下文丢失: ['怎样把共享上下文留在画板上，让 Agent 一上来就了解情况？', 'high', 'medium'],
      审阅负担: ['怎样让人逐条接受 Agent 的工作？', 'high', 'low'],
      看得见的过程: ['怎样在画布上实时呈现 Agent 的进度？', 'medium', 'low'],
    },
    hypothesis: ['逐条审阅能让被接受的 Agent 工作翻倍', '对比上线前后每周被接受的条目数。'],
    comment: '设计师也这样吗，还是只有工程师？',
    reply: '都有：P2（设计师）提了两次，见连着的原话。把握维持“高”。',
    report: { title: '研究报告', summary: '摘要', findings: '发现', opportunities: '机会点', next: '接下来要验证的', method: '方法', thin: '证据不足的主题' },
  },
}

/** What an agent takes from a transcript: the header fields and every answer line with its line number. */
export function readTranscript(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const head = Object.fromEntries(lines.map((l) => l.match(/^(Participant|Role|Date|Segment|Method): (.+)$/)).filter(Boolean).map((m) => [m[1].toLowerCase(), m[2].trim()]))
  const answers = lines.map((l, i) => ({ line: i + 1, m: l.match(/^(P\d+): (.+)$/) })).filter((x) => x.m).map((x) => ({ line: x.line, participant: x.m[1], text: x.m[2].trim() }))
  return { head, answers, name: path.basename(file) }
}

export async function run({ core, agent, lang, check, out }) {
  const t = T[lang]
  const { tool } = agent
  const files = ['p1', 'p2', 'p3'].map((p) => path.join(fixtures, 'interviews', `${p}${lang === 'zh-CN' ? '.zh-CN' : ''}.md`))
  const transcripts = files.map(readTranscript)

  // 1. start the board
  const created = await tool('create_board', { title: t.title, template, language: lang })
  const board = created.board.id
  check('create_board with the scenario template enables research-kit', created.skill === skill)
  const sk = await tool('get_skill', { name: skill })
  check('get_skill: research-kit 1.1 with interviews and a report prompt', sk.types.some((x) => x.id === 'research-kit.interview') && sk.prompts.some((p) => p.id === 'report'))
  const first = await blocksOf(tool, board)
  await tool('delete_blocks', { board, ids: first.board.frames.map((f) => f.id), intent: 'Clear the example' })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 2. interviews
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '登记访谈' : 'Log interviews' })
  await tool('create_blocks', {
    board,
    frame: t.frames.interviews,
    layout: 'row',
    blocks: transcripts.map(({ head, answers }) => ({ type: 'research-kit.interview', title: `${head.participant} · ${head.role}`, text: answers[0].text, fields: { participant: head.participant, role: head.role, date: head.date, segment: head.segment, method: head.method } })),
  })
  await tool('commit_change_set', { board })

  // 3. pull quotes (verbatim, with file:line), first pass of themes
  await tool('set_status', { board, status: lang === 'zh-CN' ? '正在摘录原话…' : 'Pulling quotes…' })
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '摘录原话并初步聚类' : 'Pull quotes and cluster them' })
  const themeOf = (text) => Object.entries(t.themes).find(([, re]) => re.test(text))?.[0]
  const quotes = transcripts.flatMap(({ answers, name, head }) => answers.map((a) => ({ ...a, name, theme: themeOf(a.text), source: head.method === 'interview' ? t.source : head.method })).filter((a) => a.theme))
  const made = await tool('create_blocks', {
    board,
    frame: t.frames.quotes,
    below: t.frames.interviews,
    layout: 'grid',
    columns: 4,
    blocks: quotes.map((q) => ({ type: 'research-kit.quote', text: lang === 'zh-CN' ? `“${q.text}”` : `“${q.text}”`, fields: { participant: q.participant, source: q.source, ref: `${q.name}:${q.line}` } })),
  })
  await tool('apply_skill_layout', { board, layout: 'research-kit.by-participant', frame: t.frames.quotes })
  // 4. cluster: a theme per quote, then quotes by theme
  const quoteIds = made.created.filter((c) => c.kind === 'sticky').map((c) => c.id)
  const byTheme = new Map()
  quotes.forEach((q, i) => byTheme.set(q.theme, [...(byTheme.get(q.theme) ?? []), quoteIds[i]]))
  for (const [theme, ids] of byTheme) await tool('set_type', { board, ids, fields: { theme } })
  await tool('apply_skill_layout', { board, layout: 'research-kit.quote-affinity', frame: t.frames.quotes })
  await tool('commit_change_set', { board })
  // the person corrects one cluster by hand, then accepts
  const misfiled = quotes.findIndex((q) => t.corrected[0].test(q.text))
  await core.human('set_type', { board, ids: [quoteIds[misfiled]], fields: { theme: t.corrected[1] } })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  const reviewed = await tool('list_change_sets', { board })
  check('the agent waits for the cluster review before building on it', reviewed.changeSets.every((c) => c.status !== 'pending'))

  // 5. insights from the corrected clusters (3+ quotes from 2+ participants)
  const q2 = await tool('query_blocks', { board, type: 'research-kit.quote' })
  const groups = new Map()
  for (const b of q2.blocks) groups.set(b.fields.theme, [...(groups.get(b.fields.theme) ?? []), b])
  check('the agent reads the person’s correction back from the board', groups.get(t.corrected[1])?.some((b) => b.id === quoteIds[misfiled]))
  const strong = [...groups].filter(([, bs]) => bs.length >= 3 && new Set(bs.map((b) => b.fields.participant)).size >= 2)
  const thin = [...groups].filter(([theme]) => !strong.some(([s]) => s === theme)).map(([theme]) => theme)
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '提炼洞察与机会点' : 'Insights and opportunities' })
  await tool('create_blocks', {
    board,
    frame: t.frames.insights,
    right_of: t.frames.quotes,
    layout: 'stack',
    blocks: strong.map(([theme, bs]) => {
      const people = new Set(bs.map((b) => b.fields.participant)).size
      return { type: 'research-kit.insight', title: t.insights[theme][0], text: t.insights[theme][1], fields: { theme, evidence: bs.length, participants: people, confidence: people >= 3 ? 'high' : people === 2 ? 'medium' : 'low' } }
    }),
  })
  await tool('connect', { board, connectors: strong.flatMap(([theme, bs]) => bs.map((b) => ({ from: b.id, to: t.insights[theme][0] }))) })
  await tool('apply_skill_layout', { board, layout: 'research-kit.affinity', frame: t.frames.insights })
  // 6. opportunities and a hypothesis
  await tool('create_blocks', {
    board,
    frame: t.frames.next,
    right_of: t.frames.insights,
    layout: 'stack',
    blocks: [
      ...strong.map(([theme]) => ({ type: 'research-kit.opportunity', title: t.opportunities[theme][0], fields: { impact: t.opportunities[theme][1], effort: t.opportunities[theme][2] } })),
      { kind: 'card', type: 'hypothesis', title: t.hypothesis[0], text: t.hypothesis[1], fields: { status: 'unverified', confidence: 'medium' } },
    ],
  })
  await tool('connect', { board, connectors: [...strong.map(([theme]) => ({ from: t.insights[theme][0], to: t.opportunities[theme][0] })), { from: t.insights[strong.find(([th]) => t.opportunities[th][2] === 'low')[0]][0], to: t.hypothesis[0] }] })
  await tool('apply_skill_layout', { board, layout: 'research-kit.opportunity-matrix', frame: t.frames.next })

  // 7. check and hand over
  const lint = await tool('lint_layout', { board })
  check('lint_layout is clean before handing over', lint.issues.length === 0, lint.issues.map((i) => i.message).slice(0, 3).join(' | '))
  const snap = await agent.raw('render_snapshot', { board })
  check('render_snapshot returns an image', snap.content.some((c) => c.type === 'image'))
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })
  // the person asks a question on an insight; the agent answers from the evidence
  const cur = await blocksOf(tool, board)
  const reviewInsight = cur.blocks.find((b) => b.title === t.insights[strong[0][0]][0])
  await core.human('add_comment', { board, target: reviewInsight.id, text: t.comment })
  const th = (await tool('get_threads', { board })).threads[0]
  await tool('reply_thread', { board, thread: th.id, text: t.reply })
  await tool('resolve_thread', { board, thread: th.id })

  // 8. report, as the report prompt describes
  const md = (await tool('export_board', { board, format: 'markdown' })).text
  const { blocks, connectors } = await blocksOf(tool, board)
  const quoteBlocks = blocks.filter((b) => b.type === 'research-kit.quote')
  const insightBlocks = blocks.filter((b) => b.type === 'research-kit.insight')
  const supporting = (ins) => connectors.filter((c) => c.to === ins.id && c.relation === 'supports').map((c) => quoteBlocks.find((q) => q.id === c.from)).filter(Boolean)
  const R = t.report
  const report = [
    lang === 'zh-CN' ? `# ${R.title}：${t.title}` : `# ${R.title}: ${t.title}`,
    '',
    `## ${R.summary}`,
    '',
    lang === 'zh-CN'
      ? `访谈 ${transcripts.length} 人（${transcripts.map((x) => x.head.role).join('、')}）。主要发现：${insightBlocks.slice(0, 2).map((i) => i.title).join('；')}。`
      : `${transcripts.length} interviews (${transcripts.map((x) => x.head.role).join(', ')}). Main findings: ${insightBlocks.slice(0, 2).map((i) => i.title).join('; ')}.`,
    '',
    `## ${R.findings}`,
    ...insightBlocks.flatMap((i) => ['', `### ${i.title}`, '', i.text, '', ...supporting(i).slice(0, 3).map((q) => `> ${q.text} — ${q.typeData['research-kit.quote'].participant}, ${q.typeData['research-kit.quote'].ref}`)]),
    '',
    `## ${R.opportunities}`,
    '',
    ...blocks.filter((b) => b.type === 'research-kit.opportunity').map((o) => `- ${o.title} (${o.typeData['research-kit.opportunity'].impact} / ${o.typeData['research-kit.opportunity'].effort})`),
    '',
    `## ${R.next}`,
    '',
    ...blocks.filter((b) => b.type === 'hypothesis').map((h) => `- ${h.title} — ${h.text}`),
    '',
    `## ${R.method}`,
    '',
    ...transcripts.map((x) => `- ${x.head.participant}, ${x.head.role}, ${x.head.date}`),
    `- ${R.thin}: ${thin.join(', ') || '—'}`,
    '',
  ].join('\n')
  if (out) fs.writeFileSync(path.join(out, `research-report-${lang}.md`), report)

  // checks on the result
  const byFile = Object.fromEntries(transcripts.map((x) => [x.name, fs.readFileSync(path.join(fixtures, 'interviews', x.name), 'utf8').split('\n')]))
  const verbatim = quoteBlocks.every((q) => {
    const [file, line] = q.typeData['research-kit.quote'].ref.split(':')
    return byFile[file]?.[Number(line) - 1]?.includes(q.text.replace(/^“|”$/g, ''))
  })
  check('every quote is verbatim and its file:line ref points at it', verbatim && quoteBlocks.length >= 12, `${quoteBlocks.length} quotes`)
  check('every insight has 3+ connected quotes from 2+ participants', insightBlocks.length === 3 && insightBlocks.every((i) => supporting(i).length >= 3 && new Set(supporting(i).map((q) => q.typeData['research-kit.quote'].participant)).size >= 2), insightBlocks.map((i) => `${i.title}: ${supporting(i).length}`).join('; '))
  check('a theme with too little evidence stays as quotes', thin.length === 1 && !insightBlocks.some((i) => i.typeData['research-kit.insight'].theme === thin[0]), thin.join(', '))
  check('the opportunity matrix puts high impact on top', (() => {
    const opp = blocks.filter((b) => b.type === 'research-kit.opportunity')
    const high = opp.filter((o) => o.typeData['research-kit.opportunity'].impact === 'high')
    const med = opp.filter((o) => o.typeData['research-kit.opportunity'].impact === 'medium')
    return high.length && med.length && Math.max(...high.map((o) => o.y)) < Math.min(...med.map((o) => o.y))
  })())
  check('the report cites quotes verbatim with participant and ref', insightBlocks.every((i) => report.includes(`### ${i.title}`)) && (report.match(/^> .+ — P\d, p\d(\.zh-CN)?\.md:\d+$/gm) ?? []).length >= 9 && md.includes('Quotes'))
  return { board }
}
