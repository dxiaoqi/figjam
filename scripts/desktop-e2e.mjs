// Desktop (Electron) checks: window, menus, OS dark mode, files, recents, and the bundled MCP launch config.
// usage: node scripts/desktop-e2e.mjs   (builds the canvas first; uses an isolated core + profile)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { _electron as electron } from 'playwright-core'
import { authHeaders } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shotDir = process.argv[2]
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-desktop-'))
const port = String(47871 + Math.floor(Math.random() * 50))
const env = { ...process.env, AIFIG_HOME: path.join(tmp, 'home'), AIFIG_CORE_PORT: port, AIFIG_DESKTOP_KEYCHAIN: 'mock', DISPLAY: process.env.DISPLAY ?? ':1' }
delete env.AIFIG_TOKEN
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const call = async (tool, args) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/call`, { method: 'POST', headers: authHeaders(env.AIFIG_HOME), body: JSON.stringify({ tool, args, caller: { id: 't', name: 'Test', client: 'test', kind: 'human' } }) })
  return (await r.json()).result
}

const launch = (extra = {}) =>
  electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron'),
    args: [path.join(root, 'apps/desktop'), '--no-sandbox', `--user-data-dir=${path.join(tmp, 'profile')}`],
    env: { ...env, ...extra },
  })
let app = await launch()
const win = await app.firstWindow()
await win.waitForSelector('.ae-canvas', { timeout: 30000 })
await win.waitForTimeout(800)
check('desktop window opens the canvas', (await win.title()).includes('ai-figma'), await win.title())
const menus = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label))
check('native menus', ['File', 'Edit', 'View'].every((m) => menus.includes(m)), menus.join(', '))
check('preload bridge is available', await win.evaluate(() => !!window.aifigDesktop))
const fileToken = fs.readFileSync(path.join(env.AIFIG_HOME, 'access-token'), 'utf8').trim()
check('the desktop app gets the access token from the shell (no link needed)', (await win.evaluate(() => window.aifigDesktop.token)) === fileToken && !win.url().includes('token='))
const mainPrefs = await app.evaluate(({ BrowserWindow }) => {
  const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, webviewTag: p.webviewTag }
})
check('the app window is sandboxed and context-isolated', mainPrefs.sandbox === true && mainPrefs.contextIsolation === true && !mainPrefs.nodeIntegration, JSON.stringify(mainPrefs))
const commentModeOn = () => win.evaluate(() => document.documentElement.hasAttribute('data-comment-mode'))
const clickCommentMode = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'View').submenu.items.find((i) => i.label === 'Comment Mode').click())
await clickCommentMode()
await win.waitForTimeout(300)
const commentOn = await commentModeOn()
await clickCommentMode()
await win.waitForTimeout(300)
check('View ▸ Comment Mode toggles comment mode', commentOn && !(await commentModeOn()))

// OS appearance
await app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = 'dark'))
await win.waitForTimeout(400)
const dark = await win.evaluate(() => document.documentElement.classList.contains('dark'))
if (shotDir) await win.screenshot({ path: path.join(shotDir, 'desktop-dark.png') })
await app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = 'light'))
await win.waitForTimeout(400)
const light = await win.evaluate(() => !document.documentElement.classList.contains('dark'))
check('follows the OS light / dark appearance', dark && light)

// File ▸ New Board (native menu → renderer)
const before = (await call('list_boards', {})).boards.length
await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'New Board').click())
await win.waitForTimeout(1000)
check('File ▸ New Board creates and opens a board', (await call('list_boards', {})).boards.length === before + 1 && (await win.title()).startsWith('Untitled board'))

// open a .aifig file (as if double-clicked in the OS) and Save As
const src = (await call('list_boards', {})).boards[0]
const file = path.join(tmp, 'Research notes.aifig')
fs.copyFileSync(path.join(env.AIFIG_HOME, 'boards', `${src.id}.aifig`), file)
await app.evaluate(({ app }, f) => app.emit('open-file', { preventDefault() {} }, f), file)
await win.waitForTimeout(1200)
const opened = (await call('list_boards', {})).boards.find((b) => b.path === file)
const recent = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'Open Recent').submenu.items.map((i) => i.sublabel ?? i.label))
check('opening a .aifig file adds it to Open Recent and shows it', !!opened && recent.includes(file) && (await win.evaluate(() => new URL(location.href).searchParams.get('board'))) === opened.id)
const saved = path.join(tmp, 'Copy.aifig')
await call('save_file', { board: opened.id, path: saved })
await call('create_blocks', { board: saved ? opened.id : '', blocks: [{ text: 'Mirrored to the file' }] })
await new Promise((r) => setTimeout(r, 600))
check('Save As writes the board and keeps the file in sync', fs.existsSync(saved) && fs.statSync(saved).size > 100)

// the Connect dialog's MCP config launches the bundled CLI with Electron's Node
const health = await (await fetch(`http://127.0.0.1:${port}/api/health`, { headers: authHeaders(env.AIFIG_HOME) })).json()
check('Connect dialog points at the bundled CLI / MCP', health.mcp.command.includes('electron') && health.mcp.env?.ELECTRON_RUN_AS_NODE === '1', `${health.mcp.command} ${health.mcp.args.join(' ')}`)
const mcp = new Client({ name: 'desktop-check', version: '1' })
await mcp.connect(new StdioClientTransport({ command: health.mcp.command, args: health.mcp.args, env: { ...process.env, ...health.mcp.env, AIFIG_CORE_PORT: port, AIFIG_HOME: env.AIFIG_HOME } }))
const tools = (await mcp.listTools()).tools.length
await mcp.close()
check('an agent can connect with that exact config', tools > 15, `${tools} tools`)
// web snippets run in <webview>s with a partition per snippet, from this core's own snippet host
const coreHealth = await (await fetch(`http://127.0.0.1:${port}/api/health`, { headers: authHeaders(env.AIFIG_HOME) })).json()
const webviews = () =>
  app.evaluate(({ webContents, session }) =>
    webContents
      .getAllWebContents()
      .filter((w) => w.getType() === 'webview')
      .map((w) => {
        const p = w.getLastWebPreferences()
        return { id: w.id, url: w.getURL(), sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sessionIsSnippet: webContents.getAllWebContents().every((o) => o === w || o.session !== w.session) }
      }),
  )
