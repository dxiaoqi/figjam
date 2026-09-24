// Captures screenshots + a short recording of the engine v2 features.
// usage: node scripts/media-v2.mjs <out-dir>   (expects `npm run dev` with the demo board from scripts/demo.mjs)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'media')
fs.mkdirSync(out, { recursive: true })
const cli = (args, input) => execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), ...args], { encoding: 'utf8', input })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) })
  console.log(`✓ ${name}`)
}
const ed = (fn, arg) => page.evaluate(fn, arg)
const byText = (t) => ed((t) => window.editor.blocks().find((b) => (b.text || b.title || '').startsWith(t))?.id, t)
const center = (id) => ed((id) => { const r = window.editor.pageRect(id); return window.editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }) }, id)

await page.goto('http://127.0.0.1:47820/')
await sleep(2200)
await ed(() => window.editor.zoomToFit(false))
await sleep(500)

// curved routing with endpoints on the selected connector
const conn = await ed(() => window.editor.connectors()[0].id)
await ed((id) => window.editor.select([id]), conn)
await sleep(400)
await shot('01-curved-routing-endpoints.png')

// routing via the context menu
const mid = await ed((id) => window.editor.pageToScreen(window.editor.connectorRoute(window.editor.connector(id)).mid), conn)
await page.mouse.click(mid.x, mid.y, { button: 'right' })
await sleep(500)
await shot('02-context-menu-routing.png')
await page.keyboard.press('Escape')
await ed(() => window.editor.setRoute(window.editor.connectors().map((c) => c.id), 'elbow'))
await ed(() => window.editor.selectNone())
await sleep(600)
await shot('03-elbow-routing.png')
await ed(() => window.editor.setRoute(window.editor.connectors().map((c) => c.id), 'curved'))

// align & distribute menu on a selection
const picks = await Promise.all(['Setup took', 'Keyboard shortcuts', 'Import from'].map(byText))
await ed((ids) => window.editor.select(ids), picks)
const p1 = await center(picks[1])
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await sleep(300)
await page.getByRole('menuitem', { name: /Align & distribute/ }).hover()
await sleep(500)
await shot('04-context-menu-align.png')
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
await ed(() => window.editor.selectNone())

// spacing labels + alignment guide while dragging
const goal = await byText('Goal')
const g = await center(goal)
const z = await ed(() => window.editor.camera.z)
await page.mouse.move(g.x, g.y)
await page.mouse.down()
await page.mouse.move(g.x + 30 * z, g.y + 150 * z, { steps: 12 })
await sleep(300)
await shot('05-spacing-labels.png')
await page.keyboard.press('Escape')
await page.mouse.up()
await sleep(300)

// dark mode with the minimap
await ed(() => window.editor.selectNone())
await page.mouse.move(1300, 700)
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(700)
await shot('06-dark-minimap.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()

// a 2,000-block board: canvas level of detail when far, DOM when near
const big = JSON.parse(cli(['--json', 'new-board', 'Large board (2,000 notes)'])).board.id
const colors = ['yellow', 'blue', 'green', 'pink', 'purple', 'teal', 'orange']
for (let f = 0; f < 4; f++) {
  const blocks = Array.from({ length: 500 }, (_, i) => ({ text: `Note ${f * 500 + i + 1}`, color: colors[(i + f) % colors.length], size: 's' }))
  cli(['--human', '--board', big, 'add', '--from-json', '-'], JSON.stringify({ blocks, layout: 'grid', columns: 25, frame: `Cluster ${f + 1}`, at: { x: (f % 2) * 4800, y: Math.floor(f / 2) * 5200 } }))
}
await page.goto(`http://127.0.0.1:47820/?board=${big}`)
await sleep(2500)
await ed(() => window.editor.zoomToFit(false))
await sleep(600)
await shot('07-lod-2k-overview.png')
await ed(() => window.editor.zoomToBounds({ x: 0, y: 0, w: 1400, h: 900 }))
await sleep(900)
await shot('08-lod-2k-zoomed-in.png')

const video = await page.video().path()
await context.close()
await browser.close()
fs.renameSync(video, path.join(out, 'engine-v2.webm'))
console.log('✓ engine-v2.webm')
