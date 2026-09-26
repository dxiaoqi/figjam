// lit-kit: the agent reads five paper notes (tests/fixtures/scenarios/papers), extracts evidence and
// counter-evidence with citations, builds claims and an argument map, and drafts the review outline —
// skills/builtin/lit-kit/SKILL.md.
import fs from 'node:fs'
import path from 'node:path'
import { blocksOf, fixtures } from './lib.mjs'

export const skill = 'lit-kit'
export const template = 'literature-review'

const T = {
  en: {
    title: 'AI coding assistants: what the evidence says',
    frames: { questions: 'Research questions', papers: 'Papers', map: 'Argument map' },
    rqs: [
      ['RQ1', 'Do AI coding assistants make developers faster?'],
      ['RQ2', 'How do developers work with them?'],
      ['RQ3', 'Do developers judge their AI speed-up accurately?'],
    ],
    claims: [
      ['RQ1', 'Speed-ups hold on small, well-specified tasks — not yet on real work in mature code'],
      ['RQ2', 'Developers alternate between accelerating and exploring, and validating output is costly'],
      ['RQ3', 'Perceived productivity runs ahead of measured productivity'],
    ],
    gaps: [['RQ1', 'Few studies of multi-file, agentic tasks', 'high'], ['RQ3', 'No long-term measures of code quality', 'medium']],
    comment: 'Is the RQ1 claim fair to the Copilot study?',
    reply: 'Yes — it keeps the 55.8% result as evidence; the claim is contested because two studies of other settings disagree.',
    outline: { scope: 'Scope', disagree: 'Where the field disagrees', gaps: 'Gaps and future work', refs: 'References', papers: 'papers', years: 'years' },
  },
  'zh-CN': {
    title: 'AI 编程助手：证据怎么说',
    frames: { questions: '研究问题', papers: '文献', map: '论证地图' },
    rqs: [
      ['RQ1', 'AI 编程助手能让开发更快吗？'],
      ['RQ2', '开发者是怎样使用它们的？'],
      ['RQ3', '开发者能准确判断 AI 带来的提速吗？'],
    ],
    claims: [
      ['RQ1', '小而明确的任务上确有提速，成熟代码的真实工作中尚未证实'],
      ['RQ2', '开发者在“加速”和“探索”之间切换，而验证产出代价不小'],
      ['RQ3', '感受到的效率高于实测的效率'],
    ],
    gaps: [['RQ1', '很少有研究覆盖跨文件的 Agent 任务', 'high'], ['RQ3', '缺少对代码质量的长期测量', 'medium']],
    comment: 'RQ1 的论点对 Copilot 那篇研究公平吗？',
    reply: '公平 —— 55.8% 的结果作为证据保留；论点标为“有争议”，是因为另外两项不同场景的研究结论相反。',
    outline: { scope: '范围', disagree: '学界的分歧', gaps: '空白与未来工作', refs: '参考文献', papers: '篇文献', years: '年份' },
  },
}

/** A paper note: frontmatter + "- kind | RQ | loc | strength-or-kind | English | 中文" findings. */
export function readPaper(file) {
  const src = fs.readFileSync(file, 'utf8')
  const [, fm, body] = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  const meta = Object.fromEntries(fm.split('\n').map((l) => l.match(/^(\w+): (.+)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, '')]))
  const findings = body.split('\n').filter((l) => l.startsWith('- ')).map((l) => {
    const [kind, rq, loc, grade, en, zh] = l.slice(2).split(' | ')
    return { kind, rq, loc, grade, text: { en, 'zh-CN': zh } }
  })
  const [sEn, sZh] = meta.summary.split(' | ')
  return { ...meta, summary: { en: sEn, 'zh-CN': sZh }, findings }
}

