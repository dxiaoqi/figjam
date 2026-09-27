// Local files and sharing, end to end against an isolated core serving the built canvas:
//   storage   asset files, a 1.0 board migrated on startup, MCP add_video / replace_asset / list_assets,
//             live snippet files (person → applied, agent → change set, syntax error → refused), the storage
//             panel and an inline video in headless Chrome
//   packs     .aifigpack export over MCP / CLI / the canvas (download), import with a folder choice, history
//             and comments, skills; a malicious pack is refused in the import dialog
//   web page  export as a folder, zip and single file (MCP, CLI, canvas); opened from file:// in headless Chrome:
//             every block renders, snippets run with no network, videos play, comments and fields toggle
// usage: node scripts/sharing-e2e.mjs [media-dir] [--skip-build]
//   With a media dir it saves screenshots and short clips there.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright-core'
import { register } from 'tsx/esm/api'
import * as Y from 'yjs'
import { authHeaders, tokenFor } from './lib/core-auth.mjs'
import { makeMedia } from './lib/media-fixtures.mjs'
import { startClip } from './lib/clip.mjs'

register()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const mediaDir = argv.find((a) => !a.startsWith('--')) ? path.resolve(argv.find((a) => !a.startsWith('--'))) : null
if (mediaDir) fs.mkdirSync(mediaDir, { recursive: true })
if (!argv.includes('--skip-build')) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-sharing-'))
const home = path.join(tmp, 'aifig')
const port = 48110 + Math.floor(Math.random() * 40) * 2
const base = `http://127.0.0.1:${port}`
const env = { ...process.env, AIFIG_HOME: home, AIFIG_CORE_PORT: String(port), AIFIG_REVEAL: 'off' }
delete env.AIFIG_TOKEN
const bin = path.join(root, 'bin/aifig.mjs')
const media = makeMedia(path.join(tmp, 'media'))
const HUMAN = { id: 'human:sharing', name: 'You', client: 'test', kind: 'human' }
const AGENT = { id: 'sharing-agent:1', name: 'Share Bot', client: 'sharing', kind: 'agent' }
const call = async (caller, tool, args = {}) => (await fetch(`${base}/api/call`, { method: 'POST', headers: authHeaders(home), body: JSON.stringify({ tool, args, caller }) })).json()
const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' })

// ---- a board from an older build (schema 1.0, image bytes inside) is waiting in the home ----------------
const { encodeContainer } = await import('../packages/core/src/fileformat.ts')
fs.mkdirSync(path.join(home, 'boards'), { recursive: true, mode: 0o700 })
{
  const d = new Y.Doc()
  d.getMap('meta').set('title', 'Board from last year')
  d.getMap('meta').set('schema', '1.0')
  const bytes = fs.readFileSync(media.png)
  d.getMap('assets').set('aold', { id: 'aold', mime: 'image/png', w: 640, h: 400, bytes: new Uint8Array(bytes), name: 'whiteboard.png', createdAt: 1 })
  d.getMap('blocks').set('img', { id: 'img', kind: 'image', x: 0, y: 0, w: 320, h: 200, asset: 'aold', text: '', color: 'gray', size: 'm', createdAt: 1, updatedAt: 1 })
  fs.writeFileSync(path.join(home, 'boards', 'blastyear.aifig'), encodeContainer(Y.encodeStateAsUpdate(d), { savedAt: Date.now() - 86_400_000, board: 'blastyear', title: 'Board from last year', schema: '1.0' }))
}

