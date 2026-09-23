import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import type { AgentPresence, Block, BoardSummary, ChangeSet } from '@/shared/model'
import type { Health } from './lib/core'
import type { CoreProvider } from './sync/provider'

export type ThemeMode = 'light' | 'dark'

export interface BoardContextValue {
  boardId: string
  provider: CoreProvider
  boards: BoardSummary[]
  health: Health | null
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void
  switchBoard: (id: string) => void
  createBoard: () => void
  refreshBoards: () => void
}

export const BoardContext = createContext<BoardContextValue | null>(null)

export function useBoard() {
  const v = useContext(BoardContext)
  if (!v) throw new Error('useBoard outside BoardContext')
  return v
}

/** Re-render when the provider's connection / presence state changes. */
export function useProviderState() {
  const { provider } = useBoard()
  const subscribe = (fn: () => void) => provider.subscribe(fn)
  const status = useSyncExternalStore(subscribe, () => provider.status)
  const synced = useSyncExternalStore(subscribe, () => provider.synced)
  const agents = useSyncExternalStore(subscribe, () => provider.agents)
  return { status, synced, agents }
}

export function useAgentsOnBoard(): AgentPresence[] {
  const { boardId } = useBoard()
  const { agents } = useProviderState()
  return agents.filter((a) => a.boardId === boardId)
}

function useYMapValues<T>(map: Y.Map<T>): T[] {
  const [values, setValues] = useState(() => [...map.values()])
  useEffect(() => {
    const update = () => setValues([...map.values()])
    update()
    map.observe(update)
    return () => map.unobserve(update)
  }, [map])
  return values
}

export function useChangeSets(): ChangeSet[] {
  const { provider } = useBoard()
  return useYMapValues(provider.doc.getMap<ChangeSet>('changeSets'))
}

export function useBlockCount(): number {
  const { provider } = useBoard()
  const [n, setN] = useState(() => provider.doc.getMap<Block>('blocks').size)
  useEffect(() => {
    const m = provider.doc.getMap<Block>('blocks')
    const update = () => setN(m.size)
    update()
    m.observe(update)
    return () => m.unobserve(update)
  }, [provider])
  return n
}

export function useBoardTitle(): string {
  const { provider } = useBoard()
  const meta = provider.doc.getMap<unknown>('meta')
  const [title, setTitle] = useState(() => (meta.get('title') as string) ?? '')
  useEffect(() => {
    const update = () => setTitle((meta.get('title') as string) ?? '')
    update()
    meta.observe(update)
    return () => meta.unobserve(update)
  }, [meta])
  return title
}
