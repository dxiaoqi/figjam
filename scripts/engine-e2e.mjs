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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true })
const page = await context.newPage()
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

// 6b. frame titles: double-click the label, IME-safe Enter, persists to the core, undoable
const lbl = await page.locator(`[data-frame-label="${frame.id}"]`).boundingBox()
await page.mouse.dblclick(lbl.x + 12, lbl.y + lbl.height / 2)
await wait(200)
check('double-click on a frame title starts editing it', (await ed(() => window.editor.editingId)) === frame.id)
const childVisible = await ed((fid) => {
  const ed = window.editor
  const kid = ed.blocks().find((b) => b.parent === fid)
  const r = ed.pageRect(kid.id)
  const p = ed.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
  const host = document.querySelector('.ae-canvas').getBoundingClientRect()
  return document.elementFromPoint(host.left + p.x, host.top + p.y)?.closest('[data-block-id]')?.dataset.blockId === kid.id
}, frame.id)
check('frame children stay visible while its title is edited', childVisible)
await page.keyboard.press('Control+a')
await page.keyboard.type('Ideas')
await ed(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
await wait(100)
check('Enter during IME composition does not commit', (await ed(() => window.editor.editingId)) === frame.id)
await page.keyboard.press('Enter')
await wait(400)
const coreTitle = JSON.parse(cli('--json', '--board', board, 'read', '--frame', frame.id)).markdown.includes('Frame "Ideas"')
check('renamed title commits on Enter and persists to the core', (await ed((id) => window.editor.block(id).title, frame.id)) === 'Ideas' && coreTitle)
await page.keyboard.press('Control+z')
await wait(200)
check('title rename is undoable', (await ed((id) => window.editor.block(id).title, frame.id)) === 'Brainstorm')
await page.keyboard.press('Control+Shift+z')
const fr = await ed((id) => { const r = window.editor.pageRect(id); return window.editor.pageToScreen({ x: r.x + r.w - 30, y: r.y + r.h - 30 }) }, frame.id)
await page.mouse.dblclick(fr.x, fr.y)
await wait(200)
check('double-click on empty frame area edits the title', (await ed(() => window.editor.editingId)) === frame.id)
await page.keyboard.press('End')
await page.keyboard.type(' board')
await page.mouse.click(1400, 60)
await wait(300)
check('blur commits the title', (await ed((id) => [window.editor.editingId, window.editor.block(id).title], frame.id)).join('|') === '|Ideas board')

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

// ---- v2: context menu, arrange, routing, endpoints, spacing, minimap, export, touch, LOD, perf ----
await page.keyboard.press('Escape')
await ed(() => window.editor.setCamera({ x: 0, y: 0, z: 1 }))
const mk = (texts, y, layout = 'row') =>
  JSON.parse(cli('--json', '--human', '--board', board, 'add', ...texts, '--layout', layout, '--intent', 'e2e')).created.map((c) => c.id)
// place a clean row far from the earlier content
const row = await ed(() => {
  const ed = window.editor
  const ids = ['r1', 'r2', 'r3'].map((t, i) => ed.createBlock({ kind: 'sticky', x: 2000 + i * 260 + (i === 1 ? 40 : 0), y: 2000 + i * 30, w: 200, h: 200, text: `Row ${i + 1}`, color: 'blue' }))
  ed.zoomToBounds({ x: 1900, y: 1900, w: 900, h: 500 }, { animate: false })
  return ids
})
await wait(300)

// context menu on a block
let s1 = await screenOf(row[0])
await page.mouse.click(s1.x, s1.y, { button: 'right' })
await wait(250)
check('right-click opens the context menu', await page.getByRole('menuitem', { name: /Align & distribute/ }).isVisible())
await page.keyboard.press('Escape')
await wait(150)

// align top + distribute horizontally via the menu
await ed((ids) => window.editor.select(ids), row)
s1 = await screenOf(row[1])
await page.mouse.click(s1.x, s1.y, { button: 'right' })
await wait(200)
await page.getByRole('menuitem', { name: /Align & distribute/ }).hover()
await wait(200)
await page.getByRole('menuitem', { name: 'Align top' }).click()
await wait(200)
let rs = await ed((ids) => ids.map((id) => window.editor.block(id)), row)
check('context menu → align top', new Set(rs.map((b) => b.y)).size === 1, rs.map((b) => b.y).join(','))
await page.mouse.click(s1.x, s1.y, { button: 'right' })
await wait(200)
await page.getByRole('menuitem', { name: /Align & distribute/ }).hover()
await wait(200)
await page.getByRole('menuitem', { name: 'Distribute horizontally' }).click()
await wait(200)
rs = (await ed((ids) => ids.map((id) => window.editor.block(id)), row)).sort((a, b) => a.x - b.x)
const gaps = [rs[1].x - (rs[0].x + rs[0].w), rs[2].x - (rs[1].x + rs[1].w)]
check('context menu → distribute horizontally', Math.abs(gaps[0] - gaps[1]) <= 1, gaps.join(' / '))

// z-order
await ed((id) => { window.editor.select([id]); window.editor.sendToBack() }, row[2])
let order = await ed(() => window.editor.blocks().filter((b) => b.kind !== 'frame').map((b) => b.id))
check('send to back reorders', order[0] === row[2])
await ed((id) => { window.editor.select([id]); window.editor.bringToFront() }, row[2])
order = await ed(() => window.editor.blocks().filter((b) => b.kind !== 'frame').map((b) => b.id))
check('bring to front reorders', order[order.length - 1] === row[2])

// group into frame (⌘G)
await ed((ids) => window.editor.select(ids), row)
await page.keyboard.press('Control+g')
await wait(200)
await page.keyboard.press('Escape')
const grouped = await ed((ids) => ids.map((id) => window.editor.block(id).parent), row)
check('⌘G groups into a frame', grouped.every((p) => p && p === grouped[0]))

// elbow routing avoids an obstacle; connectors render above blocks
const obst = await ed(() => {
  const ed = window.editor
  const a = ed.createBlock({ kind: 'sticky', x: 3200, y: 2000, w: 160, h: 160, text: 'A', color: 'green' })
  const b = ed.createBlock({ kind: 'sticky', x: 3440, y: 2000, w: 160, h: 160, text: 'Obstacle', color: 'red' })
  const c = ed.createBlock({ kind: 'sticky', x: 3680, y: 2000, w: 160, h: 160, text: 'C', color: 'green' })
  const conn = ed.createConnector(a, c)
  ed.setRoute([conn], 'elbow')
  return { a, b, c, conn }
})
await wait(200)
const route = await ed(({ conn, b }) => {
  const ed = window.editor
  const r = ed.connectorRoute(ed.connector(conn))
  const o = ed.pageRect(b)
  const axis = r.points.every((p, i) => i === 0 || p.x === r.points[i - 1].x || p.y === r.points[i - 1].y)
  const clear = r.points.every((p, i) => {
    if (i === 0) return true
    const q = r.points[i - 1]
    const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y)
    return x2 <= o.x || x1 >= o.x + o.w || y2 <= o.y || y1 >= o.y + o.h
  })
  return { axis, clear, n: r.points.length }
}, obst)
check('elbow route is orthogonal and avoids the obstacle', route.axis && route.clear, `${route.n} points`)
await ed(({ conn }) => window.editor.setRoute([conn], 'curved'), obst)
const curvedClear = await ed(({ conn, b }) => {
  const ed = window.editor
  const r = ed.connectorRoute(ed.connector(conn))
  const o = ed.pageRect(b)
  return r.points.every((p) => !(p.x > o.x && p.x < o.x + o.w && p.y > o.y && p.y < o.y + o.h))
}, obst)
check('curved route flows around the obstacle', curvedClear)
const layerOrder = await ed(() => {
  const blocks = document.querySelector('.ae-world > .ae-layer:nth-child(2)')
  const conns = document.querySelector('.ae-connectors')
  return !!(blocks && conns && blocks.compareDocumentPosition(conns) & Node.DOCUMENT_POSITION_FOLLOWING)
})
check('connectors render above blocks', layerOrder)