const runSnippet = async (id) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'zoom-fit'))
  await win.evaluate((i) => { if (!window.editor) return; const r = window.editor.pageRect(i); window.editor.zoomToBounds({ x: r.x - 300, y: r.y - 200, w: r.w + 600, h: r.h + 400 }, { animate: false }) }, id)
  await win.waitForTimeout(500)
  const box = await win.locator(`[data-block-id="${id}"]`).boundingBox()
  if (box) await win.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 40; i++) {
    const w = (await webviews()).find((v) => v.url.includes(`/${id}?`))
    if (w) return w
    await win.waitForTimeout(150)
  }
  return null
}
const inWebview = (wcId, js) => app.evaluate(({ webContents }, [i, code]) => webContents.fromId(i)?.executeJavaScript(code, true), [wcId, js])
const stateOf = async (id) => (await call('get_board', { format: 'json' }))?.blocks?.find((b) => b.id === id)?.web?.state

const snipId = (await call('create_snippet', { title: 'Desktop snippet', html: '<button id="b" style="font-size:20px;padding:20px">go</button>', js: "document.getElementById('b').onclick = () => aifig.setState({ clicked: true })" }))?.id
const wv = await runSnippet(snipId)
const tag = await win.evaluate(() => document.querySelector('[data-web-frame]')?.tagName)
check('snippets run in a <webview>, not an iframe', tag === 'WEBVIEW', tag)
check('the webview is sandboxed and context-isolated, without Node', !!wv && wv.sandbox === true && wv.contextIsolation === true && !wv.nodeIntegration, JSON.stringify(wv))
check('each snippet has its own session (partition)', !!wv?.sessionIsSnippet)
if (wv) await inWebview(wv.id, "document.getElementById('b').click()")
await win.waitForTimeout(700)
check('the state bridge works over the webview preload (own snippet host)', coreHealth.snippetOrigin === `http://localhost:${Number(port) + 1}` && (await stateOf(snipId))?.clicked === true, JSON.stringify({ origin: coreHealth.snippetOrigin, state: await stateOf(snipId) }))
if (wv) await inWebview(wv.id, "location.href = 'https://example.com/?leak=1'").catch(() => {})
await win.waitForTimeout(800)
const afterNav = (await webviews()).find((v) => v.id === wv?.id)
check('an inline snippet cannot navigate its webview away', !afterNav || afterNav.url.startsWith(`http://localhost:${Number(port) + 1}/inline/`), afterNav?.url)
await win.keyboard.press('Escape')
await win.waitForTimeout(400)

