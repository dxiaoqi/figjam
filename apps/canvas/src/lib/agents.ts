import { apiFetch } from './auth'

export type AgentId = 'claude' | 'cursor'
/** stdio: the agent launches the CLI · http: the agent calls the running core (config carries the token). */
export type AgentTransport = 'stdio' | 'http'

export interface AgentStatus {
  id: AgentId
  name: string
  installed: boolean
  foundAt: string | null
  configFile: string
  configExists: boolean
  state: 'configured' | 'different' | 'missing'
  transport: AgentTransport | null
  error?: string
}

async function req<T>(path: string, method: 'GET' | 'POST' = 'GET', body: unknown = {}): Promise<T> {
  const r = await apiFetch(`/api/agents${path}`, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined, body: method === 'POST' ? JSON.stringify(body) : undefined })
  const json = await r.json()
  if (!json.ok && json.error && !('tools' in json)) throw new Error(json.error)
  return json as T
}

export const detectAgents = () => req<{ agents: AgentStatus[] }>('').then((r) => r.agents)
export const installAgent = (id: AgentId, transport: AgentTransport = 'stdio') =>
  req<{ changed: boolean; file: string; backup: string | null; status: AgentStatus }>(`/${id}/install`, 'POST', { transport })
export const testAgent = (id: AgentId) =>
  apiFetch(`/api/agents/${id}/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json() as Promise<{ ok: true; tools: number } | { ok: false; error: string }>)
