import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/**
 * One-click MCP setup for agents installed on this machine: detect them, show whether nodboard is configured,
 * add it (backup first, atomic, idempotent) and check that the configured server really speaks MCP. Two
 * transports: stdio (the agent launches the CLI) or local HTTP (the running core, with the access token).
 */

export const AGENT_IDS = ['claude', 'cursor'] as const
export type AgentId = (typeof AGENT_IDS)[number]
export const SERVER_NAME = 'nodboard'
/** Written into agent configs before the product was renamed. Install moves this entry to {@link SERVER_NAME}. */
export const LEGACY_SERVER_NAME = 'ai-figma'

export interface McpLaunch {
  command: string
  args: string[]
  env?: Record<string, string>
}

/** The core's MCP endpoint and the token an HTTP config must send. */
export interface McpHttp {
  url: string
  token: string
}

export const TRANSPORTS = ['stdio', 'http'] as const
export type Transport = (typeof TRANSPORTS)[number]
export const isTransport = (v: unknown): v is Transport => typeof v === 'string' && (TRANSPORTS as readonly string[]).includes(v)

export type ConfigState = 'configured' | 'different' | 'missing'

export interface AgentStatus {
  id: AgentId
  name: string
  installed: boolean
  /** Where it was found (binary or app folder), for the UI. */
  foundAt: string | null
  configFile: string
  configExists: boolean
  state: ConfigState
  /** How the existing entry connects (null when there is none). */
  transport: Transport | null
  /** A config file we can't parse is never touched. */
  error?: string
}

/** Home folder for agent configs, and the PATH searched for their binaries. Tests point both somewhere disposable. */
const home = () => process.env.NODBOARD_AGENT_CONFIG_HOME ?? os.homedir()

const bearer = (h: McpHttp) => ({ Authorization: `Bearer ${h.token}` })

const AGENTS: Record<AgentId, { name: string; file: () => string; bins: string[]; dirs: () => string[]; entry: (l: McpLaunch) => Record<string, unknown>; httpEntry: (h: McpHttp) => Record<string, unknown> }> = {
  claude: {
    name: 'Claude Code',
    file: () => path.join(home(), '.claude.json'),
    bins: ['claude'],
    dirs: () => [path.join(home(), '.claude')],
    entry: (l) => ({ type: 'stdio', command: l.command, args: l.args, env: l.env ?? {} }),
    httpEntry: (h) => ({ type: 'http', url: h.url, headers: bearer(h) }),
  },
  cursor: {
    name: 'Cursor',
    file: () => path.join(home(), '.cursor', 'mcp.json'),
    bins: ['cursor'],
    dirs: () => [
      path.join(home(), '.cursor'),
      '/Applications/Cursor.app',
      path.join(home(), 'Applications', 'Cursor.app'),
      ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'cursor')] : []),
    ],
    entry: (l) => ({ command: l.command, args: l.args, ...(l.env && Object.keys(l.env).length ? { env: l.env } : {}) }),
    httpEntry: (h) => ({ url: h.url, headers: bearer(h) }),
  },
}

export const isAgentId = (v: unknown): v is AgentId => typeof v === 'string' && (AGENT_IDS as readonly string[]).includes(v)

function onPath(bin: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of (process.env.NODBOARD_AGENT_PATH ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, bin + ext)
      try {
        if (fs.statSync(p).isFile()) return p
      } catch {
        /* keep looking */
      }
    }
  }
  return null
}

