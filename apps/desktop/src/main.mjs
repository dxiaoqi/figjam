// ai-figma desktop shell: runs (or reuses) the local core, hosts the canvas, native menus, files, keychain.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell } from 'electron'
import { LOCALES, systemLocale, translator } from './i18n.mjs'

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

app.setName('ai-figma')
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox')

let coreProcess = null
let win = null
let state = { boardId: null, title: '' }
// until the canvas reports its choice: saved preference, else the OS language
let locale = null
let localePref = 'system'
const osLocale = () => systemLocale(app.getPreferredSystemLanguages?.() ?? [app.getLocale()])
const tr = (key) => translator(locale ?? (localePref !== 'system' ? localePref : osLocale()))(key)

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
    const r = await fetch(`${coreUrl}/api/health`, { signal: AbortSignal.timeout(800) })
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, args, caller: { id: 'human:desktop', name: 'You', client: 'desktop', kind: 'human' } }),
  })
  const body = await r.json()
  if (!body.ok) throw new Error(body.error)
  return body.result
}

// ---- assistant key (OS keychain via safeStorage; never written to boards) ----

function readAssistant() {
  let buf
  try {
    buf = fs.readFileSync(assistantFile())
  } catch {
    return null
  }
  try {
    return JSON.parse(safeStorage.decryptString(buf))
  } catch {
    // settings without a secret (e.g. the offline demo provider) may be stored in plain form
    try {
      const plain = JSON.parse(buf.toString('utf8'))
      return plain.key ? null : plain
    } catch {
      return null
    }
  }
}

