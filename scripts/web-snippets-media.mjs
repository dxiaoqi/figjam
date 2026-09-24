// Media for web snippet blocks v1: previews, interactive mode, sandbox escape attempts, watchdog, review diff, export.
// usage: node scripts/web-snippets-media.mjs <out-dir>   (expects `npm run dev`)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'web-snippets')
fs.mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:47820'
const cli = (...args) => execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const board = JSON.parse(cli('--json', 'new-board', 'Pricing experiment — prototypes')).board.id
const call = (who, tool, args) => JSON.parse(cli('--json', '--board', board, ...who, 'call', tool, JSON.stringify({ board, ...args })))

// an agent writes an interactive pricing calculator; a person embeds a video
const calc = {
  title: 'Seat pricing calculator',
  html: `<main><h1>Team plan</h1><label>Seats <output id="o">8</output></label><input id="s" type="range" min="1" max="50" value="8"><p class="price"><span id="p">$96</span> / month</p><div id="bars"></div><button id="save">Save as scenario</button><small id="saved"></small></main>`,
  css: `body{background:linear-gradient(160deg,#eef2ff,#fdf4ff);display:grid;place-items:center}main{width:320px;font-family:Inter,system-ui}h1{font-size:18px;margin:0 0 10px;color:#312e81}label{display:flex;justify-content:space-between;font-size:13px;color:#4338ca}input{width:100%;accent-color:#6366f1}.price{font-size:28px;font-weight:700;color:#1e1b4b;margin:8px 0}.price span{letter-spacing:-.02em}#bars{display:flex;gap:3px;height:36px;align-items:flex-end;margin-bottom:10px}#bars i{flex:1;background:#a5b4fc;border-radius:3px}button{font:600 13px system-ui;padding:8px 12px;border:0;border-radius:8px;background:#4f46e5;color:#fff}small{margin-left:8px;color:#6b7280}`,
  js: `const s=document.getElementById('s'),o=document.getElementById('o'),p=document.getElementById('p'),bars=document.getElementById('bars'),saved=document.getElementById('saved')
const price=(n)=>n*12-Math.max(0,n-10)*2
const paint=()=>{const n=+s.value;o.textContent=n;p.textContent='$'+price(n);bars.innerHTML='';for(let i=1;i<=12;i++){const b=document.createElement('i');b.style.height=Math.round(price(i*4)/price(48)*100)+'%';if(i*4<=n)b.style.background='#6366f1';bars.appendChild(b)}}
s.oninput=paint
aifig.getState().then((st)=>{if(st&&st.seats){s.value=st.seats;saved.textContent='saved: '+st.seats+' seats'}paint()})
document.getElementById('save').onclick=async()=>{await aifig.setState({seats:+s.value});saved.textContent='saved: '+s.value+' seats'}`,
}
call(['--human'], 'create_blocks', { at: { x: 0, y: 0 }, layout: 'row', blocks: [{ text: 'Price per seat drops after 10 seats — does it feel fair?', type: 'question' }, { text: 'Teams compare against FigJam before buying', type: 'insight' }] })
const snip = call(['--as', 'Claude Code'], 'create_snippet', { ...calc, at: { x: 0, y: 260 }, width: 480, height: 320 }).id
cli('--board', board, '--human', 'accept')
const yt = call(['--human'], 'create_snippet', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Pricing page walkthrough', at: { x: 540, y: 260 } }).id
const escape = call(['--human'], 'create_snippet', { title: 'Sandbox probe', html: '<pre id=o style="font:12px/1.5 ui-monospace;padding:12px;white-space:pre-wrap">probing…</pre>', js: fs.readFileSync(path.join(root, 'tests/fixtures/snippets/escape.js'), 'utf8').replace("document.body.textContent = JSON.stringify(r)", "document.getElementById('o').textContent = Object.entries(r).map(([k, v]) => (v === 'blocked' || v === 'denied' ? '✓ ' : '✗ ') + k.padEnd(16) + v).join('\\n')"), at: { x: 0, y: 640 }, width: 480, height: 400 }).id
const loop = call(['--human'], 'create_snippet', { title: 'Runaway loop', html: '<p style="padding:16px;font-family:system-ui">About to spin forever…</p>', js: 'setTimeout(() => { for (;;) {} }, 1200)', at: { x: 540, y: 640 }, width: 480, height: 300 }).id

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const ed = (fn, arg) => page.evaluate(fn, arg)
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) })
  console.log(`· ${name}`)
}
const focus = async (ids, pad = 120) => {
  await ed(([ids, pad]) => { const rs = ids.map((i) => window.editor.pageRect(i)); const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)), X = Math.max(...rs.map((r) => r.x + r.w)), Y = Math.max(...rs.map((r) => r.y + r.h)); window.editor.zoomToBounds({ x: x - pad, y: y - pad, w: X - x + pad * 2, h: Y - y + pad * 2 }, { animate: false, maxZoom: 1.2 }) }, [ids, pad])
  await sleep(600)
}
const centerOf = (id) => ed((i) => { const r = window.editor.pageRect(i); return window.editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }) }, id)
await page.goto(`${base}/?board=${board}`)
await sleep(2500)
await focus([snip, yt])
await page.waitForFunction((i) => !!window.editor.block(i)?.web?.thumb, snip, { timeout: 10000 }).catch(() => {})
await sleep(800)
await shot('01-previews-not-running.png')

