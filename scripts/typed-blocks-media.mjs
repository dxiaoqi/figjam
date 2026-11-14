// Media for Phase 1 typed blocks: typed board, Set as…, / palette, fields, filters, relations, matrix tidy, export.
// usage: node scripts/typed-blocks-media.mjs <out-dir>   (expects `npm run dev`)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { authHeaders, signIn } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'typed-blocks')
fs.mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:47820'
const cli = (...args) => execFileSync(process.execPath, [path.join(root, 'bin/nodboard.mjs'), ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const board = JSON.parse(cli('--json', 'new-board', 'Onboarding research — typed')).board.id
const call = (who, tool, args) => JSON.parse(cli('--json', '--board', board, ...who, 'call', tool, JSON.stringify({ board, ...args })))
const made = call(['--human'], 'create_blocks', {
  frame: 'Onboarding synthesis',
  layout: 'grid',
  columns: 4,
  at: { x: 0, y: 0 },
  blocks: [
    { text: '“Forty minutes before the first idea”', type: 'quote', fields: { interviewee: 'P1', source: 'Interview, 3 May' } },
    { text: '“A blank canvas makes me freeze”', type: 'quote', fields: { interviewee: 'P3', source: 'Interview, 5 May' } },
    { text: 'People need a first draft, not a blank page', type: 'insight' },
    { text: 'Trust comes from seeing the agent work', type: 'insight' },
    { text: 'Would templates or an agent draft help more?', type: 'question' },
    { text: 'An agent draft cuts time-to-first-board below 10 min', type: 'hypothesis', fields: { confidence: 'high' } },
    { text: 'Reviewing item by item builds trust faster than bulk accept', type: 'hypothesis', fields: { status: 'supported', confidence: 'medium' } },
    { text: 'Templates beat a blank board for researchers', type: 'hypothesis', fields: { status: 'refuted', confidence: 'low' } },
    { text: 'Open new boards on a prompt', type: 'idea' },
    { text: 'Run a 5-person test of the prompt start', type: 'todo', fields: { owner: 'maya' } },
    { text: 'Loose note from the debrief' },
  ],
})
const ids = made.created.filter((c) => c.kind === 'sticky').map((c) => c.id)
call(['--as', 'Claude Code'], 'connect', { connectors: [{ from: ids[1], to: ids[2] }, { from: ids[2], to: ids[4] }, { from: ids[5], to: ids[9] }] })
cli('--board', board, '--human', 'accept')

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
const fit = async () => {
  await ed(() => { const f = window.editor.blocks().find((b) => b.kind === 'frame'); const r = window.editor.pageRect(f.id); window.editor.zoomToBounds({ x: r.x - 80, y: r.y - 140, w: r.w + 160, h: r.h + 320 }, { animate: false }) })
  await sleep(700)
}
const center = (id) => ed((i) => { const r = window.editor.pageRect(i); return window.editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }) }, id)
await page.goto(`${base}/?board=${board}`)
await sleep(2500)
await fit()
await shot('01-typed-board.png')

// Set as… on the loose note
await ed((i) => window.editor.select([i]), ids[10])
const p10 = await center(ids[10])
await page.mouse.click(p10.x, p10.y, { button: 'right' })
await sleep(300)
await page.locator('[data-set-as]').click()
await sleep(500)
await shot('02-set-as-menu.png')
await page.locator('[data-set-type="question"]').click()
await sleep(600)

// `/` while writing a new sticky
const frameBottom = await ed(() => { const f = window.editor.blocks().find((b) => b.kind === 'frame'); const r = window.editor.pageRect(f.id); return window.editor.pageToScreen({ x: r.x + r.w + 140, y: r.y + 120 }) })
await page.mouse.dblclick(frameBottom.x, frameBottom.y)
await sleep(400)
await page.keyboard.type('/', { delay: 80 })
await sleep(500)
await shot('03-slash-palette.png')
await page.keyboard.type('hy', { delay: 120 })
await sleep(300)
await page.keyboard.press('Enter')
await sleep(200)
await page.keyboard.type('Researchers share boards only after a tidy pass', { delay: 25 })
await page.keyboard.press('Escape')
await sleep(600)

// fields popover on a hypothesis
await page.locator(`[data-block-id="${ids[5]}"] [data-type-footer] button`).first().click()
await sleep(500)
await shot('04-fields-popover.png')
await page.keyboard.press('Escape')
await sleep(300)

// filter: unverified hypotheses
await page.locator('[data-filter-type="hypothesis"]').click()
await sleep(400)
await page.locator('[data-filter-field="status=unverified"]').click()
await sleep(700)
await shot('05-filter-unverified-hypotheses.png')
await page.locator('[aria-label="Clear filter"]').click()
await sleep(400)

// matrix tidy: types × status
const frame = made.frame
cli('--board', board, '--human', 'tidy', '--frame', frame, '--by', 'matrix', '--field', 'status')
await sleep(900)
await fit()
await shot('06-matrix-types-by-status.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(800)
await shot('07-typed-board-dark.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(500)

fs.writeFileSync(path.join(out, 'export-by-type.md'), cli('--board', board, 'export', '--format', 'md'))
fs.writeFileSync(path.join(out, 'query-unverified.txt'), `$ nodboard query --type hypothesis --status unverified\n${cli('--board', board, 'query', '--type', 'hypothesis', '--status', 'unverified')}\n$ nodboard types\n${cli('types')}`)
const png = await fetch(`http://127.0.0.1:47821/api/boards/${board}/snapshot.png`, { headers: authHeaders() }).then((r) => r.arrayBuffer())
fs.writeFileSync(path.join(out, '08-export-snapshot.png'), Buffer.from(png))
const video = await page.video().path()
await context.close()
await browser.close()
fs.renameSync(video, path.join(out, 'typed-blocks.webm'))
console.log(`board ${board}`)
