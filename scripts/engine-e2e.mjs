// End-to-end checks for the in-house canvas engine, driven through real pointer/keyboard input.
// usage: node scripts/engine-e2e.mjs [screenshot-dir]   (expects `npm run dev` running)
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2]
const base = 'http://127.0.0.1:47820'
const cli = (...args) => execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), ...args], { encoding: 'utf8' })
const board = JSON.parse(cli('--json', 'new-board', `Engine check ${Date.now().toString(36)}`)).board.id

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(`${base}/?board=${board}`)
await page.waitForTimeout(2000)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const ed = (fn, arg) => page.evaluate(fn, arg)
const blocks = () => ed(() => window.editor.blocks().map((b) => ({ id: b.id, kind: b.kind, text: b.text, title: b.title, x: b.x, y: b.y, w: b.w, h: b.h, parent: b.parent ?? null })))
const screenOf = (id) => ed((id) => {
  const r = window.editor.pageRect(id)
  const p = window.editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
  return { x: p.x, y: p.y, w: r.w * window.editor.camera.z, h: r.h * window.editor.camera.z }
}, id)
const wait = (ms = 250) => page.waitForTimeout(ms)
const shot = async (name) => outDir && (await page.screenshot({ path: path.join(outDir, name) }))

// 1. double-click → sticky, type, Tab → next sticky
await page.mouse.dblclick(400, 300)
await wait()
await page.keyboard.type('First thought')
await page.keyboard.press('Tab')
await wait()
await page.keyboard.type('Second thought')
await page.keyboard.press('Escape')
await wait(400)
let bs = await blocks()
const a = bs.find((b) => b.text === 'First thought')
const b = bs.find((b) => b.text === 'Second thought')
check('double-click creates a sticky, Tab continues', !!a && !!b && b.x === a.x + a.w + 24 && b.y === a.y, `${bs.length} blocks`)

// 2. drag moves and snaps to the 8px grid
const sa = await screenOf(a.id)
await page.mouse.move(sa.x, sa.y)
await page.mouse.down()
await page.mouse.move(sa.x + 40, sa.y + 150, { steps: 8 })
await page.mouse.up()
await wait()
bs = await blocks()
const a2 = bs.find((x) => x.id === a.id)
check('drag moves the block on the grid', a2.y > a.y + 100 && a2.x % 8 === 0 && a2.y % 8 === 0, `(${a.x},${a.y}) → (${a2.x},${a2.y})`)

// 3. undo / redo
await page.keyboard.press('Control+z')
await wait()
let a3 = (await blocks()).find((x) => x.id === a.id)
check('undo restores the position', a3.x === a.x && a3.y === a.y)
await page.keyboard.press('Control+Shift+z')
await wait()
a3 = (await blocks()).find((x) => x.id === a.id)
check('redo re-applies it', a3.y === a2.y)

// 4. connector: drag from a connect handle onto the other sticky
await page.mouse.move(sa.x, sa.y + 150)
await wait(150)
const sb = await screenOf(b.id)
const handle = await page.locator('.ae-connect-handle').first().boundingBox()
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
await page.mouse.down()
await page.mouse.move(sb.x, sb.y, { steps: 10 })
await wait(100)
await shot('engine-connect-drag.png')
await page.mouse.up()
await wait()
let conns = await ed(() => window.editor.connectors().map((c) => [c.from, c.to]))
check('drag from a connect handle creates a connector', conns.length === 1, JSON.stringify(conns))

// 5. drop a connector on empty canvas → new connected sticky in edit mode
const sb2 = await screenOf(b.id)
await page.mouse.move(sb2.x, sb2.y)
await wait(150)
const handles = await page.locator('.ae-connect-handle').all()
const right = await handles[1].boundingBox()
await page.mouse.move(right.x + 6, right.y + 6)
await page.mouse.down()
await page.mouse.move(right.x + 260, right.y + 6, { steps: 10 })
await page.mouse.up()
await wait()
await page.keyboard.type('Dropped here')
await page.keyboard.press('Escape')
await wait(300)
bs = await blocks()
conns = await ed(() => window.editor.connectors().length)
check('connector dropped on empty canvas creates a connected sticky', !!bs.find((x) => x.text === 'Dropped here') && conns === 2)

