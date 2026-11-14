// FigJam-style comments walkthrough: quiet pins, unread dots for agent replies, one card at a time,
// comment mode with the thread list, hover previews, resolved threads behind a toggle. Recorded.
// usage: node scripts/comments-demo.mjs <out-dir>   (expects `npm run dev`)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright-core'
import { signIn } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'comments-demo')
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const mcp = new Client({ name: 'claude-code', version: 'comments-demo' })
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/nodboard.mjs'), 'mcp'], env: process.env, stderr: 'inherit' }))
const call = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args })
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  if (r.isError) throw new Error(`${name}: ${text}`)
  return JSON.parse(text)
}

const board = (await call('create_board', { title: 'Onboarding research — synthesis' })).board.id
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
  ],
})
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
await call('connect', { board, connectors: [{ from: '“Forty minutes before the first idea” — P1', to: 'Onboarding is slow' }, { from: 'First agent board was messy — P4', to: 'Tidy by default' }] })

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
await signIn(page)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const ed = (fn, arg) => page.evaluate(fn, arg)
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) })
  console.log(`· ${name}`)
}
const idOf = (label) => ed((l) => window.editor.blocks().find((b) => b.title === l || b.text === l)?.id, label)
const centerOf = (id, fx = 0.5, fy = 0.5) =>
  ed(([id, fx, fy]) => {
    const r = window.editor.pageRect(id)
    return window.editor.pageToScreen({ x: r.x + r.w * fx, y: r.y + r.h * fy })
  }, [id, fx, fy])

await page.goto(`${base()}/?board=${board}`)
await sleep(2200)
execFileSync(process.execPath, [path.join(root, 'bin/nodboard.mjs'), '--board', board, '--human', 'accept'])
await ed(() => window.editor.zoomToFit())
await sleep(800)

// Person: comment on the vague insight (select + M), then drop a pinned comment on a sticky in comment mode.
const vague = await idOf('Onboarding is slow')
await ed((id) => window.editor.select([id]), vague)
await sleep(400)
await page.keyboard.press('m')
await sleep(500)
await page.locator('[data-comment-input]').pressSequentially('Too vague — how slow, for whom? Cite the interviews.', { delay: 14 })
await page.locator('[data-comment-input]').press('Enter')
await sleep(700)
const freeze = await idOf('“A blank canvas makes me freeze” — P3')
const fp = await centerOf(freeze, 0.78, 0.3)
await page.mouse.move(fp.x - 60, fp.y + 40)
await page.mouse.move(fp.x, fp.y, { steps: 10 })
await sleep(300)
await page.mouse.click(fp.x, fp.y)
await sleep(500)
await page.locator('[data-comment-input]').pressSequentially('Strongest quote — make it the frame headline?', { delay: 14 })
await page.locator('[data-comment-input]').press('Enter')
await sleep(700)
await page.keyboard.press('Escape')
await sleep(300)
await page.keyboard.press('Escape')
await ed(() => window.editor.selectNone())
await sleep(700)

// Agent replies while every card is closed → unread dots only, nothing pops open.
const threads = (await call('get_threads', { board })).threads
const tVague = threads.find((t) => t.on?.id === vague)
const tFreeze = threads.find((t) => t.on?.id === freeze)
await call('reply_thread', { board, thread: tVague.id, text: 'On it — rewriting with numbers from P1 and P6 (35–40 min to a first board).' })
await call('reply_thread', { board, thread: tFreeze.id, text: 'Agreed. I’ll lead the Slow start cluster with it.' })
await sleep(1200)
await shot('01-quiet-pins-unread.png')

// Hover a pin → brief preview.
const pin = page.locator(`[data-thread="${tVague.id}"]`)
const box = await pin.boundingBox()
await page.mouse.move(box.x + box.width / 2 + 40, box.y + 60)
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
await sleep(900)
await shot('02-hover-preview.png')

// Open it; the agent replies again while it's open → updates in place.
await pin.click()
await sleep(900)
await call('update_blocks', { board, updates: [{ id: vague, title: 'Slow start: 35–40 min to a first idea', text: '**2 of 6** needed 35–40 minutes before a first useful board (*P1, P6*); P3 froze on the blank canvas.' }] })
await call('reply_thread', { board, thread: tVague.id, text: 'Done — the card now cites P1, P3 and P6.' })
execFileSync(process.execPath, [path.join(root, 'bin/nodboard.mjs'), '--board', board, '--human', 'accept'])
await sleep(1400)
await shot('03-card-open-live-reply.png')
await page.mouse.click(700, 840)
await sleep(700)

// Comment mode: prominent pins + thread list; resolve one, then reveal resolved threads.
await page.locator('[data-comment-toggle]').click()
await sleep(900)
await shot('04-comment-mode-sidebar.png')
await page.locator(`[data-sidebar-thread="${tFreeze.id}"]`).click()
await sleep(900)
await page.getByRole('button', { name: 'Resolve' }).click()
await sleep(900)
await page.locator('[data-show-resolved]').click()
await sleep(1000)
await shot('05-show-resolved.png')
await page.locator('[data-show-resolved]').click()
await sleep(500)
await page.keyboard.press('Escape')
await sleep(900)
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(900)
await shot('06-quiet-pins-dark.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(600)

const video = await page.video().path()
await context.close()
await browser.close()
await mcp.close()
fs.renameSync(video, path.join(out, 'comments.webm'))
console.log(`board ${board}`)

function base() {
  return 'http://127.0.0.1:47820'
}
