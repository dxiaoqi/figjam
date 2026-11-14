import type { AgentPresence, Point, Rect } from '@nodboard/shared'
import type { CallerInfo } from '@nodboard/shared'
import { AGENT_COLORS } from '@nodboard/shared'

const KNOWN: { match: RegExp; name: string; color: string }[] = [
  { match: /claude/i, name: 'Claude Code', color: '#D97757' },
  { match: /cursor/i, name: 'Cursor', color: '#6E56CF' },
  { match: /codex|openai/i, name: 'Codex', color: '#10A37F' },
  { match: /^builtin$/i, name: 'Assistant', color: '#0EA5E9' },
]

export function identify(caller: CallerInfo) {
  const known = KNOWN.find((k) => k.match.test(caller.client) || k.match.test(caller.name))
  if (known) return { name: caller.name && !/^(mcp|agent)$/i.test(caller.name) ? caller.name : known.name, color: known.color }
  let h = 0
  for (const ch of `${caller.client}|${caller.name}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { name: caller.name || 'Agent', color: AGENT_COLORS[h % AGENT_COLORS.length] }
}

/** Live agent presence. Not persisted; broadcast to canvas clients. */
export class PresenceHub {
  private agents = new Map<string, AgentPresence>()
  private statusSetAt = new Map<string, number>()
  onChange: (() => void) | null = null

  constructor() {
    setInterval(() => this.sweep(), 5000).unref()
  }

  list() {
    return [...this.agents.values()]
  }

  colorFor(caller: CallerInfo) {
    return this.agents.get(caller.id)?.color ?? identify(caller).color
  }

  touch(
    caller: CallerInfo,
    patch: { boardId?: string | null; status?: string | null; cursor?: Point | null; focus?: Rect | null; autoStatus?: string },
  ) {
    if (caller.kind === 'human') return
    const id = identify(caller)
    const prev = this.agents.get(caller.id)
    const next: AgentPresence = {
      id: caller.id,
      name: prev?.name ?? id.name,
      client: caller.client,
      color: prev?.color ?? id.color,
      boardId: patch.boardId !== undefined ? patch.boardId : (prev?.boardId ?? null),
      status: prev?.status ?? null,
      cursor: patch.cursor !== undefined ? patch.cursor : (prev?.cursor ?? null),
      focus: patch.focus !== undefined ? patch.focus : (prev?.focus ?? null),
      lastActive: Date.now(),
    }
    if (patch.status !== undefined) {
      next.status = patch.status || null
      this.statusSetAt.set(caller.id, Date.now())
    } else if (patch.autoStatus) {
      // an explicit status wins for a while over auto-generated ones
      const explicitAt = this.statusSetAt.get(caller.id) ?? 0
      if (Date.now() - explicitAt > 2500) next.status = patch.autoStatus
    }
    this.agents.set(caller.id, next)
    this.onChange?.()
  }

  leave(callerId: string) {
    if (this.agents.delete(callerId)) this.onChange?.()
  }

  private sweep() {
    const now = Date.now()
    let changed = false
    for (const [id, a] of this.agents) {
      if (now - a.lastActive > 10 * 60_000) {
        this.agents.delete(id)
        changed = true
      } else if (a.status && now - a.lastActive > 45_000) {
        a.status = null
        changed = true
      }
    }
    if (changed) this.onChange?.()
  }
}