async function pushAssistant(settings) {
  try {
    await fetch(`${coreUrl}/api/assistant/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    encryption: safeStorage.isEncryptionAvailable() ? (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os') : 'unavailable',
  }
})

ipcMain.handle('assistant:save', async (_e, s) => {
  const prev = readAssistant()
  const next = s.provider ? { provider: s.provider, model: s.model || '', baseUrl: s.baseUrl || '', key: s.provider === 'mock' ? '' : s.key || prev?.key || '' } : null
  if (next?.key && !safeStorage.isEncryptionAvailable()) throw new Error('The OS keychain is not available, so the API key cannot be stored securely.')
  if (!next) fs.rmSync(assistantFile(), { force: true })
  else if (next.key) fs.writeFileSync(assistantFile(), safeStorage.encryptString(JSON.stringify(next)))
  else fs.writeFileSync(assistantFile(), JSON.stringify(next))
  await pushAssistant(next)
  return { ok: true }
})

// ---- files -------------------------------------------------------------------

async function openFile(file) {
  if (!file) {
    const r = await dialog.showOpenDialog(win, { title: tr('openBoard'), filters: [{ name: tr('boardFile'), extensions: ['aifig'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return
    file = r.filePaths[0]
  }
  try {
    const res = await call('open_file', { path: file })
    addRecent(file)
    win?.webContents.send('menu', 'open-board', res.board.id)
  } catch (e) {
    dialog.showErrorBox(tr('openFailed'), String(e.message ?? e))
  }
}

async function saveAs() {
  if (!state.boardId) return
  const r = await dialog.showSaveDialog(win, {
    title: tr('saveBoardAs'),
    defaultPath: path.join(app.getPath('documents'), `${(state.title || tr('board')).replace(/[\\/:*?"<>|]+/g, '-')}.aifig`),
    filters: [{ name: tr('boardFile'), extensions: ['aifig'] }],
  })
  if (r.canceled || !r.filePath) return
  try {
    await call('save_file', { board: state.boardId, path: r.filePath })
    addRecent(r.filePath)
  } catch (e) {
    dialog.showErrorBox(tr('saveFailed'), String(e.message ?? e))
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

function setLocalePref(pref) {
  win?.webContents.send('menu', 'locale', pref)
}

ipcMain.on('locale', (_e, next, pref) => {
  if (next === locale && pref === localePref) return
  locale = next
  localePref = pref
  writePrefs({ ...readPrefs(), locale: pref })
  buildMenu()
})

function buildMenu() {
  const prefs = readPrefs()
  const recent = (prefs.recent ?? []).filter((f) => fs.existsSync(f))
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      id: 'file',
      label: tr('file'),
      submenu: [
        { id: 'new-board', label: tr('newBoard'), accelerator: 'CmdOrCtrl+N', click: send('new-board') },
        { id: 'open', label: tr('open'), accelerator: 'CmdOrCtrl+O', click: () => openFile() },
        {
          id: 'open-recent',
          label: tr('openRecent'),
          submenu: recent.length
            ? [...recent.map((f) => ({ label: path.basename(f, '.aifig'), sublabel: f, click: () => openFile(f) })), { type: 'separator' }, { label: tr('clearRecent'), click: () => (writePrefs({ ...readPrefs(), recent: [] }), app.clearRecentDocuments(), buildMenu()) }]
            : [{ label: tr('noRecent'), enabled: false }],
        },
        { type: 'separator' },
        { id: 'save-as', label: tr('saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: () => saveAs() },
        {
          id: 'export',
          label: tr('export'),
          submenu: [
            { label: 'PNG…', click: send('export', 'png') },
            { label: 'SVG…', click: send('export', 'svg') },
            { label: 'JSON…', click: send('export', 'json') },
            { label: 'Markdown…', click: send('export', 'md') },
          ],
        },
        { type: 'separator' },
        { id: 'settings', label: tr('settings'), accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { id: 'assistant-settings', label: tr('assistantSettings'), click: send('assistant-settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      id: 'edit',
      label: tr('edit'),
      submenu: [
        { label: tr('undo'), accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: tr('redo'), accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: tr('duplicate'), accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
        { label: tr('selectAll'), accelerator: 'CmdOrCtrl+A', click: send('select-all') },
      ],
    },
    {
      id: 'view',
      label: tr('view'),
      submenu: [
        { label: tr('zoomIn'), accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: tr('zoomOut'), accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: tr('zoom100'), accelerator: 'CmdOrCtrl+0', click: send('zoom-100') },
        { label: tr('zoomFit'), accelerator: 'Shift+1', click: send('zoom-fit') },
        { type: 'separator' },
        { id: 'comment-mode', label: tr('commentMode'), accelerator: 'M', registerAccelerator: false, click: send('toggle-comments') },
        { label: tr('toggleMinimap'), click: send('toggle-minimap') },
        {
          id: 'appearance',
          label: tr('appearance'),
          submenu: ['system', 'light', 'dark'].map((t) => ({ label: tr(t === 'system' ? 'matchSystem' : t), type: 'radio', checked: (prefs.theme ?? 'system') === t, click: () => setTheme(t) })),
        },
        {
          id: 'language',
          label: tr('language'),
          submenu: [{ id: 'system', label: tr('matchSystem') }, ...LOCALES].map((l) => ({ id: `language-${l.id}`, label: l.label, type: 'radio', checked: localePref === l.id, click: () => setLocalePref(l.id) })),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu', label: tr('window') },
    {
      role: 'help',
      label: tr('help'),
      submenu: [
        { id: 'connect-agent', label: tr('connectAgent'), click: send('connect-agent') },
        { label: tr('openBoardsFolder'), click: async () => shell.openPath((await healthy())?.home ?? app.getPath('home')) },
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

// ---- window ------------------------------------------------------------------

async function createWindow() {
  const prefs = readPrefs()
  nativeTheme.themeSource = prefs.theme ?? 'system'
  localePref = prefs.locale ?? 'system'
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: 'ai-figma',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141416' : '#FAFAF9',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: false },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  hardenSnippets(win)
  buildMenu()
  try {
    await ensureCore()
    await pushAssistant(readAssistant())
    await win.loadURL(devUrl ?? `${coreUrl}/`)
    win.webContents.send('menu', 'theme', prefs.theme ?? 'system')
    win.webContents.send('menu', 'os-theme', nativeTheme.shouldUseDarkColors)
  } catch (e) {
    dialog.showErrorBox(tr('startFailed'), String(e.message ?? e))
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
