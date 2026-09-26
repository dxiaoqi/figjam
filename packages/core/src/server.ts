import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { WebSocketServer, type WebSocket } from 'ws'
import * as syncProtocol from 'y-protocols/sync'
import type { CallerInfo, Capability, ClientMessage, PermissionDecision, ServerMessage } from '@aifig/shared'
import { CAPABILITIES, CORE_PORT, SNIPPET_PORT, snippetOrigin, type CallRequest } from '@aifig/shared'
import { startSnippetHost } from './snippet-host'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { CanvasCore } from './api'
import { buildMcpServer } from './mcp'
import { ActivityLog } from './activity'
import { Assistant } from './assistant'
import { localPolicy, presentedToken, selectWsProtocol, tokenGuard } from './auth'
import { aifigHome, type Board } from './board'
import { PermissionBroker } from './permissions'
import { auditedStore, openSecretStore } from './secrets'
import { installFlushOnExit } from './safety'

const MSG_SYNC = 0

interface Conn {
  ws: WebSocket
  board: Board
}

function send(ws: WebSocket, data: Uint8Array | string) {
  if (ws.readyState === ws.OPEN) ws.send(data)
}

const MAX_BODY = 40 * 1024 * 1024

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > MAX_BODY) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

// No CORS headers: only the canvas (same origin, or via the dev proxy) and non-browser clients talk to the core.
function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(JSON.stringify(body))
}

const APP_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
}

const PERSON: CallerInfo = { id: 'human:ui', name: 'You', client: 'ui', kind: 'human' }

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