function readConfig(file: string): { exists: boolean; data: Record<string, any>; raw: string; error?: string } {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { exists: false, data: {}, raw: '' }
  }
  if (!raw.trim()) return { exists: true, data: {}, raw }
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { exists: true, data: {}, raw, error: 'The file is not a JSON object.' }
    return { exists: true, data, raw }
  } catch (e) {
    return { exists: true, data: {}, raw, error: `The file is not valid JSON (${(e as Error).message}).` }
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const authOf = (headers: unknown) => Object.entries((headers ?? {}) as Record<string, unknown>).find(([k]) => k.toLowerCase() === 'authorization')?.[1]

/** Compare only what matters for connecting (key order, empty env and other headers don't count). */
function sameEntry(a: any, b: any) {
  if (!a || typeof a !== 'object') return false
  if (b.url) return a.url === b.url && authOf(a.headers) === authOf(b.headers) && (a.type ?? b.type) === b.type
  return a.command === b.command && same(a.args ?? [], b.args ?? []) && same(Object.entries(a.env ?? {}).sort(), Object.entries(b.env ?? {}).sort())
}

const transportOf = (entry: any): Transport | null => (!entry || typeof entry !== 'object' ? null : entry.url ? 'http' : 'stdio')

/** Prefer the current MCP name. An older config still under {@link LEGACY_SERVER_NAME} counts as needing an update. */
function configuredEntry(servers: Record<string, any> | undefined): { entry: any; legacy: boolean } {
  if (servers?.[SERVER_NAME]) return { entry: servers[SERVER_NAME], legacy: false }
  if (servers?.[LEGACY_SERVER_NAME]) return { entry: servers[LEGACY_SERVER_NAME], legacy: true }
  return { entry: undefined, legacy: false }
}
const entryFor = (id: AgentId, transport: Transport, launch: McpLaunch, http: McpHttp) => (transport === 'http' ? AGENTS[id].httpEntry(http) : AGENTS[id].entry(launch))

export function agentStatus(id: AgentId, launch: McpLaunch, http: McpHttp): AgentStatus {
  const def = AGENTS[id]
  const file = def.file()
  const cfg = readConfig(file)
  const bin = def.bins.map(onPath).find(Boolean) ?? null
  const dir = def.dirs().find((d) => fs.existsSync(d)) ?? null
  const found = configuredEntry(cfg.data.mcpServers)
  const transport = transportOf(found.entry)
  const state: ConfigState = !transport ? 'missing' : found.legacy || !sameEntry(found.entry, entryFor(id, transport, launch, http)) ? 'different' : 'configured'
  return { id, name: def.name, installed: !!(bin || dir), foundAt: bin ?? dir, configFile: file, configExists: cfg.exists, state, transport, ...(cfg.error ? { error: cfg.error } : {}) }
}

export const detectAgents = (launch: McpLaunch, http: McpHttp) => AGENT_IDS.map((id) => agentStatus(id, launch, http))

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** Add (or update) the nodboard entry. Unchanged configs are left alone — no write, no backup. */
export function installAgent(id: AgentId, launch: McpLaunch, http: McpHttp, transport: Transport = 'stdio'): { changed: boolean; file: string; backup: string | null; status: AgentStatus } {
  const def = AGENTS[id]
  const file = def.file()
  const cfg = readConfig(file)
  if (cfg.error) throw new Error(`${file}: ${cfg.error} Fix it or use the manual setup.`)
  const entry = entryFor(id, transport, launch, http)
  const servers = { ...(cfg.data.mcpServers ?? {}) }
  const legacy = servers[LEGACY_SERVER_NAME]
  if (sameEntry(servers[SERVER_NAME], entry) && legacy == null) return { changed: false, file, backup: null, status: agentStatus(id, launch, http) }
  delete servers[LEGACY_SERVER_NAME]
  const next = { ...cfg.data, mcpServers: { ...servers, [SERVER_NAME]: entry } }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let backup: string | null = null
  if (cfg.exists) {
    backup = `${file}.nodboard-backup-${stamp()}`
    fs.copyFileSync(file, backup)
  }
  const indent = /^\{\n(\s+)/.exec(cfg.raw)?.[1] ?? '  '
  const tmp = `${file}.nodboard-tmp-${process.pid}`
  // an HTTP entry carries the access token: keep the file (and its backup) readable by this user only
  const existing = cfg.exists ? fs.statSync(file).mode & 0o777 : 0o600
  const mode = transport === 'http' ? existing & 0o700 : existing
  if (backup && transport === 'http') fs.chmodSync(backup, mode)
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, indent)}\n`, { mode })
  fs.chmodSync(tmp, mode)
  fs.renameSync(tmp, file)
  return { changed: true, file, backup, status: agentStatus(id, launch, http) }
}

type TestResult = { ok: true; tools: number; server: string } | { ok: false; error: string }

/** MCP handshake over Streamable HTTP with the URL and headers from the agent's config. */
async function testHttp(entry: { url: string; headers?: Record<string, string> }, timeoutMs: number): Promise<TestResult> {
  const client = new Client({ name: 'nodboard-setup-check', version: '1' })
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers ?? {}, signal } }))
    const { tools } = await client.listTools()
    return { ok: true, tools: tools.length, server: client.getServerVersion()?.name ?? '' }
  } catch (e) {
    const msg = (e as Error).message
    return { ok: false, error: signal.aborted ? `No MCP answer within ${timeoutMs / 1000}s.` : /401|token/i.test(msg) ? 'The access token in the config was rejected — update the setup.' : msg }
  } finally {
    await client.close().catch(() => {})
  }
}

/**
 * Connect exactly as the agent's config says and do the MCP handshake (initialize → tools/list): launch the
 * command (stdio) or call the URL with its headers (HTTP). This checks what the agent will actually use, not
 * what we meant to write.
 */
export async function testAgent(id: AgentId, timeoutMs = 20_000): Promise<TestResult> {
  const def = AGENTS[id]
  const cfg = readConfig(def.file())
  const entry = configuredEntry(cfg.data.mcpServers).entry
  if (cfg.error) return { ok: false, error: cfg.error }
  if (typeof entry?.url === 'string') return testHttp(entry, timeoutMs)
  if (!entry?.command) return { ok: false, error: `No "${SERVER_NAME}" entry in ${def.file()}.` }
  return new Promise((resolve) => {
    const child = spawn(entry.command, entry.args ?? [], { env: { ...process.env, ...(entry.env ?? {}), NODBOARD_AGENT_NAME: `${def.name} (setup check)` }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let serverName = ''
    let settled = false
    const done = (r: TestResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: `No MCP answer within ${timeoutMs / 1000}s.${err ? ` ${err.trim().split('\n').pop()}` : ''}` }), timeoutMs)
    const send = (msg: unknown) => child.stdin.write(`${JSON.stringify(msg)}\n`)
    child.on('error', (e) => done({ ok: false, error: `Couldn’t run ${entry.command}: ${e.message}` }))
    child.on('exit', (code) => done({ ok: false, error: `The server exited (code ${code}).${err ? ` ${err.trim().split('\n').pop()}` : ''}` }))
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    child.stdout.on('data', (d) => {
      out += d
      let nl
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl).trim()
        out = out.slice(nl + 1)
        if (!line) continue
        let msg: any
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 1) {
          if (msg.error) return done({ ok: false, error: msg.error.message })
          serverName = msg.result?.serverInfo?.name ?? ''
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        } else if (msg.id === 2) {
          if (msg.error) return done({ ok: false, error: msg.error.message })
          done({ ok: true, tools: msg.result?.tools?.length ?? 0, server: serverName })
        }
      }
    })
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nodboard-setup-check', version: '1' } } })
  })
}