// run the calculator
let c = await centerOf(snip)
await page.mouse.dblclick(c.x, c.y)
await sleep(1500)
const f = page.frameLocator('[data-web-frame]')
const slider = f.locator('#s')
const box = await slider.boundingBox()
if (box) {
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height / 2, { steps: 18 })
  await page.mouse.up()
}
await sleep(300)
await f.locator('#save').click()
await sleep(700)
await shot('02-running-interactive.png')
await f.locator('body').press('Escape')
await sleep(2500)

// sandbox probe
await focus([escape], 80)
c = await centerOf(escape)
await page.mouse.dblclick(c.x, c.y)
await page.waitForFunction((i) => !!window.editor.block(i)?.web?.state?.fetchCore, escape, { timeout: 12000 }).catch(() => {})
await sleep(800)
await shot('03-sandbox-escape-attempts-blocked.png')
await page.keyboard.press('Escape')
await ed(() => window.editor.stopEditing())
await sleep(500)

// watchdog
await focus([loop], 80)
c = await centerOf(loop)
await page.mouse.dblclick(c.x, c.y)
await page.waitForSelector(`[data-block-id="${loop}"] [data-web-stopped]`, { timeout: 12000 }).catch(() => {})
await sleep(600)
await shot('04-watchdog-stopped-runaway-loop.png')

// agent edits the snippet → review with a source diff
call(['--as', 'Claude Code'], 'update_snippet', { id: snip, js: calc.js.replace('n*12-Math.max(0,n-10)*2', 'n*12-Math.max(0,n-10)*3'), intent: 'Steeper volume discount' })
await focus([snip, yt])
await sleep(500)
await page.keyboard.press('j')
await sleep(900)
await shot('05-review-source-diff.png')
await page.keyboard.press('Escape')
cli('--board', board, '--human', 'accept')
await sleep(2500)
await focus([snip, yt, escape, loop], 80)
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(900)
await shot('06-board-dark.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(400)

const png = await fetch(`http://127.0.0.1:47821/api/boards/${board}/snapshot.png`).then((r) => r.arrayBuffer())
fs.writeFileSync(path.join(out, '07-export-snapshot.png'), Buffer.from(png))
fs.writeFileSync(path.join(out, 'export.md'), cli('--board', board, 'export', '--format', 'md'))
const video = await page.video().path()
await context.close()
await browser.close()
fs.renameSync(video, path.join(out, 'web-snippets.webm'))
console.log(`board ${board}`)