const core = spawn(process.execPath, [bin, 'core', '--port', String(port)], { env, stdio: 'ignore' })
for (let i = 0; i < 150 && !(await fetch(`${base}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(100)
const health = await (await fetch(`${base}/api/health`, { headers: authHeaders(home) })).json()

// ---- migration on startup ----------------------------------------------------------------------------------
{
  const file = fs.readFileSync(path.join(home, 'boards', 'blastyear.aifig'))
  const header = JSON.parse(file.subarray(10, 10 + file.readUInt32LE(6)).toString('utf8'))
  const info = (await call(HUMAN, 'get_storage', { board: 'blastyear' })).result
  check('a 1.0 board is migrated on startup: schema 2.0, the image is a file next to it', header.schema === '2.0' && header.assets?.length === 1 && info.assets[0]?.status === 'used' && fs.existsSync(info.assets[0].file), `${file.length} bytes, ${info.assets[0]?.file}`)
  const img = await fetch(`${base}/api/assets/blastyear/aold/whiteboard.png?k=${health.assetKey}`)
  check('…and the canvas can load it', img.status === 200 && img.headers.get('content-type') === 'image/png' && (await img.arrayBuffer()).byteLength === fs.statSync(media.png).size)
  const backups = fs.readdirSync(path.join(home, 'backups')).flatMap((d) => fs.readdirSync(path.join(home, 'backups', d)))
  check('…with the original kept in the backups', backups.some((n) => n.includes('before-format-1.0')), backups.join(', '))
}

// ---- MCP: videos, replacing files, listing them --------------------------------------------------------
const board = (await call(HUMAN, 'create_board', { title: 'Launch video review' })).result.board.id
const mcp = new Client({ name: 'claude-code', version: 'sharing' })
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp'], env, stderr: 'ignore' }))
const tools = (await mcp.listTools()).tools.map((t) => t.name)
check('MCP exposes add_video, replace_asset, list_assets, edit_snippet_files', ['add_video', 'replace_asset', 'list_assets', 'edit_snippet_files'].every((t) => tools.includes(t)))
check('storage clean-up and reveal stay human-only', !tools.includes('cleanup_assets') && !tools.includes('reveal_asset') && !tools.includes('get_storage'))
const mcpCall = async (name, args) => {
  const r = await mcp.callTool({ name, arguments: args })
  return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text)
}
const v = await mcpCall('add_video', { board, path: media.mp4, poster: media.png, caption: 'Launch teaser' })
check('MCP add_video places a video from a file path, through review', !!v.id && !!v.changeSet && Math.round(v.duration) === 4 && fs.existsSync(v.file), JSON.stringify({ id: v.id, cs: v.changeSet, d: v.duration }))
const img = await mcpCall('add_image', { board, path: media.png, right_of: v.id })
const same = await mcpCall('add_image', { board, path: media.png, below: v.id })
await call(HUMAN, 'review_change_set', { board, id: 'all', action: 'accept' })
let list = await mcpCall('list_assets', { board })
const png = list.assets.find((a) => a.role === 'image' || a.role === 'poster')
check('the same image added twice (and as a poster) is one file', list.totals.assetFiles === 2 && png.usedBy.length === 3, `${list.totals.assetFiles} files, png used by ${png.usedBy.length}`)
const rep = await mcpCall('replace_asset', { board, block: img.created[0].id, path: media.png2 })
check('MCP replace_asset swaps the file in every block that uses it, as a change set', rep.blocks.length === 3 && !!rep.changeSet, JSON.stringify({ blocks: rep.blocks.length, cs: rep.changeSet }))
await call(HUMAN, 'review_change_set', { board, id: rep.changeSet, action: 'reject', reason: 'keep the first one' })
list = await mcpCall('list_assets', { board })
check('rejecting it puts the old file back everywhere', list.assets.find((a) => a.id === png.id)?.usedBy.length === 3)
const bad = await mcpCall('replace_asset', { board, block: v.id, path: media.png })
check('a video can only be replaced by a video', !!bad.error && /replace it with an MP4 or WebM/.test(bad.error), bad.error)

// ---- live snippet files ----------------------------------------------------------------------------------
const snip = (await call(HUMAN, 'create_snippet', { board, html: '<h1 id=t>Pricing</h1>', css: 'h1{color:#0f766e}', js: "document.getElementById('t').title='ok'", right_of: same.created[0].id })).result
const files = (await call(HUMAN, 'reveal_asset', { board, block: snip.id, open: true })).result
const dir = path.dirname(files.path)
check('“Edit in your editor” writes index.html / style.css / script.js next to the board', ['index.html', 'style.css', 'script.js'].every((f) => fs.existsSync(path.join(dir, f))) && fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes('Pricing') && !/xdg-open .*\.html$/.test(files.command), files.command)
const blockHtml = async () => (await call(HUMAN, 'get_board', { board, format: 'json' })).result.blocks.find((b) => b.id === snip.id)
const waitFor = async (fn, ms = 4000) => {
  for (let i = 0; i < ms / 100; i++) {
    const v = await fn()
    if (v) return v
    await sleep(100)
  }
  return null
}
fs.writeFileSync(path.join(dir, 'index.html'), '<h1 id=t>Pricing, edited in an editor</h1>')
const edited = await waitFor(async () => {
  const b = await blockHtml()
  return b.web.html.includes('edited in an editor') && b
})
check('saving index.html in an editor updates the snippet live, attributed to the editor', !!edited && edited.editedBy?.name === 'External editor' && !edited.pending, edited?.editedBy?.name)
const co = await mcpCall('edit_snippet_files', { board, id: snip.id })
fs.writeFileSync(co.files.css, 'h1{color:#7c3aed}')
const cs = await waitFor(async () => (await call(HUMAN, 'list_change_sets', { board, status: 'pending' })).result.changeSets.find((c) => c.author === 'Claude Code' && /style\.css/.test(c.intent)))
check('an agent that checked the files out gets its saves reviewed as change sets', !!cs, cs?.intent)
fs.writeFileSync(co.files.js, 'document.getElementById(')
await sleep(900)
check('a syntax error in script.js is not applied', !(await blockHtml()).web.js.includes('getElementById(\n') && (await blockHtml()).web.js.includes("title='ok'"))
await call(HUMAN, 'review_change_set', { board, id: cs.id, action: 'reject' })
const back = await waitFor(() => fs.readFileSync(co.files.css, 'utf8').includes('#0f766e'))
check('rejecting the agent’s edit rewrites the file it edited', !!back)
await mcp.close()

// ---- CLI ---------------------------------------------------------------------------------------------------
const cv = cli('--board', board, '--human', 'video', media.webm)
check('aifig video adds a WebM', cv.status === 0 && /added video \w+ \(3 s\)/.test(cv.stdout), cv.stdout.trim() || cv.stderr.trim())
const ca = cli('--board', board, 'assets')
check('aifig assets lists files, users and locations', ca.status === 0 && /files\s+\//.test(ca.stdout) && /video\s+/.test(ca.stdout) && /history /.test(ca.stdout), ca.stdout.split('\n')[0])
const cc = cli('--board', board, 'assets', '--cleanup', '--dry-run')
check('aifig assets --cleanup --dry-run reports without deleting', cc.status === 0 && /would remove/.test(cc.stdout), cc.stdout.trim())

// ---- the canvas: video plays inline, storage panel ---------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/local/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await ctx.addInitScript((t) => {
  try {
    localStorage.setItem('aifig:token', t)
    localStorage.setItem('aifig:welcome', 'done')
  } catch {}
}, tokenFor(home))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await call(HUMAN, 'arrange', { board, ids: (await call(HUMAN, 'get_board', { board, format: 'json' })).result.blocks.map((b) => b.id), layout: 'grid', columns: 3 })
await page.goto(`${base}/?board=${board}`)
await page.waitForSelector('[data-video-block]', { timeout: 15000 })
const stopClip = mediaDir ? await startClip(page, tmp) : null
await page.waitForTimeout(1500)
const imgs = await page.evaluate(() => [...document.querySelectorAll('.aifig-image img')].map((i) => i.naturalWidth))
check('images load from the assets folder', imgs.length >= 2 && imgs.every((w) => w > 0), imgs.join(','))
if (mediaDir) await page.screenshot({ path: path.join(mediaDir, 'canvas-files.png') })
await page.locator('[data-video-play]').first().click()
await page.waitForTimeout(1600)
const playing = await page.evaluate(() => {
  const el = document.querySelector('.aifig-video video')
  return el ? { t: el.currentTime, paused: el.paused, error: el.error?.code ?? null } : null
})
check('a video block plays inline', !!playing && playing.t > 0.3 && !playing.paused && !playing.error, JSON.stringify(playing))
await page.keyboard.press('Escape')
await page.evaluate(() => window.dispatchEvent(new Event('aifig:storage')))
await page.waitForSelector('[data-storage-list] [data-storage-asset]', { timeout: 8000 })
await page.waitForTimeout(600)
const rows = await page.$$eval('[data-storage-asset]', (els) => els.map((e) => ({ role: e.dataset.role, status: e.dataset.status })))
const total = await page.textContent('[data-storage-total]')
check('the storage panel lists every file with its type and total size', rows.length >= 6 && rows.some((r) => r.role === 'video') && rows.some((r) => r.role === 'snippet-html') && /[KM]B/.test(total ?? ''), `${rows.length} rows, ${total}`)
if (mediaDir) await page.screenshot({ path: path.join(mediaDir, 'storage-panel.png') })
await page.click('[data-storage-filter="unused"]')
await page.waitForTimeout(300)
const unusedRows = await page.$$eval('[data-storage-asset]', (els) => els.length)
await page.click('[data-storage-cleanup]')
await page.waitForSelector('[data-cleanup-confirm]')
await page.waitForTimeout(400)
if (mediaDir) await page.screenshot({ path: path.join(mediaDir, 'storage-cleanup.png') })
await page.click('[data-cleanup-run]')
await page.waitForTimeout(1200)
const after = (await call(HUMAN, 'get_storage', { board })).result
check('“Clean up unused” removes what no block uses (history keeps what it needs)', unusedRows > 0 && after.assets.every((a) => a.status !== 'unused'), `${unusedRows} unused before`)
await page.click('[data-storage-filter="all"]')
await page.locator('[data-storage-used-by]').first().click()
await page.waitForTimeout(700)
check('“Used by” selects those blocks on the canvas', (await page.evaluate(() => window.editor?.selection?.size ?? document.querySelectorAll('.ae-block.is-selected').length)) > 0)
await stopClip?.(path.join(mediaDir, 'storage-walkthrough.mp4'))

// ---- share packs -------------------------------------------------------------------------------------------
await call(HUMAN, 'add_comment', { board, target: v.id, text: 'Can we trim the first second?' })
await call(HUMAN, 'enable_skill', { board, name: 'prototype-kit' })
await call(HUMAN, 'create_version', { board, name: 'Before sharing' })
const packOut = path.join(tmp, 'out', 'Launch video review.aifigpack')
fs.mkdirSync(path.dirname(packOut), { recursive: true })
const mcp2 = new Client({ name: 'claude-code', version: 'sharing' })
await mcp2.connect(new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp'], env, stderr: 'ignore' }))
const ex = JSON.parse((await mcp2.callTool({ name: 'export_pack', arguments: { board, path: packOut, include_history: true } })).content[0].text)
check('MCP export_pack writes a pack with files, history, comments and skills', fs.existsSync(packOut) && ex.includes.history && ex.includes.comments && ex.includes.skills.includes('prototype-kit') && ex.files > 6, JSON.stringify(ex.includes))
const exAgain = await mcp2.callTool({ name: 'export_pack', arguments: { board, path: packOut } })
check('…and never overwrites an existing file unless asked', exAgain.isError && /already exists/.test(exAgain.content[0].text))
const packBytes = fs.readFileSync(packOut)
check('the pack holds no access token and no grants file', !packBytes.includes(Buffer.from(tokenFor(home))) && !packBytes.includes(Buffer.from('permissions.json')))
await mcp2.close()
const un = cli('unpack', packOut, '--to', path.join(tmp, 'Shared'))
check('aifig unpack checks the pack and opens the board in the chosen folder', un.status === 0 && fs.existsSync(path.join(tmp, 'Shared', 'Launch video review.aifig')) && fs.existsSync(path.join(tmp, 'Shared', 'Launch video review.assets')) && /1 comment threads/.test(un.stdout), un.stdout.trim() || un.stderr.trim())
const cp = cli('--board', board, 'pack', '-o', path.join(tmp, 'out', 'cli.aifigpack'), '--no-comments')
check('aifig pack --no-comments', cp.status === 0 && /no comments/.test(cp.stdout), cp.stdout.trim() || cp.stderr.trim())

// the canvas: export (download) and import (upload → preview → folder → open)
await page.keyboard.press('Escape')
const dlWait = page.waitForEvent('download', { timeout: 15000 })
await page.click('[data-menu-export-pack]', { timeout: 1000 }).catch(async () => {
  await page.evaluate(() => window.dispatchEvent(new Event('aifig:export-pack')))
})
await page.waitForSelector('[data-export-pack]')
await page.waitForTimeout(500)
if (mediaDir) await page.screenshot({ path: path.join(mediaDir, 'pack-export.png') })
await page.click('[data-pack-export]')
const dl = await dlWait
fs.mkdirSync(path.join(tmp, 'downloads'), { recursive: true })
const dlPath = path.join(tmp, 'downloads', await dl.suggestedFilename())
await dl.saveAs(dlPath)
check('“Share as pack” downloads a .aifigpack in the browser', dlPath.endsWith('.aifigpack') && fs.statSync(dlPath).size > 10_000, `${path.basename(dlPath)} ${fs.statSync(dlPath).size} bytes`)
const stopPackClip = mediaDir ? await startClip(page, tmp) : null
await page.evaluate(() => window.dispatchEvent(new CustomEvent('aifig:import-pack', { detail: {} })))
await page.waitForSelector('[data-import-pack]')
await page.setInputFiles('[data-pack-input]', packOut)
await page.waitForSelector('[data-pack-preview]', { timeout: 15000 })
const dest = path.join(tmp, 'Imported')
await page.fill('[data-pack-dest]', dest)
await page.waitForTimeout(700)
if (mediaDir) await page.screenshot({ path: path.join(mediaDir, 'pack-import.png') })
await page.click('[data-pack-import]')
await page.waitForSelector('[data-import-pack]', { state: 'detached', timeout: 15000 })
await page.waitForTimeout(1800)
const opened = await page.evaluate(() => new URL(location.href).searchParams.get('board'))
const importedInfo = (await call(HUMAN, 'get_storage', { board: opened })).result
check('importing in the canvas saves the board where chosen and switches to it', importedInfo.board.externalPath === path.join(dest, 'Launch video review.aifig') && importedInfo.assets.length >= 5, importedInfo.board.externalPath)
const importedThreads = (await call(HUMAN, 'get_threads', { board: opened })).result.threads.length
check('…with its history and comments', importedInfo.history.versions >= 1 && importedThreads === 1, `${importedInfo.history.versions} versions, ${importedThreads} threads`)
await page.waitForSelector('[data-video-block]', { timeout: 10000 })
await page.waitForTimeout(800)
if (mediaDir) await page.screenshot({ path: path.join(mediaDir, 'pack-imported-board.png') })
await stopPackClip?.(path.join(mediaDir, 'pack-import.mp4'))

// a malicious pack (zip-slip) is refused in the dialog, nothing is written
{
  const { zipEntries } = await import('../packages/core/src/zip.ts')
  const evil = path.join(tmp, 'out', 'evil.aifigpack')
  fs.writeFileSync(evil, zipEntries([{ name: 'manifest.json', data: Buffer.from('{"format":"aifigpack","version":1,"files":[]}') }, { name: '../../escape.txt', data: Buffer.from('pwned') }]))
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aifig:import-pack', { detail: {} })))
  await page.setInputFiles('[data-pack-input]', evil)
  await page.waitForSelector('[data-pack-error]', { timeout: 10000 })
  const msg = await page.textContent('[data-pack-error]')
  check('a malicious pack is refused in the import dialog', /Unsafe path/.test(msg ?? '') && !fs.existsSync(path.join(tmp, 'escape.txt')), msg?.slice(0, 90))
  if (mediaDir) await page.screenshot({ path: path.join(mediaDir, 'pack-refused.png') })
  await page.keyboard.press('Escape')
}

// ---- web page export ------------------------------------------------------------------------------------------
const web = (await call(HUMAN, 'create_board', { title: 'Pricing experiment' })).result.board.id
const made = (await call(HUMAN, 'create_blocks', { board: web, frame: 'Hypotheses', layout: 'row', blocks: [
  { text: 'Annual plans lift conversion', type: 'hypothesis', fields: { status: 'supported', confidence: 'high' } },
  { text: 'Seat pricing confuses teams under 5', type: 'hypothesis', fields: { status: 'unverified' } },
  { kind: 'card', title: 'Decision', text: 'Ship **annual** by default; keep monthly one click away.' },
] })).result
const [h1, h2, card] = made.created.filter((c) => c.kind !== 'frame').map((c) => c.id)
await call(HUMAN, 'connect', { board: web, connectors: [{ from: h1, to: card, label: 'informs' }, { from: h2, to: card }] })
const calc = (await call(HUMAN, 'create_snippet', { board: web, below: card, title: 'Seat calculator',
  html: '<main><h1>Seats</h1><button id=b>Seats: 1</button><p id=net>checking network…</p></main>',
  css: 'main{padding:16px;font:15px system-ui}button{font:inherit;padding:6px 12px}',
  js: "let n=1;const b=document.getElementById('b');b.onclick=()=>{n++;b.textContent='Seats: '+n;aifig.setState({n})};fetch('https://example.com/ping').then(()=>net.textContent='network: open',()=>net.textContent='network: blocked');const i=new Image();i.onerror=()=>document.body.dataset.img='blocked';i.src='https://example.com/p.png'" })).result
await call(HUMAN, 'add_video', { board: web, path: media.mp4, poster: media.png, right_of: calc.id, caption: 'Checkout walkthrough' })
await call(HUMAN, 'add_image', { board: web, path: media.png, below: calc.id, caption: 'Whiteboard' })
const embed = (await call(HUMAN, 'create_snippet', { board: web, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', below: card })).result
await call(HUMAN, 'add_comment', { board: web, target: card, text: 'Legal wants the monthly price visible too.' })
await call(HUMAN, 'tidy', { board: web })
const webOut = path.join(tmp, 'web', 'Pricing experiment')
const wx = cli('--board', web, 'export-web', '-o', webOut)
check('aifig export-web writes index.html, the viewer, board.js, files, snippet documents and PUBLISHING.md', wx.status === 0 && ['index.html', 'viewer.js', 'viewer.css', 'board.js', 'PUBLISHING.md', `snippets/${calc.id}.html`].every((f) => fs.existsSync(path.join(webOut, f))) && fs.readdirSync(path.join(webOut, 'assets')).length >= 2, wx.stdout.trim() || wx.stderr.trim())
const boardJs = fs.readFileSync(path.join(webOut, 'board.js'), 'utf8')
check('the page carries no token, no grants and no core code', !boardJs.includes(tokenFor(home)) && !/"grants"/.test(boardJs) && !fs.readFileSync(path.join(webOut, 'viewer.js'), 'utf8').includes('writeFileAtomic'))
const snippetDoc = fs.readFileSync(path.join(webOut, 'snippets', `${calc.id}.html`), 'utf8')
check('each snippet document starts with a CSP that blocks all network', /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*connect-src 'none'/.test(snippetDoc))

const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const net = []
const blockedByCsp = []
wctx.on('request', (r) => !/^(file|data|blob|about):/.test(r.url()) && net.push(r.url()))
// a request the CSP refuses is reported, then fails in the browser before any connection is made
wctx.on('requestfailed', (r) => {
  if (/csp/i.test(r.failure()?.errorText ?? '')) {
    blockedByCsp.push(r.url())
    net.splice(net.indexOf(r.url()), 1)
  }
})
const wp = await wctx.newPage()
const werrors = []
wp.on('pageerror', (e) => werrors.push(e.message))
const stopWebClip = mediaDir ? await startClip(wp, tmp) : null
await wp.goto(`file://${path.join(webOut, 'index.html')}`)
await wp.waitForSelector('[data-viewer] .ae-block', { timeout: 15000 })
await wp.waitForTimeout(2200)
const rendered = await wp.evaluate(() => ({ dataConnectors: window.__AIFIG_BOARD__.connectors.length, paths: document.querySelectorAll('.ae-connectors path').length, blocks: document.querySelectorAll('.ae-block').length, kinds: [...new Set([...document.querySelectorAll('.ae-block')].map((b) => [...b.classList].find((c) => c.startsWith('ae-kind-'))))],  title: document.querySelector('[data-viewer-title]')?.textContent, images: [...document.querySelectorAll('.aifig-image img')].map((i) => i.naturalWidth) }))
check('from file://, every block renders (frame, typed stickies, card, snippet, video, image, embed) with connectors', ['ae-kind-frame', 'ae-kind-sticky', 'ae-kind-card', 'ae-kind-web', 'ae-kind-video', 'ae-kind-image'].every((k) => rendered.kinds.includes(k)) && rendered.dataConnectors >= 2 && rendered.paths >= rendered.dataConnectors && rendered.title === 'Pricing experiment', JSON.stringify(rendered))
check('images load', rendered.images.length >= 1 && rendered.images.every((w) => w > 0), rendered.images.join(','))
const frame = wp.frames().find((f) => f.url().endsWith(`snippets/${calc.id}.html`))
await frame?.waitForFunction(() => document.getElementById('net')?.textContent !== 'checking network…', null, { timeout: 5000 }).catch(() => {})
const netText = await frame?.evaluate(() => ({ net: document.getElementById('net')?.textContent, img: document.body.dataset.img }))
check('inline snippets run, and their network requests are blocked', netText?.net === 'network: blocked' && netText?.img === 'blocked', JSON.stringify(netText))
await wp.evaluate((id) => {
  const r = window.editor.pageRect(id)
  window.editor.zoomToBounds({ x: r.x - 40, y: r.y - 40, w: r.w + 80, h: r.h + 80 }, { maxZoom: 1, animate: false })
}, calc.id)
await wp.waitForTimeout(300)
await wp.click(`[data-viewer-snippet="${calc.id}"] [data-snippet-activate]`)
await frame.click('#b')
await frame.click('#b')
check('clicking a snippet lets the reader use it', (await frame.textContent('#b')) === 'Seats: 3')
await wp.keyboard.press('Escape')
const camBefore = await wp.evaluate(() => ({ ...window.editor.camera }))
await wp.mouse.move(720, 450)
await wp.mouse.wheel(0, 300)
await wp.waitForTimeout(200)
const camPanned = await wp.evaluate(() => ({ ...window.editor.camera }))
await wp.mouse.move(200, 700)
await wp.mouse.down()
await wp.mouse.move(420, 600, { steps: 6 })
await wp.mouse.up()
const camDragged = await wp.evaluate(() => ({ ...window.editor.camera }))
const zoomBefore = await wp.textContent('[data-viewer-zoom]')
await wp.keyboard.press('Minus')
await wp.waitForTimeout(350)
check('pan (wheel, also over a snippet; drag) and zoom work', !(await wp.locator('.aifig-web.is-running').count()) && camPanned.y !== camBefore.y && camDragged.x !== camPanned.x && (await wp.textContent('[data-viewer-zoom]')) !== zoomBefore, `${JSON.stringify([camBefore, camPanned, camDragged])} ${zoomBefore} → ${await wp.textContent('[data-viewer-zoom]')}`)
await wp.evaluate(() => window.editor.zoomToFit(false))
await wp.waitForTimeout(300)
await wp.click('[data-video-block] [data-video-play]')
await wp.waitForTimeout(1500)
const vid = await wp.evaluate(() => { const v = document.querySelector('[data-video-block] video'); return v && { t: v.currentTime, paused: v.paused, error: v.error?.code ?? null } })
check('videos play', !!vid && vid.t > 0.3 && !vid.paused && !vid.error, JSON.stringify(vid))
const pins = await wp.locator('[data-viewer-pin]').count()
await wp.locator('[data-viewer-pin]').first().click()
await wp.waitForSelector('[data-viewer-thread]')
const threadText = await wp.textContent('[data-viewer-thread]')
if (mediaDir) await wp.screenshot({ path: path.join(mediaDir, 'web-page.png') })
await wp.click('[data-toggle-comments]')
const pinsOff = await wp.locator('[data-viewer-pin]').count()
check('comments are viewable and toggleable', pins === 1 && /Legal wants/.test(threadText ?? '') && pinsOff === 0, `${pins} → ${pinsOff}`)
const fieldsOn = await wp.locator('[data-viewer-fields]').count()
await wp.click('[data-toggle-fields]')
const fieldsOff = await wp.locator('[data-viewer-fields]').count()
check('typed fields are viewable and toggleable', fieldsOn >= 2 && fieldsOff === 0, `${fieldsOn} → ${fieldsOff}`)
await wp.click('[data-toggle-fields]')
await wp.click('[data-toggle-comments]')
await wp.click('[data-toggle-theme]')
await wp.waitForTimeout(400)
if (mediaDir) await wp.screenshot({ path: path.join(mediaDir, 'web-page-dark.png') })
check('no network at all until a URL embed is clicked (the snippet’s tries are refused by its CSP)', net.length === 0 && blockedByCsp.some((u) => u.includes('example.com')), `${net.join(', ')} | blocked: ${blockedByCsp.join(', ')}`)
await wp.click('[data-embed-load]')
const embedFrame = await wp.waitForSelector(`iframe[src="${embed.embedUrl}"]`, { timeout: 5000 }).catch(() => null)
check('URL embeds are kept and load when clicked (sandboxed, no top navigation)', !!embedFrame && !/allow-top-navigation/.test((await embedFrame.getAttribute('sandbox')) ?? ''))
await stopWebClip?.(path.join(mediaDir, 'web-page.mp4'))
check('no errors on the page', !werrors.length, werrors.join(' | '))

// single file and zip
await wp.close()
const single = JSON.parse(cli('--json', '--board', web, 'export-web', '--single', '-o', path.join(tmp, 'web', 'pricing.html')).stdout)
const sp = await wctx.newPage()
net.length = 0
await sp.goto(`file://${single.path}`)
await sp.waitForSelector('[data-viewer] .ae-block', { timeout: 15000 })
await sp.waitForTimeout(1500)
let sNet
for (const f of sp.frames()) if (f !== sp.mainFrame()) sNet ??= await f.evaluate(() => document.getElementById('net')?.textContent).catch(() => undefined)
check('the single-file page is self-contained: snippets run (srcdoc), images inline, no network', single.files === 1 && sNet === 'network: blocked' && (await sp.evaluate(() => [...document.querySelectorAll('.aifig-image img')].every((i) => i.naturalWidth > 0 && i.src.startsWith('data:')))) && net.length === 0, `${sNet}, ${net.join(',')}`)
const { readZipIndex } = await import('../packages/core/src/unzip.ts')
const zipped = JSON.parse(cli('--json', '--board', web, 'export-web', '--zip', '-o', path.join(tmp, 'web', 'pricing.zip')).stdout)
const zfd = fs.openSync(zipped.path, 'r')
const znames = readZipIndex(zfd, { maxEntries: 1000, maxTotal: 2 ** 31, maxEntry: () => 2 ** 30, maxRatio: 1000 }).map((i) => i.name)
fs.closeSync(zfd)
check('the zip unpacks to one folder with index.html', znames.includes('Pricing experiment/index.html') && znames.some((n) => n.startsWith('Pricing experiment/assets/')), znames.slice(0, 4).join(', '))
const mcpWeb = new Client({ name: 'cursor', version: 'sharing' })
await mcpWeb.connect(new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp'], env, stderr: 'ignore' }))
const mw = JSON.parse((await mcpWeb.callTool({ name: 'export_web', arguments: { board: web, path: path.join(tmp, 'web', 'from-mcp'), mode: 'folder' } })).content[0].text)
check('MCP export_web works for agents', fs.existsSync(mw.open) && /static host/.test(mw.publish))
await mcpWeb.close()

// the export dialog in the canvas (browser: zip / single file download)
await page.goto(`${base}/?board=${web}`)
await page.waitForSelector('.ae-block', { timeout: 15000 })
await page.evaluate(() => window.dispatchEvent(new Event('aifig:export-web')))
await page.waitForSelector('[data-web-export] [data-web-mode="zip"]')
await page.waitForTimeout(600)
if (mediaDir) await page.screenshot({ path: path.join(mediaDir, 'web-export-dialog.png') })
const wdl = page.waitForEvent('download', { timeout: 20000 })
await page.click('[data-web-export-run]')
const wfile = path.join(tmp, 'downloads', await (await wdl).suggestedFilename())
await (await wdl).saveAs(wfile)
check('“Export as web page” downloads a zip in the browser', wfile.endsWith('.zip') && fs.statSync(wfile).size > 100_000, path.basename(wfile))
await wctx.close()

check('no page errors', !errors.length, errors.join(' | '))
await ctx.close()
await browser.close()

core.kill('SIGTERM')
await sleep(300)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} sharing check(s) failed` : '\nall sharing checks passed')
process.exit(failures ? 1 : 0)
