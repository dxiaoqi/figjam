// prototype-kit: a brief, three interactive HTML variants side by side (clicked through in headless Chrome to prove
// they work), comments turned into feedback, a round-2 update and a decision — skills/builtin/prototype-kit/SKILL.md.
import fs from 'node:fs'
import { blocksOf } from './lib.mjs'

export const skill = 'prototype-kit'
export const template = 'prototype-wall'

const CSS = `*{box-sizing:border-box;margin:0}body{font:14px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1c1c1f;background:#fafaf9;height:100vh;display:flex;flex-direction:column;padding:20px;gap:14px}
h1{font-size:17px;font-weight:650;letter-spacing:-.01em}.sub{color:#6b6b73;font-size:12.5px;margin-top:2px}
button{font:inherit;font-weight:600;border:0;border-radius:9px;padding:10px 14px;cursor:pointer}button:focus-visible{outline:2px solid #6e56cf;outline-offset:2px}
.primary{background:#1c1c1f;color:#fff}.ghost{background:#fff;border:1px solid #d9d9de;color:#1c1c1f}
.card{background:#fff;border:1px solid #ececef;border-radius:12px;padding:12px}.row{display:flex;gap:10px;align-items:center;justify-content:space-between}
.ok{color:#1a7f4b;font-weight:600}.muted{color:#6b6b73;font-size:12.5px}`

const T = {
  en: {
    title: 'Connect-an-agent screen',
    brief: ['Connect an agent', 'After install, people should connect Claude Code or Cursor without reading docs.', 'First-time users', 'Connected in under a minute', 'No new backend'],
    frames: { brief: 'Brief', feedback: 'Feedback', decision: 'Decision' },
    variants: [
      { label: 'A', name: 'Guided steps', approach: 'Three steps with progress', why: 'Hand-holding for people who have never edited an MCP config.' },
      { label: 'B', name: 'One-click detect', approach: 'Detect agents, connect with one click', why: 'Fastest when the agent is already installed.' },
      { label: 'C', name: 'Copy the config', approach: 'Tabs with ready-to-paste config', why: 'Transparent for people who want to see what changes.' },
    ],
    a: { h: 'Connect your agent', steps: ['Pick your agent', 'We add ai-figma to its settings', 'Test the connection'], next: 'Next', done: 'Connected ✓', of: 'Step {n} of 3' },
    b: { h: 'Agents on this Mac', sub: 'We found these. Connect one to start.', agents: ['Claude Code', 'Cursor'], connect: 'Connect', connected: 'Connected', found: 'found' },
    c: { h: 'Add ai-figma to your agent', sub: 'Paste this into its MCP settings.', copy: 'Copy', copied: 'Copied' },
    comments: [
      [0, 'Three steps feel slow when my agent is already installed.', 'change'],
      [1, 'This is the one — but say what changes in my config first.', 'keep'],
      [2, 'Useful as a fallback, not as the main screen.', 'drop'],
    ],
    reply: 'Turned into a feedback note on the wall; round 2 adds a “what changes” line to B.',
    round2: 'Adds ~/.claude.json · backup first',
    decision: ['One-click detect, with the config preview', 'Round 2 of B answers the only change request; C stays as the manual fallback.'],
    author: 'Design review',
  },
  'zh-CN': {
    title: '连接 Agent 页面',
    brief: ['连接 Agent', '装好之后，用户不看文档也能接好 Claude Code 或 Cursor。', '首次使用的用户', '一分钟内接好', '不新增后端'],
    frames: { brief: '需求简报', feedback: '评审意见', decision: '决定' },
    variants: [
      { label: 'A', name: '分步引导', approach: '三步走，带进度', why: '照顾从没改过 MCP 配置的人。' },
      { label: 'B', name: '一键检测', approach: '检测已装的 Agent，一键连接', why: 'Agent 已经装好时最快。' },
      { label: 'C', name: '复制配置', approach: '分标签给出可直接粘贴的配置', why: '想看清改了什么的人更放心。' },
    ],
    a: { h: '连接你的 Agent', steps: ['选择你的 Agent', '把 ai-figma 写进它的配置', '测试连接'], next: '下一步', done: '已连接 ✓', of: '第 {n} 步，共 3 步' },
    b: { h: '这台 Mac 上的 Agent', sub: '找到了这些，连接一个就能开始。', agents: ['Claude Code', 'Cursor'], connect: '连接', connected: '已连接', found: '已发现' },
    c: { h: '把 ai-figma 加到你的 Agent', sub: '把这段粘贴进它的 MCP 配置。', copy: '复制', copied: '已复制' },
    comments: [
      [0, 'Agent 已经装好时，三步显得太慢。', 'change'],
      [1, '就是它了 —— 但先告诉我会改配置里的什么。', 'keep'],
      [2, '适合当备选，不适合当主界面。', 'drop'],
    ],
    reply: '已整理成原型墙上的评审意见；第 2 轮给 B 加上“会改什么”的说明。',
    round2: '会写入 ~/.claude.json · 先自动备份',
    decision: ['一键检测，加上配置预览', 'B 的第 2 轮回应了唯一的修改意见；C 保留为手动备选。'],
    author: '设计评审',
  },
}