// the browser escape tests, inside Electron
const evil = (await call('create_snippet', { title: 'Escape attempts', html: '<p>probing…</p>', js: fs.readFileSync(path.join(root, 'tests/fixtures/snippets/escape.js'), 'utf8') }))?.id
const ew = await runSnippet(evil)
let esc = {}
for (let i = 0; i < 60 && !esc.fetchCore; i++) {
  await win.waitForTimeout(200)
  esc = (await stateOf(evil)) ?? {}
}
const blockedKeys = ['parentDocument', 'parentStorage', 'parentEditor', 'ownStorage', 'cookie', 'popup', 'fetchCore', 'fetchInternet', 'fetchLan', 'xhr', 'websocket', 'image', 'externalScript', 'nestedFrame', 'oversizeState', 'node', 'desktopBridge', 'token']
check('Electron sandbox: every escape attempt is blocked (storage, network, popups, Node, desktop bridge, token)', blockedKeys.every((k) => esc[k] === 'blocked') && esc.neighbors === 'denied' && esc.network === 'denied', JSON.stringify(esc))
check('Electron sandbox: the app window was not navigated', win.url().startsWith(`http://127.0.0.1:${port}/`), win.url())
const partitions = (await webviews()).map((v) => v.id)
check('two snippets never share a webview', !!ew && !!wv && ew.id !== wv.id && partitions.length >= 1)
await win.keyboard.press('Escape')
await win.waitForTimeout(300)
const forged = await win.evaluate(async (corePort) => {
  const tryOne = (src, partition) =>
    new Promise((resolve) => {
      const w = document.createElement('webview')
      w.setAttribute('partition', partition)
      w.setAttribute('src', src)
      w.style.cssText = 'position:fixed;left:0;top:0;width:50px;height:50px'
      let done = false
      w.addEventListener('did-finish-load', () => !done && ((done = true), resolve('loaded')))
      document.body.appendChild(w)
      setTimeout(() => !done && ((done = true), resolve('blocked')), 2500)
    })
  return {
    appInSnippetPartition: await tryOne(`http://127.0.0.1:${corePort}/`, 'snippet-forged'),
    persistentPartition: await tryOne('https://example.com/', 'persist:forged'),
    mainSession: await tryOne('https://example.com/', ''),
  }
}, port)
check('forged webviews (app URL, persistent or shared partition) are refused by the main process', Object.values(forged).every((v) => v === 'blocked'), JSON.stringify(forged))

// assistant settings go through the keychain bridge (AIFIG_DESKTOP_KEYCHAIN=mock stands in for the OS keychain)
const before2 = await (await fetch(`http://127.0.0.1:${port}/api/assistant/status`, { headers: authHeaders(env.AIFIG_HOME) })).json()
const info = await win.evaluate(async () => {
  await window.aifigDesktop.assistant.save({ provider: 'mock' })
  return window.aifigDesktop.assistant.get()
})
const after2 = await (await fetch(`http://127.0.0.1:${port}/api/assistant/status`, { headers: authHeaders(env.AIFIG_HOME) })).json()
check('assistant settings save via the keychain bridge and enable the assistant', !before2.available && after2.available && info.provider === 'mock', `keychain: ${info.encryption}`)
const keySaved = await win.evaluate(() => window.aifigDesktop.assistant.save({ provider: 'anthropic', key: 'sk-ant-test-SECRET' }))
const stored = fs.readFileSync(path.join(tmp, 'profile', 'assistant.bin'))
check('with a keychain, API keys are persisted encrypted (never plain text)', keySaved.persisted && keySaved.storage === 'mock' && stored.subarray(0, 11).toString() === 'AIFIGMOCK1:' && !stored.toString('latin1').includes('SECRET'), JSON.stringify(keySaved))
await win.evaluate(() => window.dispatchEvent(new Event('aifig:connect')))
await win.waitForTimeout(500)
if (shotDir) await win.screenshot({ path: path.join(shotDir, 'desktop-connect.png') })

await app.close()

// a machine without an OS keychain (or Linux basic_text): keys are kept for the session only, never written
app = await launch({ AIFIG_DESKTOP_KEYCHAIN: 'none' })
const win2 = await app.firstWindow()
await win2.waitForSelector('.ae-canvas', { timeout: 30000 })
const noKc = await win2.evaluate(async () => {
  const r = await window.aifigDesktop.assistant.save({ provider: 'openai', key: 'sk-proj-SESSION-ONLY-123' })
  return { r, get: await window.aifigDesktop.assistant.get() }
})
const onDisk = fs.readFileSync(path.join(tmp, 'profile', 'assistant.bin'), 'latin1')
const coreStatus = await (await fetch(`http://127.0.0.1:${port}/api/assistant/status`, { headers: authHeaders(env.AIFIG_HOME) })).json()
check('without a keychain, the key is used for this session only and never written to disk', !noKc.r.persisted && noKc.r.storage === 'session' && noKc.get.encryption === 'session' && noKc.get.hasKey && coreStatus.available && !onDisk.includes('SESSION-ONLY'), JSON.stringify(noKc))
await app.close()
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* core may still be writing */
}
console.log(failures ? `\n${failures} desktop check(s) failed` : '\nall desktop checks passed')
process.exit(failures ? 1 : 0)
