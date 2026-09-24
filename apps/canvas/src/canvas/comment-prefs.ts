import { useSyncExternalStore } from 'react'
import type { Thread } from '@aifig/shared'

/**
 * Per-user comment UI state. Lives in localStorage — never in the board document,
 * so one person's comment mode or read markers don't leak to collaborators or agents.
 */
export interface CommentPrefs {
  mode: boolean
  showResolved: boolean
}

const PREFS_KEY = 'aifig:comments'
const seenKey = (boardId: string) => `aifig:comments-seen:${boardId}`

function load(): CommentPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { mode: !!v.mode, showResolved: !!v.showResolved }
  } catch {
    return { mode: false, showResolved: false }
  }
}

let prefs = load()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setCommentPrefs(patch: Partial<CommentPrefs>) {
  prefs = { ...prefs, ...patch }
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  document.documentElement.toggleAttribute('data-comment-mode', prefs.mode)
  emit()
}

document.documentElement.toggleAttribute('data-comment-mode', prefs.mode)

export function useCommentPrefs(): CommentPrefs {
  return useSyncExternalStore(subscribe, () => prefs)
}

export const toggleCommentMode = () => setCommentPrefs({ mode: !prefs.mode })

// ---- read markers (thread id → newest message time the user has seen) ----

type Seen = Record<string, number>
const seenCache = new Map<string, Seen>()

function loadSeen(boardId: string): Seen {
  let s = seenCache.get(boardId)
  if (!s) {
    try {
      s = JSON.parse(localStorage.getItem(seenKey(boardId)) ?? '{}') as Seen
    } catch {
      s = {}
    }
    seenCache.set(boardId, s)
  }
  return s
}

export function useSeen(boardId: string): Seen {
  return useSyncExternalStore(subscribe, () => loadSeen(boardId))
}

export function markSeen(boardId: string, threads: Thread[]) {
  const cur = loadSeen(boardId)
  let changed = false
  const next = { ...cur }
  for (const t of threads) {
    const last = lastActivity(t)
    if ((next[t.id] ?? 0) < last) {
      next[t.id] = last
      changed = true
    }
  }
  if (!changed) return
  seenCache.set(boardId, next)
  localStorage.setItem(seenKey(boardId), JSON.stringify(next))
  emit()
}

export const ME_ID = 'human:ui'

export function lastActivity(t: Thread) {
  return Math.max(t.createdAt, ...t.replies.map((r) => r.createdAt))
}

/** Unread = someone other than me wrote something after I last looked. */
export function isUnread(t: Thread, seen: Seen) {
  const since = seen[t.id] ?? 0
  return [{ author: t.author, createdAt: t.createdAt }, ...t.replies].some((m) => m.author.id !== ME_ID && m.createdAt > since)
}
