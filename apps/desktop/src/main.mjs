// ai-figma desktop shell: runs (or reuses) the local core, hosts the canvas, native menus, files, keychain.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, session, shell } from 'electron'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const packaged = app.isPackaged
const cliPath = packaged ? path.join(process.resourcesPath, 'aifig.mjs') : path.join(repoRoot, 'bin', 'aifig.mjs')
const uiDist = packaged ? path.join(process.resourcesPath, 'ui') : path.join(repoRoot, 'apps', 'canvas', 'dist')
const port = Number(process.env.AIFIG_CORE_PORT ?? 47821)
const coreUrl = `http://127.0.0.1:${port}`
const devUrl = process.env.AIFIG_DESKTOP_URL // e.g. the Vite dev server for hot reload
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json')
const assistantFile = () => path.join(app.getPath('userData'), 'assistant.bin')
const snippetPort = Number(process.env.AIFIG_SNIPPET_PORT ?? port + 1)
const snippetOrigin = `http://localhost:${snippetPort}`

// ---- access token (created by the core in AIFIG_HOME, mode 0600) -------------------

const aifigHome = () => process.env.AIFIG_HOME ?? path.join(os.homedir(), '.aifig')
function readToken() {
  if (process.env.AIFIG_TOKEN) return process.env.AIFIG_TOKEN.trim()
  try {
    const t = fs.readFileSync(path.join(aifigHome(), 'access-token'), 'utf8').trim()
    return /^[A-Za-z0-9_-]{32,128}$/.test(t) ? t : null
  } catch {
    return null
  }
}
const coreHeaders = () => {
  const t = readToken()
  return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }
}

app.setName('ai-figma')
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox')

let coreProcess = null
let win = null
let state = { boardId: null, title: '' }

// ---- prefs & recent files ---------------------------------------------------

function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8'))
  } catch {
    return { recent: [], theme: 'system' }
  }
}
function writePrefs(p) {
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true })
  fs.writeFileSync(prefsFile(), JSON.stringify(p, null, 2))
}
function addRecent(file) {
  const p = readPrefs()
  p.recent = [file, ...(p.recent ?? []).filter((f) => f !== file)].slice(0, 10)
  writePrefs(p)
  app.addRecentDocument(file)
  buildMenu()
}

// ---- core ------------------------------------------------------------------

async function healthy() {
  try {
    const r = await fetch(`${coreUrl}/api/health`, { headers: coreHeaders(), signal: AbortSignal.timeout(800) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

function mcpEnv() {
  // agents launch the bundled CLI with Electron's own Node runtime
  const env = { ELECTRON_RUN_AS_NODE: '1', AIFIG_BIN: cliPath }
  return {
    AIFIG_BIN: cliPath,
    AIFIG_MCP_COMMAND: process.execPath,
    AIFIG_MCP_ARGS: JSON.stringify([cliPath, 'mcp']),
    AIFIG_MCP_ENV: JSON.stringify(env),
    AIFIG_UI_DIST: uiDist,
  }
}

async function ensureCore() {
  if (await healthy()) return 'reused'
  const log = fs.openSync(path.join(app.getPath('userData'), 'core.log'), 'a')
  coreProcess = spawn(process.execPath, [cliPath, 'core'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AIFIG_CORE_PORT: String(port), ...mcpEnv() },
    stdio: ['ignore', log, log],
  })
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200))
    if (await healthy()) return 'spawned'
  }
  throw new Error(`The ai-figma core did not start. See ${path.join(app.getPath('userData'), 'core.log')}`)
}

async function call(tool, args) {
  const r = await fetch(`${coreUrl}/api/call`, {
    method: 'POST',
    headers: coreHeaders(),
    body: JSON.stringify({ tool, args, caller: { id: 'human:desktop', name: 'You', client: 'desktop', kind: 'human' } }),
  })
  const body = await r.json()
  if (!body.ok) throw new Error(body.error)
  return body.result
}

// ---- assistant key (OS keychain via safeStorage; never written to boards) ----
//
// Policy: a key is persisted only when safeStorage is backed by the OS (macOS Keychain, Windows DPAPI, or a
// Linux keyring — not Electron's `basic_text` fallback, which uses a hard-coded password). Otherwise the key
// is kept in memory for this session and handed to the core; settings without a key are stored in plain JSON.
// AIFIG_DESKTOP_KEYCHAIN=mock|none swaps in a test double / simulates a machine without a keychain.

