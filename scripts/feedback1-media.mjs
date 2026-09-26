// "After" screenshots for feedback round 1: deduplicated agent history, long-content cards.
// usage: node scripts/feedback1-media.mjs <out-dir>   (expects `npm run dev`)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { authHeaders, signIn } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'feedback1')
fs.mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:47820'
const cli = (...args) => execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), ...args], { encoding: 'utf8' })
const callAs = (caller, tool, args) => fetch(`${base}/api/call`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ tool, args, caller }) }).then((r) => r.json())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const board = JSON.parse(cli('--json', 'new-board', 'Auth service — design review')).board.id
const long = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/long-card.json'), 'utf8'))
cli('--board', board, '--human', 'call', 'create_blocks', JSON.stringify({
  board,
  frame: 'API contracts',
  layout: 'stack',
  at: { x: 0, y: 0 },
  blocks: [
    { kind: 'card', title: long.title, text: long.text, color: 'purple' },
    { kind: 'card', title: 'Token refresh · POST /v1/auth/refresh', text: 'Rotate the `refresh_token` on every call; reuse of an old token revokes the family.', color: 'blue' },
  ],
}))
cli('--board', board, '--human', 'call', 'create_blocks', JSON.stringify({
  board,
  frame: 'Open questions',
  right_of: 'API contracts',
  layout: 'stack',
  blocks: [
    { kind: 'sticky', color: 'yellow', text: 'Do we lock by account or by account + IP? P2 travels a lot and got locked out twice last month; P5 wants per-IP limits only. Security wants both, with `mfa_code` as the escape hatch — needs a decision before the pilot.' },
    { kind: 'text', size: 'l', text: 'Rollout plan: shadow traffic first, then 10% of logins, then everyone' },
  ],
}))
// seven sessions of the same agent plus two other agents
const intents = ['Draft the login contract', 'Add error codes', 'Add rate limits', 'Tidy the contracts frame', 'Link the audit spec', 'Fix code formatting', 'Add the refresh endpoint']
for (let i = 0; i < intents.length; i++) {
  await callAs({ id: `opencode:${4100 + i}`, name: 'Agent', client: 'opencode', kind: 'agent' }, 'create_blocks', { board, intent: intents[i], blocks: [{ text: intents[i] }], at: { x: 1200 + (i % 4) * 240, y: 800 + Math.floor(i / 4) * 240 } })
}
await callAs({ id: 'zed:77', name: 'Agent', client: 'zed', kind: 'agent' }, 'create_blocks', { board, intent: 'Summarize open questions', blocks: [{ text: 'Summary of open questions' }], at: { x: 1200, y: 1300 } })
await callAs({ id: 'claude-code:5', name: '', client: 'claude-code', kind: 'agent' }, 'create_blocks', { board, intent: 'Review the rollout plan', blocks: [{ text: 'Rollout risks' }], at: { x: 1500, y: 1300 } })
cli('--board', board, '--human', 'accept')

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
await signIn(page)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const ed = (fn, arg) => page.evaluate(fn, arg)
const shot = async (name, opts = {}) => {
  await page.screenshot({ path: path.join(out, name), ...opts })
  console.log(`· ${name}`)
}
await page.goto(`${base}/?board=${board}`)
await sleep(2500)

// 1. history: one entry per agent, scrolling list, one secondary bulk action
await ed(() => window.editor.zoomToFit())
await sleep(600)
await page.getByRole('button', { name: 'History' }).click()
await sleep(500)
await page.locator('[data-undo-all]').click()
await sleep(500)
const menu = await page.locator('[data-history-menu]').boundingBox()
const sub = await page.locator('[data-undo-author]').first().boundingBox()
const subLast = await page.locator('[data-undo-author]').last().boundingBox()
const x = Math.min(menu.x, sub.x) - 16
const bottom = Math.max(menu.y + menu.height, subLast.y + subLast.height) + 16
await shot('after-undo-history-deduped.png', { clip: { x, y: menu.y - 56, width: menu.x + menu.width - x + 16, height: bottom - menu.y + 56 } })
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
await sleep(300)

// 2. long card: grows to its max height, then fades with "Show more"; neighbors clear
const ids = await ed(() => Object.fromEntries(window.editor.blocks().map((b) => [b.title || b.text.slice(0, 12), b.id])))
const frameRect = await ed(() => { const f = window.editor.blocks().find((b) => b.title === 'API contracts'); return window.editor.pageRect(f.id) })
await ed((r) => window.editor.zoomToBounds({ x: r.x - 40, y: r.y - 60, w: r.w + 420, h: r.h + 120 }, { animate: false, maxZoom: 1.4 }), frameRect)
await sleep(900)
await shot('after-long-card-collapsed.png')
const longId = ids[long.title]
await page.locator(`[data-block-id="${longId}"] [data-more-toggle="more"]`).click()
await sleep(900)
const fr2 = await ed(() => { const f = window.editor.blocks().find((b) => b.title === 'API contracts'); return window.editor.pageRect(f.id) })
await ed((r) => window.editor.zoomToBounds({ x: r.x - 40, y: r.y - 60, w: r.w + 420, h: r.h + 120 }, { animate: false }), fr2)
await sleep(900)
await shot('after-long-card-expanded.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(700)
await page.locator(`[data-block-id="${longId}"]`).hover()
await page.locator(`[data-block-id="${longId}"] [data-more-toggle="less"]`).click()
await sleep(900)
await ed((r) => window.editor.zoomToBounds({ x: r.x - 40, y: r.y - 60, w: r.w + 420, h: r.h + 120 }, { animate: false, maxZoom: 1.4 }), frameRect)
await sleep(700)
await page.mouse.move(10, 450)
await shot('after-long-content-dark.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(400)
const svg = await fetch(`http://127.0.0.1:47821/api/boards/${board}/snapshot.png?ids=${longId}`, { headers: authHeaders() }).then((r) => r.arrayBuffer())
fs.writeFileSync(path.join(out, 'after-long-card-export.png'), Buffer.from(svg))
console.log('· after-long-card-export.png')
console.log(JSON.stringify(JSON.parse(cli('--json', '--board', board, 'lint')).summary))
await browser.close()