export async function run({ core, agent, lang, check, out }) {
  const t = T[lang]
  const { tool } = agent
  const F = t.frames
  const dir = path.join(fixtures, 'papers')
  const papers = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => readPaper(path.join(dir, f)))

  // 1–2. board and questions
  const created = await tool('create_board', { title: t.title, template, language: lang })
  const board = created.board.id
  check('create_board with the scenario template enables lit-kit', created.skill === skill)
  const sk = await tool('get_skill', { name: skill })
  check('get_skill: papers, claims, evidence, counter-evidence, gaps', ['question', 'paper', 'claim', 'evidence', 'counter', 'gap'].every((x) => sk.types.some((y) => y.id === `lit-kit.${x}`)))
  const first = await blocksOf(tool, board)
  await tool('delete_blocks', { board, ids: first.board.frames.map((f) => f.id), intent: 'Clear the example' })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })
  await tool('create_blocks', { board, frame: F.questions, layout: 'row', blocks: t.rqs.map(([rq, title]) => ({ type: 'lit-kit.question', title, fields: { rq, status: 'open' } })) })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 3. papers, from each paper's own metadata
  await tool('set_status', { board, status: lang === 'zh-CN' ? '正在登记文献…' : 'Logging papers…' })
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '登记文献' : 'Log papers' })
  await tool('create_blocks', {
    board,
    frame: F.papers,
    below: F.questions,
    blocks: papers.map((p) => ({ type: 'lit-kit.paper', title: p.title, text: p.summary[lang], fields: { authors: p.authors, year: p.year, venue: p.venue, method: p.method, cite: p.cite, ...(p.url ? { url: p.url } : {}) } })),
  })
  await tool('apply_skill_layout', { board, layout: 'lit-kit.papers-timeline', frame: F.papers })
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 4–6. extract, group into claims, connect, gaps, argument map
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '论点、证据与反驳' : 'Claims, evidence and counter-evidence' })
  const findings = papers.flatMap((p) => p.findings.map((f) => ({ ...f, cite: p.cite })))
  const consensus = (rq) => {
    const ev = findings.filter((f) => f.rq === rq && f.kind === 'evidence')
    const co = findings.filter((f) => f.rq === rq && f.kind === 'counter')
    const n = new Set(ev.map((f) => f.cite)).size
    return { level: co.length ? 'contested' : n >= 3 ? 'strong' : n === 2 ? 'moderate' : 'weak', sources: new Set([...ev, ...co].map((f) => f.cite)).size }
  }
  await tool('create_blocks', {
    board,
    frame: F.map,
    right_of: F.papers,
    blocks: [
      ...t.claims.map(([rq, title]) => ({ type: 'lit-kit.claim', title, fields: { rq, consensus: consensus(rq).level, sources: consensus(rq).sources } })),
      ...findings.map((f) => (f.kind === 'counter' ? { type: 'lit-kit.counter', text: f.text[lang], fields: { cite: f.cite, loc: f.loc, kind: f.grade, rq: f.rq } } : { type: 'lit-kit.evidence', text: f.text[lang], fields: { cite: f.cite, loc: f.loc, strength: f.grade, rq: f.rq } })),
      ...t.gaps.map(([rq, text, priority]) => ({ type: 'lit-kit.gap', text, fields: { rq, priority } })),
    ],
  })
  const claimOf = Object.fromEntries(t.claims.map(([rq, title]) => [rq, title]))
  await tool('connect', { board, connectors: findings.map((f) => ({ from: f.text[lang], to: claimOf[f.rq] })) })
  await tool('connect', { board, connectors: [...t.claims.map(([rq, title]) => ({ from: title, to: t.rqs.find((r) => r[0] === rq)[1] })), ...t.gaps.map(([rq, text]) => ({ from: text, to: t.rqs.find((r) => r[0] === rq)[1] }))] })
  await tool('apply_skill_layout', { board, layout: 'lit-kit.argument-map', frame: F.map })
  const qs = await tool('query_blocks', { board, type: 'lit-kit.question' })
  for (const q of qs.blocks) await tool('set_type', { board, ids: [q.id], fields: { status: consensus(q.fields.rq).level === 'contested' ? 'contested' : 'partly answered' } })
  // 7. check, commit
  const lint = await tool('lint_layout', { board })
  check('lint_layout is clean before handing over', lint.issues.length === 0, lint.issues.map((i) => i.message).slice(0, 3).join(' | '))
  const snap = await agent.raw('render_snapshot', { board })
  check('render_snapshot returns an image', snap.content.some((c) => c.type === 'image'))
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })
  const cur = await blocksOf(tool, board)
  await core.human('add_comment', { board, target: cur.blocks.find((b) => b.title === t.claims[0][1]).id, text: t.comment })
  const th = (await tool('get_threads', { board })).threads[0]
  await tool('reply_thread', { board, thread: th.id, text: t.reply })
  await tool('resolve_thread', { board, thread: th.id })

  // outline, as the outline prompt describes
  const md = (await tool('export_board', { board, format: 'markdown' })).text
  const { blocks, connectors } = await blocksOf(tool, board)
  const d = (b) => Object.values(b.typeData ?? {})[0] ?? {}
  const paperCards = blocks.filter((b) => b.type === 'lit-kit.paper')
  const claims = blocks.filter((b) => b.type === 'lit-kit.claim')
  const into = (id, type) => connectors.filter((c) => c.to === id).map((c) => blocks.find((b) => b.id === c.from)).filter((b) => b?.type === type)
  const O = t.outline
  const years = paperCards.map((p) => Number(d(p).year))
  const outline = [
    `# ${t.title}`,
    '',
    `## ${O.scope}`,
    '',
    ...t.rqs.map(([rq, q]) => `- ${rq}: ${q}`),
    `- ${paperCards.length} ${O.papers}, ${O.years} ${Math.min(...years)}–${Math.max(...years)}`,
    ...t.rqs.flatMap(([rq, q]) => {
      const c = claims.find((x) => d(x).rq === rq)
      return ['', `## ${rq} · ${q}`, '', `**${c.title}** (${d(c).consensus})`, ...into(c.id, 'lit-kit.evidence').map((e) => `- ${e.text} (${d(e).cite}, ${d(e).loc})`), ...into(c.id, 'lit-kit.counter').map((e) => `- ✕ ${e.text} (${d(e).cite}, ${d(e).loc})`)]
    }),
    '',
    `## ${O.disagree}`,
    '',
    ...claims.filter((c) => d(c).consensus === 'contested').map((c) => `- ${c.title}`),
    '',
    `## ${O.gaps}`,
    '',
    ...blocks.filter((b) => b.type === 'lit-kit.gap').map((g) => `- ${g.text} (${d(g).rq}, ${d(g).priority})`),
    '',
    `## ${O.refs}`,
    '',
    ...paperCards.sort((a, b) => d(a).year - d(b).year).map((p) => `- ${d(p).authors} (${d(p).year}). ${p.title}. ${d(p).venue}.${d(p).url ? ` ${d(p).url}` : ''}`),
    '',
  ].join('\n')
  if (out) fs.writeFileSync(path.join(out, `review-outline-${lang}.md`), outline)

  const cites = new Set(paperCards.map((p) => d(p).cite))
  const ev = blocks.filter((b) => b.type === 'lit-kit.evidence' || b.type === 'lit-kit.counter')
  check('every piece of evidence cites a paper on the board, with a location', ev.length === findings.length && ev.every((e) => cites.has(d(e).cite) && d(e).loc), `${ev.length} findings from ${cites.size} papers`)
  check('every claim is backed by connected evidence; the contested one keeps its counter-evidence', claims.every((c) => into(c.id, 'lit-kit.evidence').length >= 1) && claims.filter((c) => d(c).consensus === 'contested').every((c) => into(c.id, 'lit-kit.counter').length >= 1), claims.map((c) => `${d(c).rq}:${d(c).consensus}`).join(' '))
  const axis = blocks.filter((b) => b.layoutRole === 'axis').map((b) => b.text.replace(/\*/g, ''))
  const rowY = (r) => blocks.find((b) => b.layoutRole === 'axis' && b.text.replace(/\*/g, '') === r)?.y ?? -1
  check('argument map: a row per research question in order, evidence → claims ← counter-evidence', ['RQ1', 'RQ2', 'RQ3'].every((r) => axis.includes(r)) && rowY('RQ1') < rowY('RQ2') && rowY('RQ2') < rowY('RQ3') && (() => {
    const c = claims.find((x) => d(x).rq === 'RQ1')
    return into(c.id, 'lit-kit.evidence').every((e) => e.x < c.x) && into(c.id, 'lit-kit.counter').every((e) => e.x > c.x)
  })())
  check('the outline cites every finding and lists every paper', ev.every((e) => outline.includes(`(${d(e).cite}, ${d(e).loc})`)) && paperCards.every((p) => outline.includes(p.title)) && md.includes('Claims'))
  return { board }
}
