import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { WebSocketServer, type WebSocket } from 'ws'
import * as syncProtocol from 'y-protocols/sync'
import type { ClientMessage, ServerMessage } from '@aifig/shared'
import { CORE_PORT, type CallRequest } from '@aifig/shared'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { CanvasCore } from './api'
import { buildMcpServer } from './mcp'
import { aifigHome, type Board } from './board'

const MSG_SYNC = 0

interface Conn {
  ws: WebSocket
  board: Board
}

function send(ws: WebSocket, data: Uint8Array | string) {
  if (ws.readyState === ws.OPEN) ws.send(data)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

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
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' })
      return res.end()
    }
    try {
      if (url.pathname === '/api/health') {
        return json(res, 200, { ok: true, name: 'aifig-core', home: aifigHome(), bin: binPath, mcp: mcpLaunch, mcpUrl: `http://127.0.0.1:${port}/mcp`, boards: core.registry.all().length, pid: process.pid })
      }
      if (url.pathname === '/api/boards' && req.method === 'GET') {
        return json(res, 200, { boards: core.registry.all().map((b) => b.summary()), active: core.activeBoardId })
      }
      if (url.pathname === '/api/call' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as CallRequest
        if (!body.caller) body.caller = { id: 'anonymous', name: 'Agent', client: 'http', kind: 'agent' }
        return json(res, 200, await core.call(body))
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
        const rel = url.pathname === '/' ? '/index.html' : url.pathname
        let file = path.join(distDir, path.normalize(rel))
        if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
        return fs.createReadStream(file).pipe(res)
      }
      json(res, 404, { ok: false, error: 'Not found' })
    } catch (e) {
      json(res, 500, { ok: false, error: (e as Error).message })
    }
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const m = (req.url ?? '').match(/^\/sync\/([^/?#]+)/)
    const board = m ? core.registry.get(decodeURIComponent(m[1])) : undefined
    if (!board) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn: Conn = { ws, board }
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
            if (msg.type === 'viewport') core.setViewport(board.id, msg.bounds)
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
      ws.on('close', () => conns.delete(conn))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  fs.mkdirSync(aifigHome(), { recursive: true })
  fs.writeFileSync(path.join(aifigHome(), 'core.json'), JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }))

  const shutdown = () => {
    core.registry.flush()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  return { core, server, port }
}