// routing style via the context menu
await ed(() => window.editor.zoomToBounds({ x: 3100, y: 1800, w: 900, h: 500 }, { animate: false }))
await wait(250)
const mid = await ed(({ conn }) => {
  const ed = window.editor
  return ed.pageToScreen(ed.connectorRoute(ed.connector(conn)).mid)
}, obst)
await page.mouse.click(mid.x, mid.y)
await wait(150)
await page.mouse.click(mid.x, mid.y, { button: 'right' })
await wait(200)
await page.getByRole('menuitemradio', { name: 'Elbow' }).click()
await wait(200)
check('context menu sets connector routing', (await ed(({ conn }) => window.editor.connector(conn).route, obst)) === 'elbow')

// free-floating connector, then rebind its end by dragging the endpoint onto a block
await page.keyboard.press('a')
await page.mouse.move(420, 700)
await page.mouse.down()
await page.mouse.move(700, 760, { steps: 8 })
await page.mouse.up()
await wait(200)
const free = await ed(() => {
  const ed = window.editor
  const c = ed.connectors().find((c) => c.fromPoint && c.toPoint)
  return c && { id: c.id, from: c.from ?? null, to: c.to ?? null }
})
check('connector tool draws a free-floating connector', !!free && !free.from && !free.to)
await page.keyboard.press('v')
const endHandle = await page.locator('[data-endpoint="end"]').boundingBox()
const target = await screenOf(obst.c)
await page.mouse.move(endHandle.x + 6, endHandle.y + 6)
await page.mouse.down()
await page.mouse.move(target.x, target.y, { steps: 10 })
await page.mouse.up()
await wait(200)
check('dragging an endpoint onto a block rebinds it', (await ed((id) => window.editor.connector(id).to, free.id)) === obst.c)