const js = (s) => JSON.stringify(s)
function snippets(t) {
  const A = {
    html: `<div><h1>${t.a.h}</h1><p class="sub" id="of"></p></div><div class="bar"><i id="bar"></i></div><ol id="steps">${t.a.steps.map((s) => `<li class="card">${s}</li>`).join('')}</ol><div class="row" style="margin-top:auto"><span class="ok" id="done" hidden>${t.a.done}</span><button class="primary" id="next" style="margin-left:auto">${t.a.next}</button></div>`,
    css: `${CSS}.bar{height:4px;background:#ececef;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;width:33%;background:#6e56cf;transition:width .25s}ol{list-style:none;padding:0;display:flex;flex-direction:column;gap:8px}li{opacity:.45}li.on{opacity:1;border-color:#6e56cf}`,
    js: `let n=1;const items=[...document.querySelectorAll('#steps li')]
function render(){items.forEach((li,i)=>li.classList.toggle('on',i<n));document.getElementById('of').textContent=${js(t.a.of)}.replace('{n}',n);document.getElementById('bar').style.width=(n/3*100)+'%'}
document.getElementById('next').addEventListener('click',(e)=>{if(n<3){n++;render()}else{document.getElementById('done').hidden=false;e.currentTarget.disabled=true}})
render()`,
  }
  const B = {
    html: `<div><h1>${t.b.h}</h1><p class="sub">${t.b.sub}</p></div>${t.b.agents.map((a, i) => `<div class="card row"><div><b>${a}</b><p class="muted">${t.b.found}</p></div><button class="ghost" data-i="${i}">${t.b.connect}</button></div>`).join('')}`,
    css: CSS,
    js: `document.querySelectorAll('button[data-i]').forEach((b)=>b.addEventListener('click',()=>{b.textContent=${js(t.b.connected)};b.className='ok';b.disabled=true}))`,
  }
  const cfg = { 'Claude Code': 'claude mcp add ai-figma -- npx aifig mcp', Cursor: '{ "mcpServers": { "ai-figma": { "command": "npx", "args": ["aifig", "mcp"] } } }' }
  const C = {
    html: `<div><h1>${t.c.h}</h1><p class="sub">${t.c.sub}</p></div><div class="tabs" role="tablist">${Object.keys(cfg).map((k, i) => `<button role="tab" class="${i ? 'ghost' : 'primary'}" data-k="${k}">${k}</button>`).join('')}</div><pre id="cfg"></pre><button class="ghost" id="copy">${t.c.copy}</button>`,
    css: `${CSS}.tabs{display:flex;gap:6px}pre{font:12px/1.5 ui-monospace,Menlo,monospace;background:#1c1c1f;color:#f4f4f5;border-radius:10px;padding:12px;white-space:pre-wrap;word-break:break-all}`,
    js: `const cfg=${js(cfg)};const pre=document.getElementById('cfg');let cur='Claude Code'
function render(){pre.textContent=cfg[cur];document.querySelectorAll('[data-k]').forEach((b)=>b.className=b.dataset.k===cur?'primary':'ghost')}
document.querySelectorAll('[data-k]').forEach((b)=>b.addEventListener('click',()=>{cur=b.dataset.k;render()}))
document.getElementById('copy').addEventListener('click',(e)=>{e.currentTarget.textContent=${js(t.c.copied)}})
render()`,
  }
  return [A, B, C]
}

