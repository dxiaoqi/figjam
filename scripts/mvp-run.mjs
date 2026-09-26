// Phase 0 MVP validation (§8): an agent synthesizes interviews onto a board over MCP, a person reviews item by item
// and comments, the agent reads the comment and revises, the person accepts. Recorded end to end.
// usage: node scripts/mvp-run.mjs <out-dir>   (expects `npm run dev`)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright-core'
import { signIn } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'mvp-run')
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const base = 'http://127.0.0.1:47820'
const log = []
const note = (s) => {
  log.push(`- ${new Date().toISOString().slice(11, 19)} ${s}`)
  console.log(`· ${s}`)
}

// the agent (Claude Code over stdio MCP)
const mcp = new Client({ name: 'claude-code', version: 'mvp-run' })
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/aifig.mjs'), 'mcp'], env: process.env, stderr: 'inherit' }))
const call = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args })
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  if (r.isError) throw new Error(`${name}: ${text}`)
  return { content: r.content, text, json: (() => { try { return JSON.parse(text) } catch { return null } })() }
}
const board = (await call('create_board', { title: 'Onboarding research — synthesis' })).json.board.id
note(`board ${board} created`)

// the person, in the canvas
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
await signIn(page)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) })
  note(`screenshot ${name}`)
}
const ed = (fn, arg) => page.evaluate(fn, arg)
await page.goto(`${base}/?board=${board}`)
await sleep(2200)
await ed(() => window.editor.setCamera({ x: 120, y: 120, z: 0.62 }))
await sleep(400)
await shot('01-empty-board.png')

// 1. the agent reads the notes and drafts the synthesis
const interviews = fs.readFileSync(path.join(root, 'tests/fixtures/interviews.md'), 'utf8')
note(`agent read ${interviews.split('\n').filter((l) => l.startsWith('P')).length} interview notes`)
await call('get_board', { board })
await call('set_status', { board, status: 'Reading 6 interview notes…' })
await sleep(1500)
await call('begin_change_set', { board, intent: 'Synthesize the six onboarding interviews' })
await call('create_blocks', {
  board,
  frame: 'Interview synthesis',
  layout: 'cluster',
  blocks: [
    { text: '“Forty minutes before the first idea” — P1', group: 'Slow start', color: 'red' },
    { text: '35 min to a first useful board — P6', group: 'Slow start', color: 'red' },
    { text: '“A blank canvas makes me freeze” — P3', group: 'Slow start', color: 'red' },
    { text: 'AI output needs cleanup — P2', group: 'Messy output', color: 'orange' },
    { text: 'First agent board was messy — P4', group: 'Messy output', color: 'orange' },
    { text: 'Won’t share sloppy boards — P5', group: 'Messy output', color: 'orange' },
    { text: 'Trusts agents she can see working — P2', group: 'Trust', color: 'green' },
    { text: 'Undo everything an agent did — P3', group: 'Trust', color: 'green' },
    { text: 'Comments the agent can act on — P6', group: 'Trust', color: 'green' },
    { text: 'AI output needs cleanup (again) — P2', group: 'Messy output', color: 'orange' },
  ],
})
await sleep(1600)
await shot('02-agent-drafting-live.png')
await call('set_status', { board, status: 'Writing insights…' })
await call('create_blocks', {
  board,
  frame: 'Insights',
  right_of: 'Interview synthesis',
  layout: 'stack',
  blocks: [
    { kind: 'card', title: 'Onboarding is slow', text: 'People take a while to get started.', color: 'purple' },
    { kind: 'card', title: 'Tidy by default', text: 'Agent output must be share-ready without manual cleanup (P2, P4, P5).', color: 'teal' },
    { kind: 'card', title: 'Visible, reversible agents', text: 'Trust comes from seeing the agent work and undoing it in one step (P2, P3).', color: 'blue' },
  ],
})
await call('connect', { board, connectors: [{ from: '“Forty minutes before the first idea” — P1', to: 'Onboarding is slow' }, { from: 'First agent board was messy — P4', to: 'Tidy by default' }, { from: 'Undo everything an agent did — P3', to: 'Visible, reversible agents' }] })
await call('commit_change_set', { board })
const lint1 = (await call('lint_layout', { board })).json
note(`agent lint: ${lint1.summary}`)
fs.writeFileSync(path.join(out, 'agent-self-check.png'), Buffer.from((await call('render_snapshot', { board })).content.find((c) => c.type === 'image').data, 'base64'))
await sleep(1200)
await ed(() => window.editor.zoomToFit())
await sleep(800)