const KEYCHAIN_MODE = process.env.AIFIG_DESKTOP_KEYCHAIN
const MOCK_PREFIX = Buffer.from('AIFIGMOCK1:')
const vault =
  KEYCHAIN_MODE === 'mock'
    ? {
        backend: () => 'mock',
        encrypt: (s) => Buffer.concat([MOCK_PREFIX, Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a))]),
        decrypt: (buf) => {
          if (!buf.subarray(0, MOCK_PREFIX.length).equals(MOCK_PREFIX)) throw new Error('not a mock-encrypted blob')
          return Buffer.from(buf.subarray(MOCK_PREFIX.length).map((b) => b ^ 0x5a)).toString('utf8')
        },
      }
    : {
        /** 'os' | Linux keyring name when keys can be persisted securely, else null */
        backend: () => {
          if (KEYCHAIN_MODE === 'none' || !safeStorage.isEncryptionAvailable()) return null
          if (process.platform !== 'linux') return 'os'
          const b = safeStorage.getSelectedStorageBackend()
          return b === 'basic_text' || b === 'unknown' ? null : b
        },
        encrypt: (s) => safeStorage.encryptString(s),
        decrypt: (buf) => safeStorage.decryptString(buf),
      }
let sessionKey = null

function readAssistant() {
  let buf
  try {
    buf = fs.readFileSync(assistantFile())
  } catch {
    return null
  }
  let saved = null
  try {
    if (vault.backend()) saved = JSON.parse(vault.decrypt(buf))
  } catch {
    // not encrypted (settings without a key) or from another keychain
  }
  if (!saved) {
    try {
      const plain = JSON.parse(buf.toString('utf8'))
      saved = plain.key ? null : plain
    } catch {
      return null
    }
  }
  if (saved && !saved.key && sessionKey && sessionKey.provider === saved.provider) saved.key = sessionKey.key
  return saved
}

async function pushAssistant(settings) {
  try {
    await fetch(`${coreUrl}/api/assistant/config`, {
      method: 'POST',
      headers: coreHeaders(),
      body: JSON.stringify(settings ?? { provider: null }),
    })
  } catch {
    /* core not up yet */
  }
}

ipcMain.handle('assistant:get', () => {
  const s = readAssistant()
  return {
    provider: s?.provider ?? null,
    model: s?.model ?? '',
    baseUrl: s?.baseUrl ?? '',
    hasKey: !!s?.key,
    encryption: vault.backend() ?? 'session',
  }
})

ipcMain.handle('assistant:save', async (_e, s) => {
  const prev = readAssistant()
  const next = s.provider ? { provider: s.provider, model: s.model || '', baseUrl: s.baseUrl || '', key: s.provider === 'mock' ? '' : s.key || (prev?.provider === s.provider ? prev?.key : '') || '' } : null
  const secure = !!vault.backend()
  sessionKey = null
  if (!next) fs.rmSync(assistantFile(), { force: true })
  else if (next.key && secure) fs.writeFileSync(assistantFile(), vault.encrypt(JSON.stringify(next)), { mode: 0o600 })
  else {
    // no OS keychain: remember the key for this session only, persist the rest without it
    if (next.key) sessionKey = { provider: next.provider, key: next.key }
    fs.writeFileSync(assistantFile(), JSON.stringify({ ...next, key: '' }), { mode: 0o600 })
  }
  await pushAssistant(next)
  return { ok: true, persisted: !next?.key || secure, storage: next?.key ? (secure ? vault.backend() : 'session') : null }
})

ipcMain.on('aifig:token', (e) => {
  e.returnValue = readToken()
})

// ---- files -------------------------------------------------------------------

