// Captures screenshots + a short recording of the engine v3 features.
// usage: node scripts/media-v3.mjs <out-dir> <demo-board-id>   (expects `npm run dev`)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'media')
const demo = process.argv[3]
fs.mkdirSync(out, { recursive: true })
const cli = (args) => execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// two small illustrations to use as image blocks
const svgs = {
  palette: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#FAFAF9"/>${['#FFF1B8', '#FFD9D6', '#E8DEFF', '#D6E8FF', '#CDF1EC', '#DDF3D2'].map((c, i) => `<rect x="${40 + (i % 3) * 190}" y="${40 + Math.floor(i / 3) * 180}" width="170" height="160" rx="10" fill="${c}"/>`).join('')}</svg>`,
  wire: `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="400"><rect width="560" height="400" rx="16" fill="#FFFFFF"/><rect x="24" y="24" width="512" height="44" rx="8" fill="#EDEDEB"/><rect x="24" y="92" width="160" height="284" rx="8" fill="#F4F4F2"/><rect x="204" y="92" width="332" height="136" rx="8" fill="#E8DEFF"/><rect x="204" y="244" width="160" height="132" rx="8" fill="#D6E8FF"/><rect x="376" y="244" width="160" height="132" rx="8" fill="#CDF1EC"/></svg>`,
}
for (const [k, svg] of Object.entries(svgs)) fs.writeFileSync(`/tmp/aifig-${k}.png`, new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 } }).render().asPng())

const mood = JSON.parse(cli(['--json', 'new-board', 'Moodboard (v3)'])).board.id
const frame = JSON.parse(cli(['--json', '--human', '--board', mood, 'add', 'Warm, calm, a little playful', '--kind', 'text', '--size', 'l', '--frame', 'Direction'])).frame
cli(['--human', '--board', mood, 'image', '/tmp/aifig-palette.png', '--width', '320', '--inside', frame])
cli(['--human', '--board', mood, 'image', '/tmp/aifig-wire.png', '--width', '280', '--inside', frame])

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, hasTouch: true, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) })
  console.log(`✓ ${name}`)
}
const ed = (fn, arg) => page.evaluate(fn, arg)
const center = (id) => ed((id) => { const r = window.editor.pageRect(id); return window.editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }) }, id)

// 1. moving a frame by its header, with guides
await page.goto(`http://127.0.0.1:47820/?board=${demo}`)
await sleep(2200)
await ed(() => window.editor.zoomToFit(false))
await sleep(400)
const lbl = await page.locator('.ae-frame-label', { hasText: 'Opportunities' }).boundingBox()
await page.mouse.move(lbl.x + 12, lbl.y + lbl.height / 2)
await page.mouse.down()
await page.mouse.move(lbl.x + 40, lbl.y + 90, { steps: 14 })
await sleep(250)
await shot('01-frame-move-guides.png')
await page.keyboard.press('Escape')
await page.mouse.up()

// 2. elbow waypoints + label avoiding a block
const conn = await ed(() => {
  const ed = window.editor
  const c = ed.connectors()[0]
  ed.setRoute([c.id], 'elbow')
  const route = ed.connectorRoute(c)
  ed.setWaypoints(c.id, [{ x: Math.round((route.start.x + route.end.x) / 16) * 8, y: Math.round((route.start.y - 60) / 8) * 8 }])
  ed.updateConnector(c.id, { label: 'leads to' })
  ed.select([c.id])
  return c.id
})
await sleep(500)
await shot('02-elbow-waypoints-label.png')
await ed((id) => { window.editor.setWaypoints(id, []); window.editor.setRoute([id], 'curved'); window.editor.updateConnector(id, { label: '' }); window.editor.selectNone() }, conn)

// 3. moodboard: images, rotation, rich text
await page.goto(`http://127.0.0.1:47820/?board=${mood}`)
await sleep(2200)
const ids = await ed(() => {
  const ed = window.editor
  const imgs = ed.blocks().filter((b) => b.kind === 'image').map((b) => b.id)
  const f = ed.blocks().find((b) => b.kind === 'frame')
  const note = ed.createBlock({ kind: 'sticky', x: 760, y: 40, w: 200, h: 200, text: 'Keep the **palette** soft — *never* neon', color: 'yellow', size: 'm', rotation: 0 })
  const card = ed.createBlock({ kind: 'card', x: 1000, y: 40, w: 300, h: 180, title: 'Principles', text: '- Calm by default\n- Motion explains, never decorates\n- See `tokens.ts` and [the brief](https://example.com)', color: 'purple', size: 'm' })
  ed.zoomToBounds({ x: -80, y: -120, w: 1500, h: 760 }, { animate: false })
  return { imgs, frame: f.id, note, card }
})
await sleep(600)
// rotate the sticky with the handle
await ed((id) => window.editor.select([id]), ids.note)
await sleep(200)
const rh = await page.locator('.ae-rotate-handle').boundingBox()
const nc = await center(ids.note)
await page.mouse.move(rh.x + rh.width / 2, rh.y + rh.height / 2)
await page.mouse.down()
const rad = Math.hypot(rh.x + rh.width / 2 - nc.x, rh.y + rh.height / 2 - nc.y)
for (let i = 1; i <= 8; i++) {
  const a = -Math.PI / 4 - (0.3 * i) / 8
  await page.mouse.move(nc.x + Math.cos(a) * rad, nc.y + Math.sin(a) * rad)
}
await sleep(200)
await shot('03-rotation-snapping.png')
await page.mouse.up()
await sleep(200)
// rich text editing with the toolbar
await ed((id) => window.editor.startEditing(id), ids.card)
await sleep(500)
await page.keyboard.press('Enter')
await sleep(100)
await page.keyboard.press('Enter')
await page.keyboard.type('Ship ')
await page.keyboard.press('Control+b')
await page.keyboard.type('fewer, better')
await page.keyboard.press('Control+b')
await page.keyboard.type(' things')
await sleep(300)
await shot('04-rich-text-toolbar.png')
await page.keyboard.press('Escape')
await sleep(300)
// select an image to show aspect-locked handles
await ed((id) => window.editor.select([id]), ids.imgs[0])
await sleep(300)
await shot('05-images-rotation-rich-text.png')
await ed(() => window.editor.selectNone())

// 4. touch long-press menu
const cdp = await context.newCDPSession(page)
const cc = await center(ids.card)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cc.x, y: cc.y, id: 1 }] })
await sleep(700)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(400)
await shot('06-touch-long-press-menu.png')
await page.keyboard.press('Escape')
await sleep(300)

// 5. export of the moodboard rendered by the core (rotation, images, rich text)
const png = await ed(async (board) => [...new Uint8Array(await (await fetch(`/api/boards/${board}/snapshot.png`)).arrayBuffer())], mood)
fs.writeFileSync(path.join(out, '07-export-png.png'), Buffer.from(png))
console.log('✓ 07-export-png.png')

const video = await page.video().path()
await context.close()
await browser.close()
fs.renameSync(video, path.join(out, 'engine-v3.webm'))
console.log('✓ engine-v3.webm')