/** Click through a snippet in headless Chrome (with the aifig state bridge stubbed); null when Chrome isn't there. */
async function interact(web, steps) {
  const chrome = process.env.CHROME ?? '/usr/local/bin/google-chrome'
  if (!fs.existsSync(chrome)) return null
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 480 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${web.css ?? ''}</style></head><body>${web.html ?? ''}<script>window.aifig={getState:async()=>({}),setState:async()=>{}};${web.js ?? ''}</script></body></html>`)
    const before = await page.evaluate(() => document.body.innerText)
    for (const s of steps) await page.click(s)
    const after = await page.evaluate(() => document.body.innerText)
    return { changed: before !== after, errors, after }
  } finally {
    await browser.close()
  }
}

export async function run({ core, agent, lang, check }) {
  const t = T[lang]
  const { tool } = agent
  const F = t.frames
  const code = snippets(t)
  const frameOf = (v) => `${v.label} · ${v.name}`

  // 1. start the board
  const created = await tool('create_board', { title: t.title, template, language: lang })
  const board = created.board.id
  check('create_board with the scenario template enables prototype-kit', created.skill === skill)
  const sk = await tool('get_skill', { name: skill })
  check('get_skill explains the no-network snippet sandbox', /no network/i.test(sk.instructions) && sk.types.length === 4)
  const first = await blocksOf(tool, board)
  await tool('delete_blocks', { board, ids: first.board.frames.map((f) => f.id), intent: 'Clear the example' })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 2–3. brief and three variants, same size, side by side
  await tool('set_status', { board, status: lang === 'zh-CN' ? '正在做三个方案…' : 'Building three variants…' })
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '原型墙，第 1 轮' : 'Prototype wall, round 1' })
  const [bt, btext, audience, success, constraints] = t.brief
  await tool('create_blocks', { board, frame: F.brief, layout: 'stack', blocks: [{ type: 'prototype-kit.brief', title: bt, text: btext, fields: { audience, success, constraints } }] })
  const snippetIds = []
  for (const [i, v] of t.variants.entries()) {
    await tool('create_blocks', { board, frame: frameOf(v), right_of: i ? frameOf(t.variants[i - 1]) : F.brief, layout: 'stack', blocks: [{ type: 'prototype-kit.variant', title: v.name, text: v.why, fields: { label: v.label, approach: v.approach, round: 1 } }] })
    const s = await tool('create_snippet', { board, inside: frameOf(v), title: frameOf(v), width: 360, height: 480, ...code[i] })
    snippetIds.push(s.created?.[0]?.id ?? s.id)
  }
  await tool('connect', { board, connectors: t.variants.map((v) => ({ from: bt, to: v.name })) })
  const lint = await tool('lint_layout', { board })
  check('lint_layout is clean before handing over', lint.issues.length === 0, lint.issues.map((i) => i.message).slice(0, 3).join(' | '))
  const snap = await agent.raw('render_snapshot', { board })
  check('render_snapshot returns an image', snap.content.some((c) => c.type === 'image'))
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  const wall = await blocksOf(tool, board)
  const webs = wall.blocks.filter((b) => b.kind === 'web')
  const page = (w) => {
    const f = wall.blocks.find((b) => b.id === w.parent)
    return { x: (f?.x ?? 0) + w.x, y: (f?.y ?? 0) + w.y }
  }
  const pos = webs.map(page)
  check('three inline snippets, the same size, side by side', webs.length === 3 && new Set(webs.map((w) => `${w.w}×${w.h}`)).size === 1 && new Set(pos.map((p) => p.y)).size === 1 && pos[0].x < pos[1].x && pos[1].x < pos[2].x, webs.map((w, i) => `${pos[i].x},${pos[i].y} ${w.w}×${w.h}`).join('; '))
  const byTitle = (title) => webs.find((w) => w.web?.title === title)
  const clicks = [['#next', '#next', '#next'], ['button[data-i="0"]'], ['[data-k="Cursor"]', '#copy']]
  const runs = []
  for (const [i, v] of t.variants.entries()) runs.push(await interact(byTitle(frameOf(v)).web, clicks[i]))
  if (runs.every((r) => r === null)) check('each variant is interactive (skipped: no Chrome)', true)
  else check('each variant is interactive: clicking changes what it shows, with no script errors', runs.every((r) => r && r.changed && !r.errors.length), runs.map((r) => (r ? `${r.changed ? 'changed' : 'static'}${r.errors.length ? ` ${r.errors[0]}` : ''}` : 'skipped')).join(' · '))

  // 4. people comment on the snippets; the agent turns comments into feedback and resolves them
  for (const [i, text] of t.comments) await core.human('add_comment', { board, target: byTitle(frameOf(t.variants[i])).id, text })
  const threads = (await tool('get_threads', { board })).threads
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '整理评审意见，第 2 轮' : 'Feedback and round 2' })
  await tool('create_blocks', {
    board,
    frame: F.feedback,
    below: frameOf(t.variants[1]),
    blocks: t.comments.map(([i, text, verdict]) => ({ type: 'prototype-kit.feedback', text, fields: { variant: t.variants[i].label, verdict, author: t.author } })),
  })
  await tool('apply_skill_layout', { board, layout: 'prototype-kit.feedback-matrix', frame: F.feedback })
  for (const th of threads) {
    await tool('reply_thread', { board, thread: th.id, text: t.reply })
    await tool('resolve_thread', { board, thread: th.id })
  }
  // 5. iterate on B, drop C
  const bId = byTitle(frameOf(t.variants[1])).id
  const upd = await tool('update_snippet', { board, id: bId, html: code[1].html.replace(`<p class="sub">${t.b.sub}</p>`, `<p class="sub">${t.b.sub}</p><p class="muted" id="what">${t.round2}</p>`) })
  const variants = await tool('query_blocks', { board, type: 'prototype-kit.variant' })
  const vid = (label) => variants.blocks.find((b) => b.fields.label === label).id
  await tool('set_type', { board, ids: [vid('B')], fields: { round: 2, status: 'shortlisted' } })
  await tool('set_type', { board, ids: [vid('C')], fields: { status: 'dropped' } })
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })

  // 6. decide
  await tool('begin_change_set', { board, intent: lang === 'zh-CN' ? '记录决定' : 'Record the decision' })
  await tool('create_blocks', { board, frame: F.decision, right_of: F.feedback, layout: 'stack', blocks: [{ type: 'prototype-kit.decision', title: t.decision[0], text: t.decision[1], fields: { chosen: 'B', status: 'decided', date: '2026-09-26' } }] })
  await tool('set_type', { board, ids: [vid('B')], fields: { status: 'chosen' } })
  await tool('connect', { board, connectors: [{ from: t.variants[1].name, to: t.decision[0] }, { from: t.comments[1][1], to: t.decision[0] }] })
  await tool('commit_change_set', { board })
  await core.human('review_change_set', { board, id: 'all', action: 'accept' })
  const md = (await tool('export_board', { board, format: 'markdown' })).text

  const { blocks, connectors } = await blocksOf(tool, board)
  const after = blocks.find((b) => b.id === bId)
  check('update_snippet reports a source diff and the round-2 change is on the board', !!upd.changed?.html && after.web.html.includes(t.round2))
  const again = await interact(after.web, ['button[data-i="1"]'])
  check('round 2 of B still works', again === null || (again.changed && !again.errors.length))
  check('comments became feedback (verdict × variant) and every thread is resolved', blocks.filter((b) => b.type === 'prototype-kit.feedback').length === 3 && !(await tool('get_threads', { board })).threads.length)
  const dec = blocks.find((b) => b.type === 'prototype-kit.decision')
  check('the decision is connected from the chosen variant and the feedback behind it', connectors.filter((c) => c.to === dec.id).length === 2 && blocks.find((b) => b.id === vid('B')).typeData['prototype-kit.variant'].status === 'chosen')
  check('export_board summarizes the wall', md.includes(t.decision[0]))
  return { board }
}
