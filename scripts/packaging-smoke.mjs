// Smoke test for the packaged Linux app: launches the AppImage, checks the core and the canvas window,
// telemetry consent (nothing sent before opt-in, only the documented fields after, ID deleted on opt-out), runs
// one-click Claude Code setup into a scratch home, quits the app, then does a real MCP handshake with exactly the
// command that setup wrote — with no Node on PATH and with user namespaces "unavailable" (AppRun's --no-sandbox).
//
// usage: node scripts/packaging-smoke.mjs [path/to/ai-figma.AppImage]   (default: newest in apps/desktop/release)
// Needs a display (DISPLAY, or xvfb-run). Without FUSE (containers) the AppImage is extracted and its AppRun used.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = path.join(root, 'apps/desktop/release')
const appImage =
  process.argv[2] ??
  fs
    .readdirSync(release)
    .filter((f) => f.endsWith('.AppImage'))
    .map((f) => path.join(release, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
if (!appImage || !fs.existsSync(appImage)) {
  console.error('No AppImage found. Build one with `npm run release:linux` (or `npm run desktop:build -- --linux`).')
  process.exit(1)
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-pkg-'))
const home = path.join(tmp, 'aifig-home')
const agentHome = path.join(tmp, 'agent-home')
const port = 48200 + Math.floor(Math.random() * 300)
const coreUrl = `http://127.0.0.1:${port}`
fs.mkdirSync(path.join(agentHome, '.claude'), { recursive: true })
console.log(`AppImage: ${path.relative(root, appImage)}  (${(fs.statSync(appImage).size / 1e6).toFixed(0)} MB)`)

// ---- how to run it: FUSE mount, or the extracted AppDir -------------------------------------------------
let command = appImage
const fuse = (() => {
  try {
    execFileSync(appImage, ['--appimage-version'], { stdio: 'ignore', timeout: 20000 })
    const probe = spawn(appImage, ['--appimage-mount'], { stdio: ['ignore', 'pipe', 'ignore'] })
    return new Promise((resolve) => {
      probe.stdout.once('data', (d) => {
        const mount = String(d).split('\n')[0].trim()
        resolve(mount.startsWith('/') && fs.existsSync(path.join(mount, 'AppRun')))
        probe.kill()
      })
      probe.on('exit', () => resolve(false))
      setTimeout(() => (probe.kill(), resolve(false)), 5000)
    })
  } catch {
    return false
  }
})()
if (!(await fuse)) {
  const dir = path.join(tmp, 'appdir')
  fs.mkdirSync(dir)
  execFileSync(appImage, ['--appimage-extract'], { cwd: dir, stdio: 'ignore' })
  command = path.join(dir, 'squashfs-root/AppRun')
  console.log('  (no FUSE here: running the extracted AppDir through its AppRun)')
}

// ---- a capture server standing in for the telemetry endpoint ------------------------------------------
const pings = []
const telemetry = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    pings.push({ url: req.url, body: JSON.parse(body || 'null') })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
})
await new Promise((r) => telemetry.listen(0, '127.0.0.1', r))
const telemetryUrl = `http://127.0.0.1:${telemetry.address().port}`

const baseEnv = { ...process.env, AIFIG_HOME: home, AIFIG_CORE_PORT: String(port), AIFIG_AGENT_CONFIG_HOME: agentHome, AIFIG_DESKTOP_KEYCHAIN: 'mock' }
delete baseEnv.AIFIG_TOKEN
delete baseEnv.AIFIG_TELEMETRY
delete baseEnv.DO_NOT_TRACK
const appEnv = { ...baseEnv, AIFIG_TELEMETRY_URL: telemetryUrl, APPIMAGE: command === appImage ? undefined : command }
if (!appEnv.APPIMAGE) delete appEnv.APPIMAGE
const token = () => fs.readFileSync(path.join(home, 'access-token'), 'utf8').trim()
const api = (p, init = {}) => fetch(coreUrl + p, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}`, ...(init.headers ?? {}) } }).then((r) => r.json())
const health = async () => {
  try {
    return await api('/api/health')
  } catch {
    return null
  }
}

// ---- launch the packaged app --------------------------------------------------------------------------
const started = Date.now()
const app = await electron.launch({ executablePath: command, args: [`--user-data-dir=${path.join(tmp, 'profile')}`, '--disable-gpu'], env: appEnv, timeout: 90000 })
let appLog = ''
app.process().stdout?.on('data', (d) => (appLog += d))
app.process().stderr?.on('data', (d) => (appLog += d))
let h = null
for (let i = 0; i < 150 && !h?.ok; i++) {
  await sleep(200)
  if (fs.existsSync(path.join(home, 'access-token'))) h = await health()
}
check('the packaged app starts its bundled core', !!h?.ok, h ? `${((Date.now() - started) / 1000).toFixed(1)} s` : appLog.slice(-800))
if (!h?.ok) process.exit(1)

const runtimeDir = path.join(home, 'runtime')
check('the CLI, UI and skills are copied to a stable runtime folder', fs.existsSync(path.join(runtimeDir, fs.readdirSync(runtimeDir)[0] ?? '-', 'aifig.mjs')), fs.readdirSync(runtimeDir).join(', '))
check('agents are pointed at the AppImage file and the stable CLI, not the temporary mount', h.mcp.command === (appEnv.APPIMAGE ?? appImage) && h.mcp.args[0].startsWith(runtimeDir) && h.mcp.args.includes('--no-sandbox'), `${h.mcp.command} ${h.mcp.args.join(' ')}`)
check('the MCP env needs no Node install', h.mcp.env?.ELECTRON_RUN_AS_NODE === '1' && !/\bnode$/.test(h.mcp.command))

// the readable <id>.json copy is built by a worker thread; a packaged app has no node_modules, so the worker is bundled
const HUMAN = { id: 'human:pkg', name: 'You', client: 'test', kind: 'human' }
const readableCopyBuilt = async () => {
  const made = await api('/api/call', { method: 'POST', body: JSON.stringify({ tool: 'create_board', args: { title: `Readable ${Date.now()}` }, caller: HUMAN }) })
  const id = made.result?.board?.id
  await api('/api/call', { method: 'POST', body: JSON.stringify({ tool: 'create_blocks', args: { board: id, blocks: [{ text: 'one' }, { text: 'two' }] }, caller: HUMAN }) })
  const file = path.join(home, 'boards', `${id}.json`)
  for (let i = 0; i < 75 && !(fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).blocks.length === 2); i++) await sleep(200)
  const st = (await health())?.readableCopy
  return { ok: fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).blocks.length === 2 && st?.written.worker > 0 && st.written.inline === 0 && !st.workerError, st }
}
{
  const r = await readableCopyBuilt()
  check('autosave builds the readable JSON copy in its worker thread (bundled, off the main thread)', r.ok, JSON.stringify(r.st))
  check('the readable-copy worker is copied to the stable runtime folder', fs.existsSync(path.join(runtimeDir, fs.readdirSync(runtimeDir)[0] ?? '-', 'readable-copy-worker.mjs')))
}

// ---- the window: canvas loaded, bridge present, telemetry consent ------------------------------------------
const page = await app.firstWindow({ timeout: 60000 }).catch(() => null)
for (let i = 0; i < 100 && page && !page.url().startsWith(coreUrl); i++) await sleep(200)
check('the app window loads the canvas from the core', !!page?.url().startsWith(coreUrl), page?.url() ?? appLog.slice(-1500))
if (page) {
  await page.waitForSelector('.ae-canvas', { timeout: 30000 }).catch(() => {})
  check('the canvas renders', (await page.locator('.ae-canvas').count()) > 0)
  const status0 = await page.evaluate(() => window.aifigDesktop?.telemetry?.status())
  await sleep(1500)
  check('telemetry is off until the user opts in, and nothing is sent', status0?.configured === true && status0.consent === null && status0.enabled === false && pings.length === 0, JSON.stringify({ consent: status0?.consent, pings: pings.length }))
  const status1 = await page.evaluate(() => window.aifigDesktop.telemetry.set(true))
  for (let i = 0; i < 50 && !pings.length; i++) await sleep(100)
  const ping = pings[0]?.body ?? {}
  check('opting in sends one install ping', pings.length === 1 && pings[0].url === '/v1/events' && ping.event === 'install' && status1.enabled, JSON.stringify(ping))
  check('the ping carries only the documented fields', JSON.stringify(Object.keys(ping).sort()) === JSON.stringify(['appVersion', 'arch', 'event', 'installId', 'locale', 'os', 'v']))
  const text = JSON.stringify(ping)
  check('no PII in the ping (user name, host name, home path)', ![os.userInfo().username, os.hostname(), os.homedir(), tmp].some((s) => s && s.length > 2 && text.includes(s)), text)
  const stateFile = path.join(tmp, 'profile', 'telemetry.json')
  await page.evaluate(() => window.aifigDesktop.telemetry.set(false))
  const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  check('opting out deletes the install ID', after.consent === 'denied' && !('installId' in after), JSON.stringify(after))
}

// ---- one-click agent setup, as the Connect agent dialog does it ------------------------------------------
const setupHeaders = { origin: coreUrl }
const installed = await api('/api/agents/claude/install', { method: 'POST', body: '{}', headers: setupHeaders })
const claudeCfg = JSON.parse(fs.readFileSync(path.join(agentHome, '.claude.json'), 'utf8'))
const entry = claudeCfg.mcpServers?.['ai-figma']
check('one-click setup writes the bundled CLI into ~/.claude.json', installed.ok && entry?.command === h.mcp.command, JSON.stringify(entry))
const tested = await api('/api/agents/claude/test', { method: 'POST', body: '{}', headers: setupHeaders })
check('Test connection does a real MCP handshake', tested.ok === true, JSON.stringify(tested).slice(0, 300))

await app.close()
for (let i = 0; i < 50 && (await health()); i++) await sleep(200)
check('quitting the app stops its core', !(await health()))

// ---- the agent's side: launch exactly what setup wrote, with no Node on PATH ----------------------------
const shim = path.join(tmp, 'shim')
fs.mkdirSync(shim)
fs.writeFileSync(path.join(shim, 'unshare'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
const nodeDirs = new Set([path.dirname(process.execPath), ...(process.env.PATH ?? '').split(':').filter((d) => fs.existsSync(path.join(d, 'node')))])
const pathNoNode = [shim, ...(process.env.PATH ?? '').split(':').filter((d) => d && !nodeDirs.has(d))].join(':')
const transport = new StdioClientTransport({
  command: entry.command,
  args: entry.args,
  env: { ...baseEnv, ...entry.env, PATH: pathNoNode, ...(appEnv.APPIMAGE ? { APPIMAGE: appEnv.APPIMAGE } : {}) },
  stderr: 'pipe',
})
let mcpErr = ''
transport.stderr?.on('data', (d) => (mcpErr += d))
const client = new Client({ name: 'claude-code', version: '1.0.0' })
try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  check('MCP handshake with the configured command (no Node on PATH, AppRun adds --no-sandbox)', tools.length > 20, `${tools.length} tools`)
  const board = await client.callTool({ name: 'get_board', arguments: {} })
  check('the MCP server started its own core and answers tool calls', !board.isError, board.content?.[0]?.text?.slice(0, 80))
  const agentCopy = await readableCopyBuilt()
  check('the agent-started core (runtime folder) builds the readable copy in its worker too', agentCopy.ok, JSON.stringify(agentCopy.st))
  const snap = await client.callTool({ name: 'render_snapshot', arguments: {} })
  check('PNG export works (bundled resvg native module)', snap.content?.some((c) => c.type === 'image'), snap.isError ? snap.content?.[0]?.text : '')
  const webDir = path.join(tmp, 'web-export')
  const web = await client.callTool({ name: 'export_web', arguments: { path: webDir } })
  check('web page export works (the viewer ships with the UI)', !web.isError && fs.existsSync(path.join(webDir, 'viewer.js')) && fs.existsSync(path.join(webDir, 'index.html')), web.content?.[0]?.text?.slice(0, 200))
  const packFile = path.join(tmp, 'packaged.aifigpack')
  const pk = await client.callTool({ name: 'export_pack', arguments: { path: packFile } })
  const up = pk.isError ? pk : await client.callTool({ name: 'import_pack', arguments: { path: packFile, dest: path.join(tmp, 'packs') } })
  check('share packs export and import', !pk.isError && !up.isError && fs.readdirSync(path.join(tmp, 'packs')).some((f) => f.endsWith('.aifig')), (up.content ?? pk.content)?.[0]?.text?.slice(0, 200))
  const ui = await fetch(`${coreUrl}/`, { headers: { authorization: `Bearer ${token()}` } }).then((r) => r.text())
  check('a core started by an agent still serves the canvas', ui.includes('<div id="root"'))
} catch (e) {
  check('MCP handshake with the configured command', false, `${e.message}\n${mcpErr.slice(-800)}`)
} finally {
  await client.close().catch(() => {})
}

const bg = await health()
if (bg?.pid) process.kill(bg.pid, 'SIGTERM')
telemetry.close()
await sleep(500)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed` : '\nall packaging checks passed')
process.exit(failures ? 1 : 0)
