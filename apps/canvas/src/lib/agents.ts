export type AgentId = 'claude' | 'cursor'

export interface AgentStatus {
  id: AgentId
  name: string
  installed: boolean
  foundAt: string | null
  configFile: string
  configExists: boolean
  state: 'configured' | 'different' | 'missing'
  error?: string
}

async function req<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const r = await fetch(`/api/agents${path}`, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined })
  const body = await r.json()
  if (!body.ok && body.error && !('tools' in body)) throw new Error(body.error)
  return body as T
}

export const detectAgents = () => req<{ agents: AgentStatus[] }>('').then((r) => r.agents)
export const installAgent = (id: AgentId) => req<{ changed: boolean; file: string; backup: string | null; status: AgentStatus }>(`/${id}/install`, 'POST')
export const testAgent = (id: AgentId) =>
  fetch(`/api/agents/${id}/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json() as Promise<{ ok: true; tools: number } | { ok: false; error: string }>)