async function openFile(file) {
  if (!file) {
    const r = await dialog.showOpenDialog(win, { title: 'Open board', filters: [{ name: 'ai-figma board', extensions: ['aifig'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return
    file = r.filePaths[0]
  }
  try {
    const res = await call('open_file', { path: file })
    addRecent(file)
    win?.webContents.send('menu', 'open-board', res.board.id)
  } catch (e) {
    dialog.showErrorBox('Couldn’t open the board', String(e.message ?? e))
  }
}

async function saveAs() {
  if (!state.boardId) return
  const r = await dialog.showSaveDialog(win, {
    title: 'Save board as',
    defaultPath: path.join(app.getPath('documents'), `${(state.title || 'Board').replace(/[\\/:*?"<>|]+/g, '-')}.aifig`),
    filters: [{ name: 'ai-figma board', extensions: ['aifig'] }],
  })
  if (r.canceled || !r.filePath) return
  try {
    await call('save_file', { board: state.boardId, path: r.filePath })
    addRecent(r.filePath)
  } catch (e) {
    dialog.showErrorBox('Couldn’t save the board', String(e.message ?? e))
  }
}

// ---- menus -------------------------------------------------------------------

const send = (action, payload) => () => win?.webContents.send('menu', action, payload)

function setTheme(theme) {
  nativeTheme.themeSource = theme
  const p = readPrefs()
  p.theme = theme
  writePrefs(p)
  win?.webContents.send('menu', 'theme', theme)
  buildMenu()
}

function buildMenu() {
  const prefs = readPrefs()
  const recent = (prefs.recent ?? []).filter((f) => fs.existsSync(f))
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Board', accelerator: 'CmdOrCtrl+N', click: send('new-board') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openFile() },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? [...recent.map((f) => ({ label: path.basename(f, '.aifig'), sublabel: f, click: () => openFile(f) })), { type: 'separator' }, { label: 'Clear Recent', click: () => (writePrefs({ ...readPrefs(), recent: [] }), app.clearRecentDocuments(), buildMenu()) }]
            : [{ label: 'No recent boards', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => saveAs() },
        {
          label: 'Export',
          submenu: [
            { label: 'PNG…', click: send('export', 'png') },
            { label: 'SVG…', click: send('export', 'svg') },
            { label: 'JSON…', click: send('export', 'json') },
            { label: 'Markdown…', click: send('export', 'md') },
          ],
        },
        { type: 'separator' },
        { label: 'Assistant Settings…', click: send('assistant-settings') },
        { label: 'Activity & Permissions…', click: send('activity') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: send('select-all') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: 'Zoom to 100%', accelerator: 'CmdOrCtrl+0', click: send('zoom-100') },
        { label: 'Zoom to Fit', accelerator: 'Shift+1', click: send('zoom-fit') },
        { type: 'separator' },
        { label: 'Comment Mode', accelerator: 'M', registerAccelerator: false, click: send('toggle-comments') },
        { label: 'Toggle Minimap', click: send('toggle-minimap') },
        {
          label: 'Appearance',
          submenu: ['system', 'light', 'dark'].map((t) => ({ label: t === 'system' ? 'Match System' : t[0].toUpperCase() + t.slice(1), type: 'radio', checked: (prefs.theme ?? 'system') === t, click: () => setTheme(t) })),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Connect an Agent…', click: send('connect-agent') },
        { label: 'Open Boards Folder', click: async () => shell.openPath((await healthy())?.home ?? app.getPath('home')) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

ipcMain.on('state', (_e, s) => {
  state = s
})

// ---- web snippets ------------------------------------------------------------

/**
 * Web snippets run in iframes (inline ones from the localhost snippet host, sandboxed, credentialless → an
 * ephemeral storage partition of their own). On top of that, in the desktop app: no permission prompts for
 * anything that isn't the app itself, no navigating the app window away, no popups except https to the browser.
 */
function hardenSnippets(w) {
  const appOrigins = new Set([new URL(coreUrl).origin, devUrl ? new URL(devUrl).origin : null].filter(Boolean))
  const isApp = (url) => {
    try {
      return appOrigins.has(new URL(url).origin)
    } catch {
      return false
    }
  }
  const ses = w.webContents.session
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(isApp(details.requestingUrl ?? '') && ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)))
  ses.setPermissionCheckHandler((_wc, permission, origin) => isApp(origin) && ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
  w.webContents.on('will-navigate', (e, url) => {
    if (!isApp(url)) e.preventDefault()
  })
  w.webContents.on('will-frame-navigate', (e) => {
    if (e.isMainFrame && !isApp(e.url)) e.preventDefault()
  })
}

/**
 * Web snippets run in <webview>s, each in its own in-memory partition (`snippet-…`): separate storage, cache,
 * cookies and permission state per snippet. The renderer only picks src and partition; everything else is set
 * here, and a webview that doesn't match these rules is refused.
 */
const LOCAL_HOST = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1?\]|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|169\.254(\.\d+){2}|\[f[cd][0-9a-f:]*\]|\[fe[89ab][0-9a-f:]*\])$/i
const isInlineSnippet = (url) => {
  try {
    const u = new URL(url)
    return u.origin === snippetOrigin && u.pathname.startsWith('/inline/')
  } catch {
    return false
  }
}
const isEmbed = (url) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !LOCAL_HOST.test(u.hostname)
  } catch {
    return false
  }
}
const SNIPPET_PARTITION = /^snippet-[\w-]{1,96}$/
const hardenedPartitions = new Set()

function hardenPartition(partition) {
  if (hardenedPartitions.has(partition)) return
  hardenedPartitions.add(partition)
  const ses = session.fromPartition(partition, { cache: false })
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(permission === 'fullscreen' && isEmbed(details.requestingUrl ?? '')))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
  ses.on('will-download', (e) => e.preventDefault())
  // nothing in a snippet partition talks to this machine or the LAN, except an inline snippet's own document
  ses.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url
    if (/^(data|blob|about|devtools|chrome-extension):/.test(url)) return cb({})
    if (isInlineSnippet(url)) return cb({ cancel: details.resourceType !== 'mainFrame' })
    let u
    try {
      u = new URL(url)
    } catch {
      return cb({ cancel: true })
    }
    cb({ cancel: !(u.protocol === 'https:' || u.protocol === 'wss:') || LOCAL_HOST.test(u.hostname) })
  })
}

function guardWebviews(w) {
  w.webContents.on('will-attach-webview', (e, prefs, params) => {
    const inline = isInlineSnippet(params.src)
    if (!SNIPPET_PARTITION.test(params.partition ?? '') || (!inline && !isEmbed(params.src))) {
      e.preventDefault()
      return
    }
    hardenPartition(params.partition)
    delete prefs.preloadURL
    prefs.preload = inline ? path.join(here, 'snippet-preload.cjs') : undefined
    Object.assign(prefs, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, experimentalFeatures: false, enableBlinkFeatures: '', navigateOnDragDrop: false, spellcheck: false })
    params.allowpopups = false
  })
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return
  const start = { inline: null }
  const first = (e, url) => {
    const u = typeof url === 'string' ? url : e?.url
    if (!u || u === 'about:blank' || start.inline !== null) return
    start.inline = isInlineSnippet(u)
    contents.off('did-start-navigation', first)
  }
  contents.on('did-start-navigation', first)
  // inline snippets stay on their own document; embeds may move around https but never to this machine
  const allowed = (url) => (start.inline === true ? isInlineSnippet(url) : isEmbed(url))
  contents.on('will-navigate', (e) => !allowed(e.url) && e.preventDefault())
  contents.on('will-frame-navigate', (e) => e.isMainFrame && !allowed(e.url) && e.preventDefault())
  contents.on('will-redirect', (e) => !allowed(e.url) && e.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (start.inline === false && /^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-attach-webview', (e) => e.preventDefault())
})

// ---- window ------------------------------------------------------------------

async function createWindow() {
  const prefs = readPrefs()
  nativeTheme.themeSource = prefs.theme ?? 'system'
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: 'ai-figma',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141416' : '#FAFAF9',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, webviewTag: true },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  hardenSnippets(win)
  guardWebviews(win)
  buildMenu()
  try {
    await ensureCore()
    await pushAssistant(readAssistant())
    await win.loadURL(devUrl ?? `${coreUrl}/`)
    win.webContents.send('menu', 'theme', prefs.theme ?? 'system')
    win.webContents.send('menu', 'os-theme', nativeTheme.shouldUseDarkColors)
  } catch (e) {
    dialog.showErrorBox('ai-figma couldn’t start', String(e.message ?? e))
  }
  const fileArg = process.argv.find((a) => a.endsWith('.aifig'))
  if (fileArg) openFile(path.resolve(fileArg))
}

// the renderer's prefers-color-scheme doesn't track the OS everywhere (e.g. Linux), so forward it
nativeTheme.on('updated', () => win?.webContents.send('menu', 'os-theme', nativeTheme.shouldUseDarkColors))

app.on('open-file', (e, file) => {
  e.preventDefault()
  if (win) openFile(file)
})
app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length) createWindow()
})
app.on('before-quit', () => coreProcess?.kill())
