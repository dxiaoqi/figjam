import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * One-click MCP setup for agents installed on this machine: detect them, show whether ai-figma is configured,
 * add it (backup first, atomic, idempotent) and check that the configured command really speaks MCP.
 */

export const AGENT_IDS = ['claude', 'cursor'] as const
export type AgentId = (typeof AGENT_IDS)[number]
export const SERVER_NAME = 'ai-figma'

export interface McpLaunch {
  command: string
  args: string[]
  env?: Record<string, string>
}

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
  /** A config file we can't parse is never touched. */
  error?: string
}

/** Home folder for agent configs, and the PATH searched for their binaries. Tests point both somewhere disposable. */
const home = () => process.env.AIFIG_AGENT_CONFIG_HOME ?? os.homedir()

const AGENTS: Record<AgentId, { name: string; file: () => string; bins: string[]; dirs: () => string[]; entry: (l: McpLaunch) => Record<string, unknown> }> = {
  claude: {
    name: 'Claude Code',
    file: () => path.join(home(), '.claude.json'),
    bins: ['claude'],
    dirs: () => [path.join(home(), '.claude')],
    entry: (l) => ({ type: 'stdio', command: l.command, args: l.args, env: l.env ?? {} }),
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
  },
}

export const isAgentId = (v: unknown): v is AgentId => typeof v === 'string' && (AGENT_IDS as readonly string[]).includes(v)

function onPath(bin: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of (process.env.AIFIG_AGENT_PATH ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
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

/** Compare only what matters for launching (key order and empty env don't count). */
function sameLaunch(a: any, b: any) {
  if (!a || typeof a !== 'object') return false
  return a.command === b.command && same(a.args ?? [], b.args ?? []) && same(Object.entries(a.env ?? {}).sort(), Object.entries(b.env ?? {}).sort())
}

export function agentStatus(id: AgentId, launch: McpLaunch): AgentStatus {
  const def = AGENTS[id]
  const file = def.file()
  const cfg = readConfig(file)
  const bin = def.bins.map(onPath).find(Boolean) ?? null
  const dir = def.dirs().find((d) => fs.existsSync(d)) ?? null
  const current = cfg.data.mcpServers?.[SERVER_NAME]
  const state: ConfigState = !current ? 'missing' : sameLaunch(current, def.entry(launch)) ? 'configured' : 'different'
  return { id, name: def.name, installed: !!(bin || dir), foundAt: bin ?? dir, configFile: file, configExists: cfg.exists, state, ...(cfg.error ? { error: cfg.error } : {}) }
}

export const detectAgents = (launch: McpLaunch) => AGENT_IDS.map((id) => agentStatus(id, launch))

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** Add (or update) the ai-figma entry. Unchanged configs are left alone — no write, no backup. */
export function installAgent(id: AgentId, launch: McpLaunch): { changed: boolean; file: string; backup: string | null; status: AgentStatus } {
  const def = AGENTS[id]
  const file = def.file()
  const cfg = readConfig(file)
  if (cfg.error) throw new Error(`${file}: ${cfg.error} Fix it or use the manual setup.`)
  const entry = def.entry(launch)
  if (sameLaunch(cfg.data.mcpServers?.[SERVER_NAME], entry)) return { changed: false, file, backup: null, status: agentStatus(id, launch) }
  const next = { ...cfg.data, mcpServers: { ...(cfg.data.mcpServers ?? {}), [SERVER_NAME]: entry } }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let backup: string | null = null
  if (cfg.exists) {
    backup = `${file}.aifig-backup-${stamp()}`
    fs.copyFileSync(file, backup)
  }
  const indent = /^\{\n(\s+)/.exec(cfg.raw)?.[1] ?? '  '
  const tmp = `${file}.aifig-tmp-${process.pid}`
  const mode = cfg.exists ? fs.statSync(file).mode & 0o777 : 0o600
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, indent)}\n`, { mode })
  fs.renameSync(tmp, file)
  return { changed: true, file, backup, status: agentStatus(id, launch) }
}

/**
 * Launch the MCP server exactly as the agent's config says and do the MCP handshake (initialize → tools/list).
 * This checks what the agent will actually run, not what we meant to write.
 */
export async function testAgent(id: AgentId, timeoutMs = 20_000): Promise<{ ok: true; tools: number; server: string } | { ok: false; error: string }> {
  const def = AGENTS[id]
  const cfg = readConfig(def.file())
  const entry = cfg.data.mcpServers?.[SERVER_NAME]
  if (cfg.error) return { ok: false, error: cfg.error }
  if (!entry?.command) return { ok: false, error: `No "${SERVER_NAME}" entry in ${def.file()}.` }
  return new Promise((resolve) => {
    const child = spawn(entry.command, entry.args ?? [], { env: { ...process.env, ...(entry.env ?? {}), AIFIG_AGENT_NAME: `${def.name} (setup check)` }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let serverName = ''
    let settled = false
    const done = (r: Awaited<ReturnType<typeof testAgent>>) => {
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
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aifig-setup-check', version: '1' } } })
  })
}
