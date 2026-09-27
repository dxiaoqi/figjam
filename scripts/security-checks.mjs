// Security checks: access token (HTTP API, MCP over HTTP, sync WebSocket), Host/Origin checks, permission broker
// and prompts, activity log, secret stores (incl. the macOS Keychain path via a fake `security`), SSRF guard.
// usage: node scripts/security-checks.mjs   (starts its own isolated cores; no browser needed)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { register } from 'tsx/esm/api'

register()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-sec-'))

// ---- unit: token file, guard, policy -------------------------------------------------------------
const auth = await import('../packages/core/src/auth.ts')
const uhome = path.join(tmp, 'unit')
const t1 = auth.loadOrCreateToken(uhome)
const mode = fs.statSync(auth.tokenPath(uhome)).mode & 0o777
check('the access token is created with 0600 permissions', /^[\w-]{43}$/.test(t1) && (process.platform === 'win32' || mode === 0o600), `mode ${mode.toString(8)}`)
check('loading again returns the same token', auth.loadOrCreateToken(uhome) === t1)
fs.chmodSync(auth.tokenPath(uhome), 0o644)
auth.loadOrCreateToken(uhome)
check('loose permissions on an existing token file are tightened', (fs.statSync(auth.tokenPath(uhome)).mode & 0o777) === 0o600)
const guard = auth.tokenGuard(uhome)
await sleep(20)
const t2 = auth.rotateToken(uhome)
check('a running core accepts a rotated token and drops the old one', t2 !== t1 && guard.check(t2) && !guard.check(t1))
const pol = auth.localPolicy(47821, 47820)
check('Host policy: loopback names on the core and UI ports only', pol.hostOk('127.0.0.1:47821') && pol.hostOk('localhost:47820') && !pol.hostOk('evil.example:47821') && !pol.hostOk('127.0.0.1:9999'))
check('Origin policy: no Origin (CLI) or the app’s own origins only', pol.originOk(undefined) && pol.originOk('http://127.0.0.1:47820') && !pol.originOk('https://evil.example') && !pol.originOk('http://localhost:47822') && !pol.originOk('null'))

