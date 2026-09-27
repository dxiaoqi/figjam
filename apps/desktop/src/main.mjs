// ai-figma desktop shell: runs (or reuses) the local core, hosts the canvas, native menus, files, keychain.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, session, shell } from 'electron'
import { LOCALES, systemLocale, translator } from './i18n.mjs'
import { createTelemetry } from './telemetry.mjs'
import { startUpdater } from './updater.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const packaged = app.isPackaged
let cliPath = packaged ? path.join(process.resourcesPath, 'aifig.mjs') : path.join(repoRoot, 'bin', 'aifig.mjs')
let uiDist = packaged ? path.join(process.resourcesPath, 'ui') : path.join(repoRoot, 'apps', 'canvas', 'dist')
let builtinSkills = packaged ? path.join(process.resourcesPath, 'skills') : path.join(repoRoot, 'skills', 'builtin')
// the command agents run for the bundled CLI/MCP server: this executable in Node mode
let agentCommand = process.execPath
const port = Number(process.env.AIFIG_CORE_PORT ?? 47821)
const coreUrl = `http://127.0.0.1:${port}`
const devUrl = process.env.AIFIG_DESKTOP_URL // e.g. the Vite dev server for hot reload
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json')
const assistantFile = () => path.join(app.getPath('userData'), 'assistant.bin')
// build-time feature flags: baked into features.json by the desktop build; from source, the environment
const features = (() => {
  try {
    if (packaged) return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'features.json'), 'utf8'))
  } catch {
    /* older build */
  }
  return { assistant: process.env.AIFIG_FEATURE_ASSISTANT === '1' }
})()
const assistantOn = features.assistant === true
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

// ---- distribution settings (telemetry endpoint, update feed) ---------------------------------------
// baked into the package by scripts/build.mjs; ~/.aifig/config.json and env vars override. Empty = off.

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
function distribution() {
  const baked = readJson(packaged ? path.join(here, 'distribution.json') : path.join(repoRoot, 'distribution.json')) ?? {}
  const user = readJson(path.join(aifigHome(), 'config.json')) ?? {}
  const pick = (envKey, userVal, bakedVal) => String(process.env[envKey] ?? userVal ?? bakedVal ?? '').trim()
  return {
    telemetryUrl: pick('AIFIG_TELEMETRY_URL', user.telemetry?.endpoint, baked.telemetryUrl),
    updateFeedUrl: pick('AIFIG_UPDATE_URL', user.updates?.feedUrl, baked.updateFeedUrl),
  }
}

/**
 * An AppImage runs from a fresh /tmp/.mount_* folder on every launch, so agent MCP configs can't point inside it.
 * Copy the CLI bundle, UI and skills to ~/.aifig/runtime/<version> once, and have agents run the AppImage file
 * itself (stable path, updated in place by the updater) in Node mode with that copy.
 */
