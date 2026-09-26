import type { BoardSummary } from '@aifig/shared'
import type { AnyToolName, CallResponse, CallerInfo } from '@aifig/shared'

export const HUMAN: CallerInfo = { id: 'human:ui', name: 'You', client: 'ui', kind: 'human' }

export async function callCore<T = any>(tool: AnyToolName, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch('/api/call', {
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
  snippetOrigin?: string | null
}

export async function fetchHealth(): Promise<Health> {
  const r = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
  if (!r.ok) throw new Error(`core answered ${r.status}`)
  return r.json()
}

export async function fetchBoards(): Promise<{ boards: BoardSummary[]; active: string | null }> {
  const r = await fetch('/api/boards', { signal: AbortSignal.timeout(2000) })
  if (!r.ok) throw new Error(`core answered ${r.status}`)
  return r.json()
}

const q = (s: string) => (/[\s"']/.test(s) ? JSON.stringify(s) : s)

export function mcpSnippets(health: Health | null, example: [string, string, string] = ['First idea', 'Second idea', 'Ideas']) {
  const bin = health?.bin ?? '/path/to/ai-figma/bin/aifig.mjs'
  const launch = health?.mcp ?? { command: 'node', args: [bin, 'mcp'] }
  const env = launch.env ?? {}
  const envFlags = Object.entries(env).map(([k, v]) => `-e ${k}=${q(v)}`).join(' ')
  const url = health?.mcpUrl ?? 'http://127.0.0.1:47821/mcp'
  const cliRun = launch.command === 'node' ? `node ${q(bin)}` : `${Object.entries(env).map(([k, v]) => `${k}=${q(v)}`).join(' ')} ${q(launch.command)} ${q(bin)}`
  return {
    claude: `claude mcp add ai-figma ${envFlags ? `${envFlags} ` : ''}-- ${[launch.command, ...launch.args].map(q).join(' ')}`,
    cursor: JSON.stringify({ mcpServers: { 'ai-figma': { command: launch.command, args: launch.args, ...(Object.keys(env).length ? { env } : {}) } } }, null, 2),
    claudeHttp: `claude mcp add --transport http ai-figma ${url}`,
    cursorHttp: JSON.stringify({ mcpServers: { 'ai-figma': { url } } }, null, 2),
    cli: `${cliRun} add "${example[0]}" "${example[1]}" --frame "${example[2]}"`,
    url,
  }
}