// ---- unit: SSRF guard, redaction --------------------------------------------------------------
const ng = await import('../packages/core/src/net-guard.ts')
check('private, loopback, link-local and metadata addresses are blocked', ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0'].every(ng.isPrivateAddress) && !ng.isPrivateAddress('93.184.216.34') && !ng.isPrivateAddress('2606:2800:220:1::'))
const act = await import('../packages/core/src/activity.ts')
check('credentials are redacted from log text', !act.redact('key sk-ant-api03-abcdefghijklmnop and Bearer abcdefghijklmnopqrstuvwxyz').includes('abcdefghijklmnop'))

// ---- unit: secret stores ---------------------------------------------------------------------
const sec = await import('../packages/core/src/secrets.ts')
const fakeBin = path.join(tmp, 'bin')
fs.mkdirSync(fakeBin)
const rec = path.join(tmp, 'security-calls.log')
// a stand-in for macOS `security`: records argv and stdin, keeps one password in a file
fs.writeFileSync(
  path.join(fakeBin, 'security'),
  `#!/bin/sh
echo "ARGV: $*" >> "${rec}"
store="${tmp}/fake-keychain"
if [ "$1" = "-i" ]; then
  line=$(cat); echo "STDIN: $line" >> "${rec}"
  printf '%s' "$line" | sed -E 's/.* -w "(.*)"$/\\1/' > "$store"; exit 0
fi
if [ "$1" = "find-generic-password" ]; then [ -f "$store" ] && cat "$store" && exit 0; exit 44; fi
if [ "$1" = "delete-generic-password" ]; then rm -f "$store"; exit 0; fi
exit 1
`,
  { mode: 0o755 },
)
const mac = sec.macKeychainStore(undefined, path.join(fakeBin, 'security'))
await mac.set('assistant.anthropic', 'sk-ant-TEST-"quoted"-value')
const got = await mac.get('assistant.anthropic')
const calls = fs.readFileSync(rec, 'utf8')
check('macOS Keychain: the secret goes through `security -i` stdin, never argv', calls.split('\n').filter((l) => l.startsWith('ARGV')).every((l) => !l.includes('sk-ant-TEST')) && calls.includes('STDIN: add-generic-password -U -s ai-figma -a assistant.anthropic'), calls.split('\n')[0])
check('macOS Keychain: round-trips the value (quotes escaped)', got === 'sk-ant-TEST-\\"quoted\\"-value' || got === 'sk-ant-TEST-"quoted"-value', got)
await mac.delete('assistant.anthropic')
check('macOS Keychain: delete removes it', (await mac.get('assistant.anthropic')) === null)
let nl = ''
await mac.set('x', 'a\nb').catch((e) => (nl = e.message))
check('secrets with line breaks are refused (no command injection into `security -i`)', nl.includes('line breaks'))
const sclog = new act.ActivityLog(null)
const audited = sec.auditedStore(sec.mockStore(), sclog)
await audited.set('assistant.openai', 'sk-proj-SECRETVALUE123456')
await audited.get('assistant.openai')
check('secret access is logged by name, never by value', sclog.list().length === 2 && !JSON.stringify(sclog.list()).includes('SECRETVALUE'), sclog.list().map((e) => `${e.action}:${e.target}`).join(', '))
check('memory / mock stores say they are not persistent', !sec.memoryStore().persistent && !sec.mockStore().osBacked && sec.openSecretStore('mock').backend === 'mock')

// ---- integration: a core with a mock secret store ---------------------------------------------------
const home = path.join(tmp, 'home')
const port = 48200 + Math.floor(Math.random() * 40) * 2
const base = `http://127.0.0.1:${port}`
const env = { ...process.env, AIFIG_HOME: home, AIFIG_CORE_PORT: String(port), AIFIG_SECRET_STORE: 'mock', AIFIG_PERMISSION_TIMEOUT_MS: '4000', AIFIG_AGENT_CONFIG_HOME: path.join(tmp, 'agent-home') }
delete env.AIFIG_TOKEN
const core = spawn(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'core', '--port', String(port)], { env, stdio: 'ignore' })
for (let i = 0; i < 100 && !(await fetch(`${base}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(100)
const token = fs.readFileSync(path.join(home, 'access-token'), 'utf8').trim()
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
const HUMAN = { id: 'human:sec', name: 'You', client: 'test', kind: 'human' }
const AGENT = { id: 'claude:sec', name: 'Claude Code', client: 'claude-code', kind: 'agent' }
const call = async (caller, tool, args, headers = H) => (await fetch(`${base}/api/call`, { method: 'POST', headers, body: JSON.stringify({ tool, args, caller }) })).json()
const raw = (opts, body) =>
  new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port, ...opts }, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: d }))
    })
    req.on('error', (e) => resolve({ status: 0, body: String(e) }))
    req.end(body)
  })

check('AIFIG_HOME is private to this user', process.platform === 'win32' || (fs.statSync(home).mode & 0o077) === 0, (fs.statSync(home).mode & 0o777).toString(8))
const unauth = await fetch(`${base}/api/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'list_boards', args: {}, caller: HUMAN }) })
check('an unauthenticated API request is rejected (401)', unauth.status === 401 && unauth.headers.get('www-authenticate')?.startsWith('Bearer'), `HTTP ${unauth.status}`)
const wrong = await fetch(`${base}/api/boards`, { headers: { authorization: `Bearer ${'x'.repeat(43)}` } })
check('a wrong token is rejected (401)', wrong.status === 401)
const setupNoToken = await Promise.all([fetch(`${base}/api/agents`), fetch(`${base}/api/agents/cursor/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })])
check('one-click agent setup (/api/agents…) needs the token', setupNoToken.every((r) => r.status === 401), setupNoToken.map((r) => r.status).join(', '))
check('the X-Aifig-Token header works too', (await fetch(`${base}/api/boards`, { headers: { 'x-aifig-token': token } })).status === 200)
const pub = await (await fetch(`${base}/api/health`)).json()
check('health without the token only says the core is up (no paths, token or MCP launch)', pub.ok && pub.authenticated === false && !pub.home && !pub.token && !pub.mcp, JSON.stringify(pub))
const priv = await (await fetch(`${base}/api/health`, { headers: H })).json()
check('health with the token has the details the Connect dialog needs', priv.authenticated && priv.token === token && !!priv.mcp && priv.secrets?.backend === 'mock')
const foreign = await raw({ path: '/api/boards', headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' } })
check('a foreign web page is refused even with the token (Origin check)', foreign.status === 403)
const rebinding = await raw({ path: '/api/boards', headers: { authorization: `Bearer ${token}`, host: `evil.example:${port}` } })
check('DNS rebinding is refused (Host check)', rebinding.status === 403)
const cors = await fetch(`${base}/api/boards`, { headers: H })
const pre = await raw({ method: 'OPTIONS', path: '/api/call', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
check('no CORS: responses carry no Access-Control-Allow-Origin, preflights are refused', !cors.headers.get('access-control-allow-origin') && pre.status === 403 && !pre.headers['access-control-allow-origin'])
check('the core only listens on 127.0.0.1', await fetch(`http://[::1]:${port}/api/health`).then(() => false, () => true))

// MCP over HTTP
const mcpNoAuth = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) })
check('MCP over HTTP without the token is rejected (401)', mcpNoAuth.status === 401)
const mcpHttp = new Client({ name: 'cursor-vscode', version: 'sec' })
await mcpHttp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
check('MCP over HTTP with the token works', (await mcpHttp.listTools()).tools.length > 15)