// 6. marquee select + frame tool around everything
await page.mouse.move(120, 120)
await page.mouse.down()
await page.mouse.move(1300, 760, { steps: 10 })
await page.mouse.up()
await wait()
const selCount = await ed(() => window.editor.selection.size)
check('marquee selects blocks', selCount === 3, `${selCount} selected`)
await page.keyboard.press('f')
await page.mouse.move(150, 150)
await page.mouse.down()
await page.mouse.move(1350, 780, { steps: 10 })
await page.mouse.up()
await wait()
await page.keyboard.type('Brainstorm')
await page.keyboard.press('Enter')
await wait(300)
bs = await blocks()
const frame = bs.find((x) => x.kind === 'frame')
check('frame tool wraps the blocks and edits its title', frame?.title === 'Brainstorm' && bs.filter((x) => x.parent === frame.id).length === 3)

// 7. card tool, type, then resize wider
await page.keyboard.press('c')
await page.mouse.click(1000, 200)
await wait()
await page.keyboard.type('A card title')
await page.keyboard.press('Escape')
await wait(300)
const card = (await blocks()).find((x) => x.kind === 'card')
await ed((id) => window.editor.select([id]), card.id)
await wait()
const eh = await page.locator('.ae-handle-e').boundingBox()
await page.mouse.move(eh.x + eh.width / 2, eh.y + eh.height / 2)
await page.mouse.down()
await page.mouse.move(eh.x + 90, eh.y + eh.height / 2, { steps: 6 })
await page.mouse.up()
await wait()
const card2 = (await blocks()).find((x) => x.id === card.id)
check('card resizes from its edge handle', card2.w > card.w && card2.w % 8 === 0, `${card.w} → ${card2.w}`)

// 8. copy / paste, delete + undo
await page.keyboard.press('Control+c')
await page.mouse.move(900, 600)
await page.keyboard.press('Control+v')
await wait(300)
const cards = (await blocks()).filter((x) => x.kind === 'card')
check('copy / paste duplicates', cards.length === 2)
await page.keyboard.press('Delete')
await wait()
check('delete removes the selection', (await blocks()).filter((x) => x.kind === 'card').length === 1)

// 9. zoom and pan
const z0 = await ed(() => window.editor.camera.z)
await page.mouse.move(700, 450)
await page.mouse.wheel(0, -200)
await page.keyboard.down('Control')
await page.mouse.wheel(0, -40)
await page.keyboard.up('Control')
await wait()
const z1 = await ed(() => window.editor.camera.z)
check('ctrl+wheel zooms around the pointer', z1 > z0, `${z0.toFixed(2)} → ${z1.toFixed(2)}`)
await page.keyboard.press('Shift+1')
await wait(500)

// 10. an agent writes while the page is open
cli('--as', 'Claude Code', '--board', board, 'add', 'Agent idea one', 'Agent idea two', '--inside', frame.id, '-i', 'Add two agent ideas')
await wait(700)
await shot('engine-agent-live.png')
const agentBlocks = await ed(() => window.editor.blocks().filter((b) => b.author?.kind === 'agent').length)
const pendingEls = await page.locator('.ae-block.is-pending').count()
check('agent edits appear live as pending suggestions', agentBlocks === 2 && pendingEls >= 2, `${pendingEls} pending`)

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
cli('--human', 'call', 'delete_board', JSON.stringify({ board }))
console.log(failures ? `\n${failures} check(s) failed` : '\nall engine checks passed')
process.exit(failures ? 1 : 0)
