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

export function mcpSnippets(bin: string) {
  const cursor = JSON.stringify({ mcpServers: { 'ai-figma': { command: 'node', args: [bin, 'mcp'] } } }, null, 2)
  return {
    claude: `claude mcp add ai-figma -- node ${bin} mcp`,
    cursor,
    cli: `node ${bin} add "First idea" "Second idea" --frame "Ideas"`,
  }
}