// distance labels + 24px spacing snap while dragging
const sp = await ed(() => {
  const ed = window.editor
  const a = ed.createBlock({ kind: 'sticky', x: 4400, y: 2000, w: 200, h: 200, text: 'Left', color: 'yellow' })
  const b = ed.createBlock({ kind: 'sticky', x: 4700, y: 2000, w: 200, h: 200, text: 'Mover', color: 'yellow' })
  ed.zoomToBounds({ x: 4300, y: 1900, w: 800, h: 400 }, { animate: false })
  return { a, b }
})
await wait(250)
const mv = await screenOf(sp.b)
const z = await ed(() => window.editor.camera.z)
await page.mouse.move(mv.x, mv.y)
await page.mouse.down()
await page.mouse.move(mv.x - (300 - 24 - 3) * z * 0.5, mv.y + 2, { steps: 4 })
await page.mouse.move(mv.x - (300 - 200 - 24 - 3) * z, mv.y + 2, { steps: 6 })
await wait(120)
const labels = await page.locator('.ae-spacing-label').allTextContents()
await shot('engine-spacing.png')
await page.mouse.up()
await wait(150)
const gapAfter = await ed(({ a, b }) => window.editor.block(b).x - (window.editor.block(a).x + window.editor.block(a).w), sp)
check('distance labels show while dragging', labels.length > 0, labels.join(','))
check('spacing snaps to the 24px token', gapAfter === 24, `gap ${gapAfter}`)

// minimap navigates
const cam0 = await ed(() => ({ ...window.editor.camera }))
const mm = await page.locator('.ae-minimap').boundingBox()
await page.mouse.click(mm.x + 12, mm.y + 12)
await wait(150)
const cam1 = await ed(() => ({ ...window.editor.camera }))
check('minimap click moves the camera', !!mm && (cam0.x !== cam1.x || cam0.y !== cam1.y))

// export / copy-as-image endpoints (rendered by the core)
const exp = await ed(async ({ board, ids }) => {
  const png = await fetch(`/api/boards/${board}/snapshot.png?ids=${ids.join(',')}`)
  const svg = await fetch(`/api/boards/${board}/snapshot.svg?ids=${ids.join(',')}`)
  const text = await svg.text()
  return { png: png.headers.get('content-type'), size: (await png.arrayBuffer()).byteLength, svg: svg.headers.get('content-type'), hasPath: text.includes('<path') }
}, { board, ids: [obst.a, obst.b, obst.c] })
check('export selection as PNG / SVG', exp.png === 'image/png' && exp.size > 1000 && exp.svg === 'image/svg+xml' && exp.hasPath, `${exp.size} bytes`)
await ed(() => window.editor.zoomToBounds({ x: 3100, y: 1800, w: 900, h: 500 }, { animate: false }))
await wait(200)
await ed((ids) => window.editor.select(ids), [obst.a, obst.b])
const aPt = await screenOf(obst.a)
await page.mouse.click(aPt.x, aPt.y, { button: 'right' })
await wait(200)
await page.getByRole('menuitem', { name: /Export selection/ }).hover()
await wait(200)
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.getByRole('menuitem', { name: 'Export PNG' }).click()])
check('context menu → Export PNG downloads a file', !!download && (download.suggestedFilename() ?? '').endsWith('.png'), download?.suggestedFilename())

