import type { Author, ChangeSet } from '@aifig/shared'

export interface AuthorGroup {
  key: string
  label: string
  name: string
  client: string
  color?: string
  /** Every session id this agent has used on the board. */
  ids: string[]
  sets: number
}

/** Author ids are per agent session ("claude-code:4211"), so the client part is what persists across sessions. */
export const clientOf = (a: Author) => a.client ?? a.id.split(':')[0] ?? a.id

/**
 * One entry per agent (display name + client), however many sessions it ran.
 * Agents that share a display name but not a client get the client added to their label.
 */
export function groupAuthors(sets: ChangeSet[]): AuthorGroup[] {
  const groups = new Map<string, AuthorGroup>()
  for (const c of [...sets].sort((a, b) => b.createdAt - a.createdAt)) {
    const a = c.author
    const client = clientOf(a)
    const key = `${a.kind}|${a.name}|${client}`
    const g = groups.get(key) ?? { key, label: a.name, name: a.name, client, color: a.color, ids: [], sets: 0 }
    if (!g.ids.includes(a.id)) g.ids.push(a.id)
    g.sets++
    groups.set(key, g)
  }
  const list = [...groups.values()]
  for (const g of list) {
    if (list.some((o) => o !== g && o.name === g.name)) g.label = `${g.name} · ${g.client}`
  }
  return list
}

export function authorLabel(groups: AuthorGroup[], a: Author) {
  return groups.find((g) => g.ids.includes(a.id))?.label ?? a.name
}