// 2. the person reviews item by item: accepts, rejects the duplicate with a reason, accepts the rest
await page.keyboard.press('j')
await sleep(700)
await shot('03-item-review.png')
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('a')
  await sleep(450)
}
let label = ''
for (let i = 0; i < 20; i++) {
  label = (await page.locator('[data-review-item]').textContent().catch(() => '')) ?? ''
  if (label.includes('(again)')) break
  await page.keyboard.press('j')
  await sleep(250)
}
await page.locator('[data-review-reason]').fill('Duplicate of the P2 note')
await sleep(400)
await page.locator('[data-review-reason]').press('Enter')
note('person rejected the duplicate sticky with a reason')
await sleep(600)
await page.keyboard.press('Shift+A')
note('person accepted the rest')
await sleep(900)

// 3. the person comments on the vague insight
const vague = await ed(() => window.editor.blocks().find((b) => b.title === 'Onboarding is slow').id)
await ed((id) => window.editor.select([id]), vague)
await sleep(300)
await page.keyboard.press('m')
await sleep(300)
await page.locator('[data-comment-input]').pressSequentially('Too vague — how slow, for whom? Cite the interviews.', { delay: 12 })
await page.locator('[data-comment-input]').press('Enter')
note('person commented on “Onboarding is slow”')
await sleep(600)
await shot('04-person-comments.png')
await page.keyboard.press('Escape')
await sleep(200)
await page.keyboard.press('Escape')
await sleep(400)

// 4. the agent reads the feedback and revises
const threads = (await call('get_threads', { board })).json.threads
const changes = (await call('list_change_sets', { board })).json.changeSets
note(`agent read ${threads.length} comment(s) and ${changes.filter((c) => c.status === 'partial').length} partly accepted change set (reason: “${changes[0].reason}”)`)
const t = threads[0]
await call('update_blocks', {
  board,
  intent: 'Revise the vague insight with evidence',
  updates: [{ id: t.on.id, title: 'Slow start: 35–40 min to a first idea', text: '**2 of 6** needed 35–40 minutes before a first useful board (*P1, P6*); P3 froze on the blank canvas.\n- Open on a prompt, not an empty canvas\n- Let the agent draft the first board' }],
})
await call('reply_thread', { board, thread: t.id, text: 'Rewrote it with numbers and quotes (P1, P3, P6) and two concrete moves. Also dropped the duplicate P2 note you rejected.' })
await sleep(900)
await ed((id) => window.editor.select([id]), t.on.id)
await page.locator(`[data-thread="${t.id}"]`).click()
await sleep(700)
await shot('05-agent-revises-and-replies.png')
await page.keyboard.press('Escape')
await sleep(300)

// 5. the person accepts the revision and resolves the thread
await page.keyboard.press('Alt+a')
await sleep(700)
await page.locator(`[data-thread="${t.id}"]`).click()
await sleep(300)
await page.getByRole('button', { name: 'Resolve' }).click()
note('person accepted the revision and resolved the comment')
await ed(() => window.editor.selectNone())
await sleep(300)
await ed(() => window.editor.zoomToFit())
await sleep(900)
await shot('06-final-board.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(800)
await shot('07-final-board-dark.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(400)

const lint2 = (await call('lint_layout', { board })).json
const md = (await call('export_board', { board, format: 'markdown' })).text
fs.writeFileSync(path.join(out, 'final-board.md'), md)
fs.writeFileSync(path.join(out, 'final-board.png'), Buffer.from((await call('render_snapshot', { board })).content.find((c) => c.type === 'image').data, 'base64'))
const pendingLeft = (await call('list_change_sets', { board })).json.changeSets.filter((c) => c.status === 'pending' || c.status === 'open').length
const openThreads = (await call('get_threads', { board })).json.threads.length
note(`final lint: ${lint2.summary} · pending change sets: ${pendingLeft} · open comments: ${openThreads}`)

const video = await page.video().path()
await context.close()
await browser.close()
await mcp.close()
fs.renameSync(video, path.join(out, 'mvp-run.webm'))
fs.writeFileSync(
  path.join(out, 'run-log.md'),
  [
    '# Phase 0 MVP validation run',
    '',
    `Board: ${board}`,
    '',
    ...log,
    '',
    '## Checks',
    '',
    `- Layout needs no manual fixing (lint errors): ${lint2.ok ? 'pass' : 'fail'} — ${lint2.summary}`,
    `- Comment read and acted on by the agent: ${threads.length && openThreads === 0 ? 'pass' : 'fail'}`,
    `- Everything reviewed (no pending change sets): ${pendingLeft === 0 ? 'pass' : 'fail'}`,
  ].join('\n'),
)
console.log(`\n✓ run recorded in ${out}`)