// MCP/CLI routing controls
const ca = JSON.parse(cli('--json', '--board', board, 'connect', obst.a, obst.b, '--route', 'straight', '--as', 'Claude Code')).connectors[0]
cli('--board', board, 'route', ca, '--style', 'elbow', '--as', 'Claude Code')
const md = JSON.parse(cli('--json', '--board', board, 'read')).markdown
check('CLI/MCP set connector routing', md.includes(`[elbow] (id: ${ca})`))

// touch: two-finger pinch zooms, one finger on empty canvas pans
const cdp = await page.context().newCDPSession(page)
const zBefore = await ed(() => window.editor.camera.z)
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) })
await touch('touchStart', [[680, 450], [760, 450]])
for (let i = 1; i <= 8; i++) await touch('touchMove', [[680 - i * 15, 450], [760 + i * 15, 450]])
await touch('touchEnd', [])
await wait(150)
const zAfter = await ed(() => window.editor.camera.z)
check('two-finger pinch zooms', zAfter > zBefore * 1.3, `${zBefore.toFixed(2)} → ${zAfter.toFixed(2)}`)
await ed(() => window.editor.setCamera({ x: -5000, y: -5000, z: 1 }))
const xBefore = await ed(() => window.editor.camera.x)
await touch('touchStart', [[300, 300]])
for (let i = 1; i <= 6; i++) await touch('touchMove', [[300 + i * 20, 300]])
await touch('touchEnd', [])
await wait(100)
check('one-finger drag on empty canvas pans', (await ed(() => window.editor.camera.x)) - xBefore > 80)

// level of detail + 2,000-block performance
const many = { blocks: Array.from({ length: 2000 }, (_, i) => ({ text: `Note ${i + 1}`, color: ['yellow', 'blue', 'green', 'pink', 'purple'][i % 5], size: 's' })), layout: 'grid', columns: 50, at: { x: 0, y: 6000 } }
execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), '--human', '--board', board, 'add', '--from-json', '-'], { input: JSON.stringify(many), encoding: 'utf8' })
await wait(1500)
const total = await ed(() => window.editor.blocks().length)
await ed(() => window.editor.zoomToFit(false))
await wait(400)
const lodFar = await page.locator('.ae-canvas').getAttribute('data-lod')
const domFar = await page.locator('.ae-block').count()
await shot('engine-lod-2k.png')
await ed(() => window.editor.setCamera({ x: 200, y: -5900, z: 1 }))
await wait(400)
const lodNear = await page.locator('.ae-canvas').getAttribute('data-lod')
const domNear = await page.locator('.ae-block').count()
check('far zoom switches to the canvas level of detail', lodFar === 'canvas' && domFar <= 2, `${total} blocks, ${domFar} DOM nodes`)
check('near zoom renders only nearby blocks as DOM', lodNear === 'dom' && domNear < 400, `${domNear} DOM blocks`)
const perf = await ed(async () => {
  const ed = window.editor
  const run = (fn, ms) =>
    new Promise((res) => {
      const frames = []
      const t0 = performance.now()
      let last = t0
      const step = (now) => {
        frames.push(now - last)
        last = now
        fn((now - t0) / 1000)
        if (now - t0 < ms) requestAnimationFrame(step)
        else res(frames.slice(2))
      }
      requestAnimationFrame(step)
    })
  const stats = (f) => {
    const s = [...f].sort((a, b) => a - b)
    return { fps: Math.round(1000 / (f.reduce((a, b) => a + b, 0) / f.length)), p95: Math.round(s[Math.floor(s.length * 0.95)] * 10) / 10 }
  }
  const pan = await run((t) => ed.setCamera({ x: 200 - t * 900, y: -5900 - t * 300, z: 1 }), 2500)
  const zoom = await run((t) => {
    const z = 0.08 + 0.17 * (0.5 + 0.5 * Math.sin(t * 2.4))
    ed.zoomAt({ x: ed.viewport.w / 2, y: ed.viewport.h / 2 }, z)
  }, 2500)
  return { pan: stats(pan), zoom: stats(zoom) }
})
check('2k blocks: pan stays at ~60fps', perf.pan.fps >= 55, `${perf.pan.fps} fps, p95 ${perf.pan.p95}ms`)
check('2k blocks: overview zoom stays at ~60fps', perf.zoom.fps >= 55, `${perf.zoom.fps} fps, p95 ${perf.zoom.p95}ms`)

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
cli('--human', 'call', 'delete_board', JSON.stringify({ board }))
console.log(failures ? `\n${failures} check(s) failed` : '\nall engine checks passed')
process.exit(failures ? 1 : 0)
