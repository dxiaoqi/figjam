// Media for the Phase 0 gaps: review diffs + ghosts, and agent moves held back while you type.
// usage: node scripts/phase0-gaps-media.mjs <out-dir>   (expects `npm run dev`)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { signIn } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'phase0-gaps')
fs.mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:47820'
const cli = (...args) => execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const agent = (tool, args) => cli('--board', board, '--as', 'Claude Code', 'call', tool, JSON.stringify({ board, ...args }))

const board = JSON.parse(cli('--json', 'new-board', 'Pricing page — review')).board.id
const made = JSON.parse(cli('--json', '--board', board, '--human', 'call', 'create_blocks', JSON.stringify({
  board,
  frame: 'Pricing page',
  layout: 'grid',
  columns: 3,
  at: { x: 0, y: 0 },
  blocks: [
    { kind: 'card', title: 'Free', text: 'One board, **3 agents**, community support.', color: 'gray' },
    { kind: 'card', title: 'Team', text: 'Teams pay per seat, billed monthly. Unlimited boards.', color: 'blue' },
    { kind: 'card', title: 'Enterprise', text: 'SSO, audit log, on-prem sync. Talk to sales.', color: 'purple' },
    { text: 'Old promo: 50% off until March', color: 'orange' },
    { text: 'Compare with FigJam pricing', color: 'yellow' },
    { text: 'FAQ: what counts as a seat?', color: 'green' },
  ],
})))
const id = (label) => JSON.parse(cli('--json', '--board', board, 'call', 'get_board', JSON.stringify({ board, format: 'json' }))).frames[0].children.find((b) => b.title === label || b.text === label).id
const team = id('Team')
const promo = id('Old promo: 50% off until March')
const faq = id('FAQ: what counts as a seat?')

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
await page.goto(`${base}/?board=${board}`)
await sleep(2500)
await ed(() => { const f = window.editor.blocks().find((b) => b.kind === 'frame'); const r = window.editor.pageRect(f.id); window.editor.zoomToBounds({ x: r.x - 80, y: r.y - 120, w: r.w + 560, h: r.h + 420 }, { animate: false }) })
await sleep(800)

// 1. the agent edits, moves and removes things → diffs and ghosts
const t = await ed((i) => ({ x: window.editor.block(i).x, y: window.editor.block(i).y }), team)
agent('set_status', { status: 'Revising pricing copy…' })
agent('begin_change_set', { intent: 'Revise pricing after the interviews' })
agent('update_blocks', { updates: [{ id: team, text: 'Teams pay per **active** seat, billed annually. Unlimited boards and agents.' }] })
agent('update_blocks', { updates: [{ id: faq, x: t.x + 320 * 2, y: t.y + 380 }] })
agent('delete_blocks', { ids: [promo] })
agent('commit_change_set', {})
await sleep(1600)
await shot('01-ghosts-for-moves-and-removals.png')
await page.keyboard.press('j')
await sleep(900)
await shot('02-item-diff-text.png')
for (let i = 0; i < 6; i++) {
  if (((await page.locator('[data-review-item]').textContent()) ?? '').includes('FAQ')) break
  await page.keyboard.press('j')
  await sleep(700)
}
await shot('03-item-diff-move.png')
await page.keyboard.press('Shift+A')
await sleep(900)

// 2. typing next to a block the agent wants to move: the move waits, then settles in
await ed((i) => { const r = window.editor.pageRect(i); window.editor.zoomToBounds({ x: r.x - 260, y: r.y - 180, w: r.w + 720, h: r.h + 520 }, { animate: false }) }, team)
await sleep(700)
const p = await ed((i) => { const r = window.editor.pageRect(i); return window.editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h - 20 }) }, team)
await page.mouse.dblclick(p.x, p.y)
await sleep(500)
await page.keyboard.press('Tab')
await sleep(200)
await page.keyboard.type(' Nonprofits get 50% off', { delay: 45 })
const enterprise = id('Enterprise')
const e = await ed((i) => window.editor.block(i).y, enterprise)
agent('update_blocks', { intent: 'Line up the tiers', updates: [{ id: enterprise, y: e + 120 }] })
await page.keyboard.type(' — ask support.', { delay: 45 })
await sleep(150)
await shot('04-move-held-while-typing.png')
await page.keyboard.type(' Applies to', { delay: 60 })
await sleep(1900)
await shot('05-settled-after-pause.png')
await page.keyboard.press('Escape')
await sleep(800)
cli('--board', board, '--human', 'accept')
await sleep(600)

const video = await page.video().path()
await context.close()
await browser.close()
fs.renameSync(video, path.join(out, 'review-diffs-and-held-moves.webm'))
console.log(`board ${board}`)
