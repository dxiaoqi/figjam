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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shotDir = process.argv[2]
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-desktop-'))
const port = String(47871 + Math.floor(Math.random() * 50))
const env = { ...process.env, AIFIG_HOME: path.join(tmp, 'home'), AIFIG_CORE_PORT: port, DISPLAY: process.env.DISPLAY ?? ':1' }
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const call = async (tool, args) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args, caller: { id: 't', name: 'Test', client: 'test', kind: 'human' } }) })
  return (await r.json()).result
}

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron'),
  args: [path.join(root, 'apps/desktop'), '--no-sandbox', `--user-data-dir=${path.join(tmp, 'profile')}`],
  env,
})
const win = await app.firstWindow()
await win.waitForSelector('.ae-canvas', { timeout: 30000 })
await win.waitForTimeout(800)
check('desktop window opens the canvas', (await win.title()).includes('ai-figma'), await win.title())
const menus = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label))
check('native menus', ['File', 'Edit', 'View'].every((m) => menus.includes(m)), menus.join(', '))
check('preload bridge is available', await win.evaluate(() => !!window.aifigDesktop))
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
const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()
check('Connect dialog points at the bundled CLI / MCP', health.mcp.command.includes('electron') && health.mcp.env?.ELECTRON_RUN_AS_NODE === '1', `${health.mcp.command} ${health.mcp.args.join(' ')}`)
const mcp = new Client({ name: 'desktop-check', version: '1' })
await mcp.connect(new StdioClientTransport({ command: health.mcp.command, args: health.mcp.args, env: { ...process.env, ...health.mcp.env, AIFIG_CORE_PORT: port, AIFIG_HOME: env.AIFIG_HOME } }))
const tools = (await mcp.listTools()).tools.length
await mcp.close()
check('an agent can connect with that exact config', tools > 15, `${tools} tools`)
// web snippets run in the desktop app too, from this core's own snippet host
const coreHealth = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()
const snipRes = await call('create_snippet', { title: 'Desktop snippet', html: '<button id="b" style="font-size:20px;padding:20px">go</button>', js: "document.getElementById('b').onclick = () => aifig.setState({ clicked: true })" })
const snipId = snipRes?.id
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'zoom-fit'))
await win.waitForTimeout(900)
const box = await win.locator(`[data-block-id="${snipId}"]`).boundingBox()
if (box) await win.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
await win.waitForTimeout(1500)
await win.frameLocator('[data-web-frame]').locator('#b').click({ timeout: 5000 }).catch(() => {})
await win.waitForTimeout(600)
const snipState = (await call('get_board', { format: 'json' }))?.blocks?.find((b) => b.id === snipId)?.web?.state
check('web snippets run sandboxed in the desktop app (own snippet host)', coreHealth.snippetOrigin === `http://localhost:${Number(port) + 1}` && snipState?.clicked === true, JSON.stringify({ origin: coreHealth.snippetOrigin, snipState }))
await win.keyboard.press('Escape')
// assistant settings go through the keychain bridge; the core only keeps them in memory
const before2 = await (await fetch(`http://127.0.0.1:${port}/api/assistant/status`)).json()
const info = await win.evaluate(async () => {
  await window.aifigDesktop.assistant.save({ provider: 'mock' })
  return window.aifigDesktop.assistant.get()
})
const after2 = await (await fetch(`http://127.0.0.1:${port}/api/assistant/status`)).json()
check('assistant settings save via the keychain bridge and enable the assistant', !before2.available && after2.available && info.provider === 'mock', `keychain: ${info.encryption}`)
const keyResult = await win.evaluate(async () => {
  try {
    await window.aifigDesktop.assistant.save({ provider: 'anthropic', key: 'sk-ant-test-SECRET' })
    return 'saved'
  } catch (e) {
    return String(e.message)
  }
})
const stored = fs.readFileSync(path.join(tmp, 'profile', 'assistant.bin')).toString('latin1')
if (info.encryption === 'unavailable' || info.encryption === 'basic_text') check('without an OS keychain, API keys are refused rather than stored in plain text', keyResult.includes('keychain') && !stored.includes('SECRET'), keyResult.slice(0, 80))
else check('API keys are stored encrypted by the OS keychain', keyResult === 'saved' && !stored.includes('SECRET'))
await win.evaluate(() => window.dispatchEvent(new Event('aifig:connect')))
await win.waitForTimeout(500)
if (shotDir) await win.screenshot({ path: path.join(shotDir, 'desktop-connect.png') })

await app.close()
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* core may still be writing */
}
console.log(failures ? `\n${failures} desktop check(s) failed` : '\nall desktop checks passed')
process.exit(failures ? 1 : 0)