// WebSocket
const board = (await call(HUMAN, 'create_board', { title: 'Security check' })).result.board.id
const wsOpen = (protocols, headers) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/sync/${board}`, protocols)
    const t = setTimeout(() => resolve({ ok: false }), 3000)
    ws.onopen = () => (clearTimeout(t), resolve({ ok: true, ws, protocol: ws.protocol }))
    ws.onerror = () => (clearTimeout(t), resolve({ ok: false }))
  })
check('the sync WebSocket without the token is rejected', !(await wsOpen(['aifig'])).ok)
const wsBadOrigin = await raw({ path: `/sync/${board}`, headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-protocol': `aifig, aifig-token.${token}`, origin: 'https://evil.example' } })
check('the sync WebSocket from a foreign origin is rejected (403)', wsBadOrigin.status === 403, `HTTP ${wsBadOrigin.status}`)
const canvas = await wsOpen(['aifig', `aifig-token.${token}`])
check('the sync WebSocket with the token connects (subprotocol "aifig")', canvas.ok && canvas.protocol === 'aifig')

// permissions: an agent fetching an image by URL
const inbox = []
canvas.ws.onmessage = (e) => typeof e.data === 'string' && inbox.push(JSON.parse(e.data))
const waitFor = async (pred, ms = 3000) => {
  for (let i = 0; i < ms / 50; i++) {
    const m = inbox.find(pred)
    if (m) return m
    await sleep(50)
  }
  return null
}
const answer = (id, decision) => fetch(`${base}/api/permissions/answer`, { method: 'POST', headers: H, body: JSON.stringify({ id, decision }) }).then((r) => r.json())
const img = { board, url: 'http://127.0.0.1:9/pic.png' }

let pending = call(AGENT, 'add_image', img)
let prompt = await waitFor((m) => m.type === 'permission')
check('an agent fetching a URL triggers a permission prompt in the open canvas', prompt?.request?.capability === 'network' && prompt.request.target === '127.0.0.1:9' && prompt.request.actor.name === 'Claude Code' && prompt.request.source.id === 'add_image', JSON.stringify(prompt?.request))
await answer(prompt.request.id, 'deny')
let r = await pending
check('declining tells the agent not to retry', !r.ok && r.error.includes('declined'), r.error)

inbox.length = 0
pending = call(AGENT, 'add_image', img)
prompt = await waitFor((m) => m.type === 'permission')
await answer(prompt.request.id, 'allow-once')
r = await pending
check('allowed once, the SSRF guard still refuses loopback / private addresses', !r.ok && r.error.includes('local or private address'), r.error)

inbox.length = 0
pending = call(AGENT, 'add_image', { board, url: 'http://127.0.0.1:9/b.png' })
prompt = await waitFor((m) => m.type === 'permission')
r = await pending
check('an unanswered prompt times out as a denial', !r.ok && r.error.includes('not answered in time'), r.error)

r = await call(HUMAN, 'add_image', { board, url: 'http://169.254.169.254/latest/meta-data' })
check('people skip the prompt, but not the SSRF guard (cloud metadata address)', !r.ok && r.error.includes('local or private'), r.error)

canvas.ws.close()
await sleep(200)
r = await call(AGENT, 'add_image', img)
check('with no canvas open, the agent is told how to get permission', !r.ok && r.error.includes('Open the ai-figma canvas') && r.error.includes('aifig permissions allow agent:claude-code network 127.0.0.1:9'), r.error)

const cliAllow = spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'permissions', 'allow', 'agent:claude-code', 'network', '127.0.0.1:9'], { env, encoding: 'utf8' })
r = await call(AGENT, 'add_image', img)
const grants = JSON.parse(fs.readFileSync(path.join(home, 'permissions.json'), 'utf8')).grants
check('`aifig permissions allow` persists a grant (0600) that skips the prompt', cliAllow.status === 0 && grants.some((g) => g.subject === 'agent:claude-code' && g.target === '127.0.0.1:9') && (fs.statSync(path.join(home, 'permissions.json')).mode & 0o077) === 0 && r.error?.includes('local or private'), cliAllow.stderr || r.error)
const otherAgent = await call({ ...AGENT, id: 'cursor:1', name: 'Cursor', client: 'cursor' }, 'add_image', img)
check('grants are per agent: another agent still needs permission', !otherAgent.ok && otherAgent.error.includes('agent:cursor'), otherAgent.error)
spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'permissions', 'revoke', 'agent:claude-code'], { env })
check('`aifig permissions revoke` removes it', !(await (await fetch(`${base}/api/permissions`, { headers: H })).json()).grants.length)
const selfGrant = await call(AGENT, 'grant_permission', { subject: 'agent:claude-code' })
check('agents cannot grant themselves permissions through the tool surface', !selfGrant.ok)

// activity log
const log = (await (await fetch(`${base}/api/activity?limit=100`, { headers: H })).json()).entries
const actions = new Set(log.map((e) => `${e.category}:${e.action}:${e.outcome}`))
check('the activity log records prompts, denials, grants, revokes and rejected clients', ['permission:decide:denied', 'permission:decide:allowed', 'network:fetch:denied', 'permission:grant:ok', 'permission:revoke:ok', 'auth:reject:denied'].every((a) => actions.has(a)), [...actions].join(' '))
const logFile = fs.readFileSync(path.join(home, 'activity.jsonl'), 'utf8')
check('the activity log is persisted as JSONL (0600) without the token', logFile.split('\n').filter(Boolean).length >= log.length && !logFile.includes(token) && (fs.statSync(path.join(home, 'activity.jsonl')).mode & 0o077) === 0)
const cliLog = spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'activity', '-c', 'network'], { env, encoding: 'utf8' })
check('`aifig activity` shows the log', cliLog.status === 0 && cliLog.stdout.includes('fetch'), cliLog.stdout.split('\n')[0])

// secrets through the assistant settings (browser path)
const saved = await (await fetch(`${base}/api/assistant/settings`, { method: 'POST', headers: H, body: JSON.stringify({ provider: 'anthropic', key: 'sk-ant-api03-NEVER-ON-DISK-123456', model: 'claude-x' }) })).json()
const status = await (await fetch(`${base}/api/assistant/status`, { headers: H })).json()
const onDisk = fs.readdirSync(home, { recursive: true }).filter((f) => fs.statSync(path.join(home, f)).isFile()).map((f) => fs.readFileSync(path.join(home, f)).toString('latin1')).join('\n')
check('an API key saved from the canvas goes to the secret store, not to disk', saved.ok && saved.hasKey && status.available && !onDisk.includes('NEVER-ON-DISK') && JSON.parse(fs.readFileSync(path.join(home, 'assistant.json'), 'utf8')).key === undefined, JSON.stringify({ ok: saved.ok, error: saved.error, store: saved.store }))
check('the settings view never returns the key', !JSON.stringify(await (await fetch(`${base}/api/assistant/settings`, { headers: H })).json()).includes('NEVER-ON-DISK'))
check('with a non-persistent store, the save says it is session-only', saved.persisted === false && saved.store?.persistent === false)
const secretLog = (await (await fetch(`${base}/api/activity?category=secret`, { headers: H })).json()).entries
check('storing the key is in the activity log (by name)', secretLog.some((e) => e.action === 'store' && e.target === 'assistant.anthropic') && !JSON.stringify(secretLog).includes('NEVER-ON-DISK'))

// the bundled CLI / stdio MCP pick the token up by themselves
const cliBoards = spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'boards'], { env, encoding: 'utf8' })
check('the CLI authenticates automatically (reads AIFIG_HOME)', cliBoards.status === 0 && cliBoards.stdout.includes('Security check'), cliBoards.stderr)
const cliBad = spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'boards'], { env: { ...env, AIFIG_TOKEN: 'y'.repeat(43), AIFIG_NO_AUTOSTART: '1' }, encoding: 'utf8' })
check('the CLI explains a rejected token', cliBad.status !== 0 && cliBad.stderr.includes('rejected the access token'), cliBad.stderr.trim())
const stdio = new Client({ name: 'claude-code', version: 'sec' })
await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/aifig.mjs'), 'mcp'], env, stderr: 'ignore' }))
const lb = await stdio.callTool({ name: 'list_boards', arguments: {} })
check('the stdio MCP server authenticates automatically', !lb.isError && lb.content[0].text.includes('Security check'))
await stdio.close()
const link = spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'open', '--print'], { env, encoding: 'utf8' }).stdout.trim()
check('`aifig open --print` gives a signed-in link (token in the fragment)', link === `${base}/#token=${token}`, link.replace(token, '<token>'))

await mcpHttp.close()
core.kill()
await sleep(200)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} security check(s) failed` : '\nall security checks passed')
process.exit(failures ? 1 : 0)