export async function startCore(port = CORE_PORT) {
  const core = new CanvasCore()
  core.init()
  const home = aifigHome()
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  // boards, the token, grants and the activity log live here: keep other OS users out
  if (process.platform !== 'win32') fs.chmodSync(home, 0o700)
  const guard = tokenGuard(home)
  const policy = localPolicy(port)
  const activity = ActivityLog.at(home)
  const permissions = PermissionBroker.at(home, activity)
  const secrets = auditedStore(openSecretStore(), activity)
  core.security = { permissions, activity }
  const assistant = new Assistant(core, secrets, activity, Assistant.settingsPath(home))
  await assistant.load()
  const snippets = await startSnippetHost(core.registry, port === CORE_PORT ? SNIPPET_PORT : port + 1)
  const conns = new Set<Conn>()
  const bound = new WeakSet<Board>()

  const bindBoard = (board: Board) => {
    if (bound.has(board)) return
    bound.add(board)
    board.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      const msg = encoding.toUint8Array(enc)
      for (const c of conns) if (c.board === board && c !== origin) send(c.ws, msg)
    })
  }
  core.registry.all().forEach(bindBoard)
  core.registry.onBoardAdded = bindBoard

  const broadcastPresence = () => {
    const msg: ServerMessage = { type: 'presence', agents: core.presence.list() }
    const s = JSON.stringify(msg)
    for (const c of conns) send(c.ws, s)
  }
  core.presence.onChange = broadcastPresence
  const broadcast = (msg: ServerMessage) => {
    const s = JSON.stringify(msg)
    for (const c of conns) send(c.ws, s)
  }
  permissions.prompter = {
    available: () => conns.size > 0,
    show: (request) => broadcast({ type: 'permission', request }),
    settled: (id, decision) => broadcast({ type: 'permission-settled', id, decision }),
  }
  activity.onRecord((entry) => broadcast({ type: 'activity', entry }))

  /** Host (DNS rebinding), Origin (foreign pages) and the access token, for every API / MCP / sync request. */
  const gate = (req: http.IncomingMessage, surface: string): { status: number; error: string } | null => {
    const deny = (status: number, error: string, why: string) => {
      if (surface !== 'health' || why !== 'token') activity.record(
        { category: 'auth', action: 'reject', outcome: 'denied', actor: { id: 'unknown', name: 'Unknown client', client: 'unknown', kind: 'agent' }, target: surface, via: why, detail: req.headers.origin ? `origin ${req.headers.origin}` : undefined },
        { throttleKey: `${surface}:${why}:${req.headers.origin ?? ''}` },
      )
      return { status, error }
    }
    if (!policy.hostOk(req.headers.host)) return deny(403, 'Forbidden host', 'host')
    if (!policy.originOk(req.headers.origin)) return deny(403, 'Forbidden origin', 'origin')
    if (!guard.check(presentedToken(req))) return deny(401, 'Missing or invalid ai-figma access token. Run `aifig token` to see it.', 'token')
    return null
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
  const distDir = process.env.AIFIG_UI_DIST ?? path.join(root, 'apps', 'canvas', 'dist')
  const binPath = process.env.AIFIG_BIN ?? path.join(root, 'bin', 'aifig.mjs')
  const json_ = (v?: string) => (v ? JSON.parse(v) : undefined)
  const mcpLaunch = process.env.AIFIG_MCP_COMMAND
    ? { command: process.env.AIFIG_MCP_COMMAND, args: json_(process.env.AIFIG_MCP_ARGS) ?? [binPath, 'mcp'], env: json_(process.env.AIFIG_MCP_ENV) }
    : { command: 'node', args: [binPath, 'mcp'] }

  // MCP over local HTTP (Streamable HTTP), alongside stdio
  const mcpSessions = new Map<string, StreamableHTTPServerTransport>()
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  const handleMcp = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const denied = gate(req, 'mcp')
    if (denied) return json(res, denied.status, { jsonrpc: '2.0', error: { code: -32001, message: denied.error }, id: null }, denied.status === 401 ? { 'www-authenticate': 'Bearer realm="ai-figma"' } : {})
    const sid = req.headers['mcp-session-id'] as string | undefined
    let body: unknown
    if (req.method === 'POST') {
      const raw = await readBody(req)
      body = raw ? JSON.parse(raw) : undefined
    }
    let transport = sid ? mcpSessions.get(sid) : undefined
    if (!transport) {
      if (req.method !== 'POST' || !isInitializeRequest(body)) return json(res, sid ? 404 : 400, { jsonrpc: '2.0', error: { code: -32000, message: sid ? 'Unknown MCP session' : 'Start with an initialize request' }, id: null })
      const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: true,
        allowedHosts: hosts,
        onsessioninitialized: (id) => {
          mcpSessions.set(id, t)
        },
      })
      const short = randomUUID().slice(0, 6)
      const { server: mcp, caller } = buildMcpServer((tool, args, who) => core.call({ tool, args, caller: who }), (client) => ({ id: `${client}:http:${short}`, name: '', client, kind: 'agent' }))
      t.onclose = () => {
        if (t.sessionId) mcpSessions.delete(t.sessionId)
        core.presence.leave(caller().id)
      }
      await mcp.connect(t)
      transport = t
    }
    await transport.handleRequest(req, res, body)
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/mcp') {
      try {
        return await handleMcp(req, res)
      } catch (e) {
        if (!res.headersSent) json(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: (e as Error).message }, id: null })
        return
      }
    }
    if (req.method === 'OPTIONS') {
      // no cross-origin access; same-origin requests never preflight
      res.writeHead(403, { 'cache-control': 'no-store' })
      return res.end()
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        const denied = gate(req, url.pathname === '/api/health' ? 'health' : 'api')
        // liveness stays answerable without the token (for clients deciding whether to start a core); details don't
        if (denied && url.pathname === '/api/health' && denied.status === 401) return json(res, 200, { ok: true, name: 'aifig-core', auth: 'token', authenticated: false })
        if (denied) return json(res, denied.status, { ok: false, error: denied.error }, denied.status === 401 ? { 'www-authenticate': 'Bearer realm="ai-figma"' } : {})
      }
      if (url.pathname === '/api/health') {
        return json(res, 200, { ok: true, name: 'aifig-core', auth: 'token', authenticated: true, home, bin: binPath, mcp: mcpLaunch, mcpUrl: `http://127.0.0.1:${port}/mcp`, token: guard.token, snippetOrigin: snippets.ok ? snippetOrigin(snippets.port) : null, boards: core.registry.all().length, pid: process.pid, secrets: { backend: secrets.backend, persistent: secrets.persistent, osBacked: secrets.osBacked } })
      }
      if (url.pathname === '/api/activity' && req.method === 'GET') {
        const category = url.searchParams.get('category') ?? undefined
        return json(res, 200, { entries: activity.list({ limit: Number(url.searchParams.get('limit') ?? 200), category: category as never }) })
      }
      if (url.pathname === '/api/permissions' && req.method === 'GET') return json(res, 200, { pending: permissions.pending(), grants: permissions.grants() })
      if (url.pathname === '/api/permissions/answer' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { id?: string; decision?: PermissionDecision }
        if (!['allow-once', 'allow-always', 'deny'].includes(body.decision ?? '')) return json(res, 400, { ok: false, error: 'decision must be allow-once, allow-always or deny' })
        return json(res, 200, { ok: permissions.answer(String(body.id ?? ''), body.decision!) })
      }
      if ((url.pathname === '/api/permissions/grant' || url.pathname === '/api/permissions/revoke') && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { subject?: string; capability?: Capability; target?: string; actor?: CallerInfo }
        const subject = String(body.subject ?? '')
        if (!/^(agent|skill):[\w.@-]+$/.test(subject)) return json(res, 400, { ok: false, error: 'subject must look like agent:<client> or skill:<id>' })
        if (body.capability && !(body.capability in CAPABILITIES)) return json(res, 400, { ok: false, error: `capability must be one of ${Object.keys(CAPABILITIES).join(', ')}` })
        const actor = body.actor?.kind === 'human' ? body.actor : PERSON
        if (url.pathname.endsWith('/grant')) {
          if (!body.capability || !body.target) return json(res, 400, { ok: false, error: 'capability and target are required' })
          permissions.grant(subject, body.capability, String(body.target), actor)
          return json(res, 200, { ok: true, grants: permissions.grants() })
        }
        return json(res, 200, { ok: true, removed: permissions.revoke(subject, body.capability, body.target, actor), grants: permissions.grants() })
      }
      if (url.pathname === '/api/assistant/settings' && req.method === 'GET') return json(res, 200, assistant.settings())
      if (url.pathname === '/api/assistant/settings' && req.method === 'POST') {
        try {
          const r = await assistant.save(JSON.parse((await readBody(req)) || '{}'), PERSON)
          return json(res, 200, { ok: true, ...r, ...assistant.settings() })
        } catch (e) {
          return json(res, 200, { ok: false, error: (e as Error).message })
        }
      }
      if (url.pathname === '/api/boards' && req.method === 'GET') {
        return json(res, 200, { boards: core.registry.all().map((b) => b.summary()), active: core.activeBoardId })
      }
      if (url.pathname === '/api/call' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as CallRequest
        if (!body.caller) body.caller = { id: 'anonymous', name: 'Agent', client: 'http', kind: 'agent' }
        return json(res, 200, await core.call(body))
      }
      if (url.pathname === '/api/assistant/status') return json(res, 200, assistant.status())
      if (url.pathname === '/api/assistant/config' && req.method === 'POST') {
        // the desktop shell hands over settings from safeStorage; they stay in memory here
        assistant.configure(JSON.parse((await readBody(req)) || '{}'))
        return json(res, 200, { ok: true, ...assistant.status() })
      }
      if (url.pathname === '/api/assistant/run' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}')
        try {
          return json(res, 200, { ok: true, result: await assistant.run(body.board, body.command, body.ids ?? []) })
        } catch (e) {
          return json(res, 200, { ok: false, error: (e as Error).message })
        }
      }
      if (url.pathname === '/api/agent/leave' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}')
        core.presence.leave(String(body.id ?? ''))
        return json(res, 200, { ok: true })
      }
      const exp = url.pathname.match(/^\/api\/boards\/([^/]+)\/export\.(json|md)$/)
      if (exp) {
        const r = await core.call({ tool: 'export_board', args: { board: exp[1], format: exp[2] === 'md' ? 'markdown' : 'json', frame: url.searchParams.get('frame') ?? undefined }, caller: { id: 'http', name: 'Viewer', client: 'http', kind: 'human' } })
        if (!r.ok) return json(res, 404, r)
        const out = r.result as { content: string; filename: string }
        res.writeHead(200, { 'content-type': exp[2] === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}` })
        return res.end(out.content)
      }
      const vprev = url.pathname.match(/^\/api\/boards\/([^/]+)\/versions\/([^/]+)\/preview\.svg$/)
      if (vprev) {
        const svg = await core.versionPreview(decodeURIComponent(vprev[1]), decodeURIComponent(vprev[2]), url.searchParams.get('theme') === 'dark' ? 'dark' : 'light')
        if (!svg) return json(res, 404, { ok: false, error: 'No such version' })
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=31536000, immutable' })
        return res.end(svg)
      }
      const snap = url.pathname.match(/^\/api\/boards\/([^/]+)\/snapshot\.(png|svg)$/)
      if (snap) {
        const r = await core.call({
          tool: 'render_snapshot',
          args: {
            board: snap[1],
            format: snap[2],
            theme: url.searchParams.get('theme') ?? 'light',
            frame: url.searchParams.get('frame') ?? undefined,
            ids: url.searchParams.get('ids')?.split(',').filter(Boolean) || undefined,
          },
          caller: { id: 'http', name: 'Viewer', client: 'http', kind: 'human' },
        })
        if (!r.ok) return json(res, 404, r)
        if (snap[2] === 'svg') {
          res.writeHead(200, { 'content-type': 'image/svg+xml' })
          return res.end((r.result as any).svg)
        }
        res.writeHead(200, { 'content-type': 'image/png' })
        return res.end(Buffer.from(r.image!.data, 'base64'))
      }
      // built canvas app (npm run build) — optional single-process mode
      if (req.method === 'GET' && fs.existsSync(distDir)) {
        if (!policy.hostOk(req.headers.host)) return json(res, 403, { ok: false, error: 'Forbidden host' })
        const rel = url.pathname === '/' ? '/index.html' : url.pathname
        let file = path.join(distDir, path.normalize(rel))
        if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', ...APP_HEADERS })
        return fs.createReadStream(file).pipe(res)
      }
      json(res, 404, { ok: false, error: 'Not found' })
    } catch (e) {
      json(res, 500, { ok: false, error: (e as Error).message })
    }
  })

  const wss = new WebSocketServer({ noServer: true, handleProtocols: selectWsProtocol })
  server.on('upgrade', (req, socket, head) => {
    const denied = gate(req, 'sync')
    if (denied) {
      socket.write(`HTTP/1.1 ${denied.status} ${denied.status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`)
      return socket.destroy()
    }
    const m = (req.url ?? '').match(/^\/sync\/([^/?#]+)/)
    const board = m ? core.registry.get(decodeURIComponent(m[1])) : undefined
    if (!board) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn: Conn = { ws, board }
      const connId = Math.random().toString(36).slice(2)
      conns.add(conn)
      ws.binaryType = 'arraybuffer'
      // step 1 + full state so the client renders immediately
      const e1 = encoding.createEncoder()
      encoding.writeVarUint(e1, MSG_SYNC)
      syncProtocol.writeSyncStep1(e1, board.doc)
      send(ws, encoding.toUint8Array(e1))
      const e2 = encoding.createEncoder()
      encoding.writeVarUint(e2, MSG_SYNC)
      syncProtocol.writeSyncStep2(e2, board.doc)
      send(ws, encoding.toUint8Array(e2))
      send(ws, JSON.stringify({ type: 'presence', agents: core.presence.list() } satisfies ServerMessage))

      ws.on('message', (data, isBinary) => {
        try {
          if (!isBinary) {
            const msg = JSON.parse(data.toString()) as ClientMessage
            if (msg.type === 'viewport') core.setViewport(board.id, msg.bounds, connId, msg.focused !== false)
            return
          }
          const buf = new Uint8Array(data as ArrayBuffer)
          const dec = decoding.createDecoder(buf)
          const type = decoding.readVarUint(dec)
          if (type !== MSG_SYNC) return
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, MSG_SYNC)
          syncProtocol.readSyncMessage(dec, enc, board.doc, conn)
          if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
        } catch (e) {
          console.error('[core] bad message', e)
        }
      })
      ws.on('close', () => {
        conns.delete(conn)
        core.canvasClosed(connId)
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  fs.writeFileSync(path.join(home, 'core.json'), JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }))

  installFlushOnExit(() => core.registry.flush())
  return { core, server, port, token: guard.token, activity, permissions, secrets }
}