function adoptStableRuntime() {
  if (!packaged || !process.env.APPIMAGE) return
  const base = path.join(aifigHome(), 'runtime')
  const dir = path.join(base, app.getVersion())
  if (!fs.existsSync(path.join(dir, '.complete'))) {
    const tmp = `${dir}.tmp-${process.pid}`
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(tmp, { recursive: true })
    for (const f of ['aifig.mjs', 'readable-copy-worker.mjs', 'ui', 'skills', 'node_modules']) {
      const from = path.join(process.resourcesPath, f)
      if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, f), { recursive: true })
    }
    fs.writeFileSync(path.join(tmp, '.complete'), app.getVersion())
    fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(tmp, dir)
  }
  for (const old of fs.readdirSync(base)) if (old !== app.getVersion()) fs.rmSync(path.join(base, old), { recursive: true, force: true })
  cliPath = path.join(dir, 'aifig.mjs')
  uiDist = path.join(dir, 'ui')
  builtinSkills = path.join(dir, 'skills')
  agentCommand = process.env.APPIMAGE
}
try {
  adoptStableRuntime()
} catch (e) {
  console.error('ai-figma: could not copy the CLI out of the AppImage; agent configs will point inside it', e)
}

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
    const r = await fetch(`${coreUrl}/api/health`, { headers: coreHeaders(), signal: AbortSignal.timeout(800) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

function mcpEnv() {
  // agents launch the bundled CLI with Electron's own Node runtime
  // (AIFIG_UI_DIST so a core started by an agent can still serve the canvas when the app opens later)
  const env = { ELECTRON_RUN_AS_NODE: '1', AIFIG_BIN: cliPath, AIFIG_BUILTIN_SKILLS: builtinSkills, AIFIG_UI_DIST: uiDist }
  return {
    AIFIG_BIN: cliPath,
    AIFIG_BUILTIN_SKILLS: builtinSkills,
    AIFIG_MCP_COMMAND: agentCommand,
    // AppImage: AppRun inserts --no-sandbox before the script unless it's already there, which Node mode rejects
    AIFIG_MCP_ARGS: JSON.stringify(agentCommand === process.env.APPIMAGE ? [cliPath, 'mcp', '--no-sandbox'] : [cliPath, 'mcp']),
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
  if (!assistantOn) return
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

ipcMain.on('aifig:features', (e) => {
  e.returnValue = { assistant: assistantOn }
})

if (assistantOn) ipcMain.handle('assistant:get', () => {
  const s = readAssistant()
  return {
    provider: s?.provider ?? null,
    model: s?.model ?? '',
    baseUrl: s?.baseUrl ?? '',
    hasKey: !!s?.key,
    encryption: vault.backend() ?? 'session',
  }
})

if (assistantOn) ipcMain.handle('assistant:save', async (_e, s) => {
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

// ---- anonymous install counting (opt-in, see telemetry.mjs) --------------------------------------------

let telemetry = null
const getTelemetry = () =>
  (telemetry ??= createTelemetry({
    endpoint: distribution().telemetryUrl,
    stateFile: path.join(app.getPath('userData'), 'telemetry.json'),
    appVersion: app.getVersion(),
    locale: () => locale ?? app.getLocale(),
  }))
ipcMain.handle('telemetry:status', () => getTelemetry().status())
ipcMain.handle('telemetry:set', (_e, granted) => getTelemetry().setConsent(granted === true))

ipcMain.on('aifig:token', (e) => {
  e.returnValue = readToken()
})

// ---- files -------------------------------------------------------------------

async function openFile(file) {
  if (file && file.toLowerCase().endsWith('.aifigpack')) return openPack(file)
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

/** A share pack: the canvas shows what's inside and asks where to put it. */
async function openPack(file) {
  if (!file) {
    const r = await dialog.showOpenDialog(win, { title: tr('openPack'), filters: [{ name: tr('packFile'), extensions: ['aifigpack'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return
    file = r.filePaths[0]
  }
  win?.webContents.send('menu', 'open-pack', path.resolve(file))
}

const SAVE_KINDS = {
  pack: { ext: 'aifigpack', name: () => tr('packFile') },
  zip: { ext: 'zip', name: () => 'ZIP' },
  html: { ext: 'html', name: () => 'HTML' },
}
ipcMain.handle('dialog:folder', async (_e, defaultPath) => {
  const r = await dialog.showOpenDialog(win, { title: tr('chooseFolder'), defaultPath: typeof defaultPath === 'string' ? defaultPath : app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})
ipcMain.handle('dialog:save', async (_e, opts) => {
  const kind = opts?.kind === 'folder' ? 'folder' : SAVE_KINDS[opts?.kind] ? opts.kind : 'pack'
  const name = String(opts?.defaultName ?? 'board').replace(/[\\/:*?"<>|]+/g, '-')
  if (kind === 'folder') {
    const r = await dialog.showOpenDialog(win, { title: tr('chooseFolder'), defaultPath: app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : path.join(r.filePaths[0], name)
  }
  const k = SAVE_KINDS[kind]
  const r = await dialog.showSaveDialog(win, { title: tr('savePack'), defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: k.name(), extensions: [k.ext] }] })
  return r.canceled ? null : (r.filePath ?? null)
})
// only files the canvas just wrote through a save dialog: packs and web exports
ipcMain.on('shell:reveal', (_e, file) => {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.(aifigpack|zip|html)$|[\\/][^\\/]+-web$/i.test(file) || !fs.existsSync(file)) return
  shell.showItemInFolder(file)
})

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
        { id: 'open-pack', label: tr('openPack'), click: () => openPack() },
        {
          id: 'open-recent',
          label: tr('openRecent'),
          submenu: recent.length
            ? [...recent.map((f) => ({ label: path.basename(f, '.aifig'), sublabel: f, click: () => openFile(f) })), { type: 'separator' }, { label: tr('clearRecent'), click: () => (writePrefs({ ...readPrefs(), recent: [] }), app.clearRecentDocuments(), buildMenu()) }]
            : [{ label: tr('noRecent'), enabled: false }],
        },
        { type: 'separator' },
        { id: 'save-as', label: tr('saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: () => saveAs() },
        { id: 'version-history', label: tr('versionHistory'), click: send('version-history') },
        { id: 'storage', label: tr('storage'), click: send('storage') },
        {
          id: 'export',
          label: tr('export'),
          submenu: [
            { label: 'PNG…', click: send('export', 'png') },
            { label: 'SVG…', click: send('export', 'svg') },
            { label: 'JSON…', click: send('export', 'json') },
            { label: 'Markdown…', click: send('export', 'md') },
            { type: 'separator' },
            { id: 'share-pack', label: tr('sharePack'), click: send('export-pack') },
          ],
        },
        { type: 'separator' },
        { id: 'settings', label: tr('settings'), accelerator: 'CmdOrCtrl+,', click: send('settings') },
        ...(assistantOn ? [{ id: 'assistant-settings', label: tr('assistantSettings'), click: send('assistant-settings') }] : []),
        { id: 'activity', label: tr('activity'), click: send('activity') },
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

// packaged: build/app/icon.png (copied by scripts/build.mjs); from source: the committed Linux raster
const windowIcon = [path.join(here, 'icon.png'), path.join(here, '../resources/icons/512x512.png')].find((p) => fs.existsSync(p))

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
    ...(process.platform !== 'darwin' && windowIcon ? { icon: windowIcon } : {}),
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
    dialog.showErrorBox(tr('startFailed'), String(e.message ?? e))
  }
  const fileArg = pendingFile ?? process.argv.find((a) => /\.aifig(pack)?$/i.test(a))
  pendingFile = null
  if (fileArg) openFile(path.resolve(fileArg))
}

// the renderer's prefers-color-scheme doesn't track the OS everywhere (e.g. Linux), so forward it
nativeTheme.on('updated', () => win?.webContents.send('menu', 'os-theme', nativeTheme.shouldUseDarkColors))

/** A file double-clicked before the window was ready (macOS sends open-file early). */
let pendingFile = null
app.on('open-file', (e, file) => {
  e.preventDefault()
  if (win?.webContents && !win.webContents.isLoading()) openFile(file)
  else pendingFile = file
})
// double-clicking a board or pack while the app runs (Windows, Linux) reaches this instance instead of a second one
const firstInstance = app.requestSingleInstanceLock()
if (!firstInstance) app.quit()
app.on('second-instance', (_e, argv) => {
  const file = argv.find((a) => /\.aifig(pack)?$/i.test(a))
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
  if (file) openFile(path.resolve(file))
})
app.whenReady().then(() => {
  if (!firstInstance) return
  createWindow()
  getTelemetry().start()
  const log = (m) => fs.appendFile(path.join(app.getPath('userData'), 'updates.log'), `${new Date().toISOString()} ${m}\n`, () => {})
  const updates = startUpdater({ feedUrl: distribution().updateFeedUrl, packaged, log })
  log(updates.enabled ? `auto-update on (${updates.feedUrl})` : `auto-update off: ${updates.reason}`)
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length) createWindow()
})
app.on('before-quit', () => coreProcess?.kill())
