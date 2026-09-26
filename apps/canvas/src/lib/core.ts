import type { BoardSummary } from '@aifig/shared'
import type { AnyToolName, CallResponse, CallerInfo } from '@aifig/shared'
import { apiFetch } from './auth'

export const HUMAN: CallerInfo = { id: 'human:ui', name: 'You', client: 'ui', kind: 'human' }

export async function callCore<T = any>(tool: AnyToolName, args: Record<string, unknown> = {}): Promise<T> {
  const r = await apiFetch('/api/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, args, caller: HUMAN }),
  })
  const body = (await r.json()) as CallResponse
  if (!body.ok) throw new Error(body.error)
  return body.result as T
}

export interface Health {
  ok: boolean
  home: string
  bin: string
  pid: number
  mcp?: { command: string; args: string[]; env?: Record<string, string> }
  mcpUrl?: string
  /** only in authenticated health answers, for the Connect dialog */
  token?: string
  secrets?: { backend: string; persistent: boolean; osBacked: boolean }
  snippetOrigin?: string | null
}

export class Unauthorized extends Error {
  constructor() {
    super('The core needs its access token')
  }
}

export async function fetchHealth(): Promise<Health> {
  const r = await apiFetch('/api/health', { signal: AbortSignal.timeout(2000) })
  if (!r.ok) throw new Error(`core answered ${r.status}`)
  const h = await r.json()
  if (h.authenticated === false) throw new Unauthorized()
  return h
}

export async function fetchBoards(): Promise<{ boards: BoardSummary[]; active: string | null }> {
  const r = await apiFetch('/api/boards', { signal: AbortSignal.timeout(2000) })
  if (r.status === 401) throw new Unauthorized()
  if (!r.ok) throw new Error(`core answered ${r.status}`)
  return r.json()
}

const q = (s: string) => (/[\s"']/.test(s) ? JSON.stringify(s) : s)

export function mcpSnippets(health: Health | null) {
  const bin = health?.bin ?? '/path/to/ai-figma/bin/aifig.mjs'
  const launch = health?.mcp ?? { command: 'node', args: [bin, 'mcp'] }
  const env = launch.env ?? {}
  const envFlags = Object.entries(env).map(([k, v]) => `-e ${k}=${q(v)}`).join(' ')
  const url = health?.mcpUrl ?? 'http://127.0.0.1:47821/mcp'
  const token = health?.token ?? '<run: aifig token>'
  const headers = { Authorization: `Bearer ${token}` }
  const cliRun = launch.command === 'node' ? `node ${q(bin)}` : `${Object.entries(env).map(([k, v]) => `${k}=${q(v)}`).join(' ')} ${q(launch.command)} ${q(bin)}`
  return {
    claude: `claude mcp add ai-figma ${envFlags ? `${envFlags} ` : ''}-- ${[launch.command, ...launch.args].map(q).join(' ')}`,
    cursor: JSON.stringify({ mcpServers: { 'ai-figma': { command: launch.command, args: launch.args, ...(Object.keys(env).length ? { env } : {}) } } }, null, 2),
    claudeHttp: `claude mcp add --transport http ai-figma ${url} --header ${q(`Authorization: Bearer ${token}`)}`,
    cursorHttp: JSON.stringify({ mcpServers: { 'ai-figma': { url, headers } } }, null, 2),
    cli: `${cliRun} add "First idea" "Second idea" --frame "Ideas"`,
    url,
  }
}
