import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { TOKEN_FILE, WS_PROTOCOL, WS_TOKEN_PREFIX } from '@nodboard/shared'

/**
 * Per-install local access token. Everything that talks to the core (canvas, desktop shell, CLI, MCP over
 * stdio or HTTP) presents it; the core rejects anything else. Kept dependency-free so the CLI can import it
 * without loading the whole core.
 */

export function homeDir() {
  if (process.env.NODBOARD_HOME) return process.env.NODBOARD_HOME
  if (process.env.AIFIG_HOME) return process.env.AIFIG_HOME
  const next = path.join(os.homedir(), '.nodboard')
  const prev = path.join(os.homedir(), '.aifig')
  if (fs.existsSync(next)) return next
  if (fs.existsSync(prev)) return prev
  return next
}
export const tokenPath = (home = homeDir()) => path.join(home, TOKEN_FILE)

const newToken = () => randomBytes(32).toString('base64url')
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

/** Read the token if present (env `NODBOARD_TOKEN` wins). Never creates one. */
export function readToken(home = homeDir()): string | null {
  const env = (process.env.NODBOARD_TOKEN ?? process.env.AIFIG_TOKEN)?.trim()
  if (env) return env
  try {
    const t = fs.readFileSync(tokenPath(home), 'utf8').trim()
    return TOKEN_RE.test(t) ? t : null
  } catch {
    return null
  }
}

function writeTokenFile(file: string, token: string, flag: 'wx' | 'w') {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  if (flag === 'w') {
    // replace atomically so a reader never sees a half-written token
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${token}\n`, { mode: 0o600 })
    fs.renameSync(tmp, file)
  } else fs.writeFileSync(file, `${token}\n`, { mode: 0o600, flag })
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600)
}

/** Load the token, creating it (0600) on first run and tightening loose permissions on an existing file. */
export function loadOrCreateToken(home = homeDir()): string {
  const env = (process.env.NODBOARD_TOKEN ?? process.env.AIFIG_TOKEN)?.trim()
  if (env) return env
  const file = tokenPath(home)
  const existing = readToken(home)
  if (existing) {
    if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077) !== 0) fs.chmodSync(file, 0o600)
    return existing
  }
  try {
    writeTokenFile(file, newToken(), fs.existsSync(file) ? 'w' : 'wx')
  } catch (e) {
    // another process created it first
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  const t = readToken(home)
  if (!t) throw new Error(`Could not create the access token at ${file}`)
  return t
}

/** Replace the token. Running cores pick up the new one on the next request that presents it. */
export function rotateToken(home = homeDir()): string {
  const t = newToken()
  writeTokenFile(tokenPath(home), t, 'w')
  return t
}

export function tokensEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Token from `Authorization: Bearer …`, `X-Nodboard-Token`, or (WebSocket upgrades) the offered subprotocols. */
export function presentedToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  const h = req.headers['x-nodboard-token'] ?? req.headers['x-aifig-token']
  if (typeof h === 'string' && h) return h.trim()
  const protos = req.headers['sec-websocket-protocol']
  if (typeof protos === 'string') {
    const p = protos.split(',').map((s) => s.trim()).find((s) => s.startsWith(WS_TOKEN_PREFIX) || s.startsWith('aifig-token.'))
    if (p) return p.slice(p.startsWith(WS_TOKEN_PREFIX) ? WS_TOKEN_PREFIX.length : 'aifig-token.'.length)
  }
  return null
}

export const selectWsProtocol = (protocols: Set<string>) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : protocols.has('aifig') ? 'aifig' : false)

/**
 * Hosts and origins the core answers to: loopback names on its own port and the dev UI port (the Vite proxy
 * forwards the browser's Host/Origin). Anything else is DNS rebinding or a foreign web page.
 */
export function localPolicy(corePort: number, uiPort = Number(process.env.NODBOARD_UI_PORT ?? 47820)) {
  const ports = [...new Set([corePort, uiPort])]
  const names = ['127.0.0.1', 'localhost', '[::1]']
  const hosts = new Set(ports.flatMap((p) => names.map((n) => `${n}:${p}`)))
  const origins = new Set([...hosts].map((h) => `http://${h}`))
  return {
    hosts,
    origins,
    hostOk: (host: string | undefined) => !!host && hosts.has(host.toLowerCase()),
    /** No Origin = not a browser (CLI, MCP clients, Electron main); those still need the token. */
    originOk: (origin: string | undefined) => !origin || origins.has(origin.toLowerCase()),
  }
}

/** Token checker that notices rotation (the file changed) without restarting the core. */
export function tokenGuard(home = homeDir()) {
  let token = loadOrCreateToken(home)
  let mtime = 0
  const stamp = () => {
    try {
      return fs.statSync(tokenPath(home)).mtimeMs
    } catch {
      return 0
    }
  }
  mtime = stamp()
  return {
    get token() {
      return token
    },
    check(presented: string | null) {
      if (tokensEqual(presented, token)) return true
      if (!presented || process.env.NODBOARD_TOKEN) return false
      const m = stamp()
      if (m === mtime) return false
      mtime = m
      token = readToken(home) ?? token
      return tokensEqual(presented, token)
    },
  }
}
