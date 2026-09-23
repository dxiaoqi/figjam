import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/ui/components/ui/button'
import { Toaster } from '@/ui/components/ui/sonner'
import { TooltipProvider } from '@/ui/components/ui/tooltip'
import type { BoardSummary } from '@/shared/model'
import { BoardContext, type ThemeMode } from './board-context'
import { BoardCanvas } from './canvas/BoardCanvas'
import { Logo } from './chrome/BoardMenu'
import { callCore, fetchBoards, fetchHealth, type Health } from './lib/core'
import { CoreProvider } from './sync/provider'

function initialTheme(): ThemeMode {
  const saved = localStorage.getItem('aifig:theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function pickBoard(boards: BoardSummary[], active: string | null) {
  const fromUrl = new URLSearchParams(location.search).get('board')
  const saved = localStorage.getItem('aifig:board')
  for (const id of [fromUrl, saved, active]) if (id && boards.some((b) => b.id === id)) return id
  return boards[0]?.id ?? null
}

function CoreOffline({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-[440px] max-w-full rounded-3xl border bg-card p-8 shadow-sm">
        <Logo className="mb-5 size-9" />
        <h1 className="text-lg font-semibold tracking-tight">Can’t reach the ai-figma core</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The canvas is a window onto a small local process that owns your boards. Start it from the project folder, and this page will connect on
          its own.
        </p>
        <pre className="mt-4 rounded-lg border bg-muted/60 p-3 font-mono text-[12px]">npm run core</pre>
        <p className="mt-2 text-xs text-muted-foreground">
          Or run everything at once with <code className="font-mono">npm run dev</code>.
        </p>
        <Button variant="outline" size="sm" className="mt-5 gap-1.5" onClick={onRetry} disabled={retrying}>
          {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Try again
        </Button>
      </div>
    </div>
  )
}

export default function App() {
  const [theme, setThemeState] = useState<ThemeMode>(initialTheme)
  const [health, setHealth] = useState<Health | null>(null)
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [boardId, setBoardId] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [provider, setProvider] = useState<CoreProvider | null>(null)

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t)
    localStorage.setItem('aifig:theme', t)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const load = useCallback(async () => {
    setRetrying(true)
    try {
      const [h, b] = await Promise.all([fetchHealth(), fetchBoards()])
      setHealth(h)
      setBoards(b.boards)
      setOffline(false)
      setBoardId((cur) => (cur && b.boards.some((x) => x.id === cur) ? cur : pickBoard(b.boards, b.active)))
    } catch {
      setOffline(true)
    } finally {
      setRetrying(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!offline) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [offline, load])

  useEffect(() => {
    if (!boardId) return
    const p = new CoreProvider(boardId)
    setProvider(p)
    localStorage.setItem('aifig:board', boardId)
    const url = new URL(location.href)
    url.searchParams.set('board', boardId)
    history.replaceState(null, '', url)
    return () => {
      p.destroy()
      setProvider(null)
    }
  }, [boardId])

  // keep board list fresh (counts, titles, boards created by agents)
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        setBoards((await fetchBoards()).boards)
      } catch {
        /* the connection banner covers this */
      }
    }, 4000)
    return () => clearInterval(t)
  }, [])

  const refreshBoards = useCallback(async () => {
    try {
      setBoards((await fetchBoards()).boards)
    } catch {
      /* ignore */
    }
  }, [])

  const createBoard = useCallback(async () => {
    try {
      const r = await callCore<{ board: BoardSummary }>('create_board', { title: 'Untitled board' })
      await refreshBoards()
      setBoardId(r.board.id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [refreshBoards])

  let body
  if (offline && !provider) body = <CoreOffline retrying={retrying} onRetry={load} />
  else if (!boards || !provider || !boardId || provider.boardId !== boardId)
    body = (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Starting ai-figma…
      </div>
    )
  else
    body = (
      <BoardContext.Provider value={{ boardId, provider, boards, health, theme, setTheme, switchBoard: setBoardId, createBoard, refreshBoards }}>
        <BoardCanvas key={boardId} />
      </BoardContext.Provider>
    )

  return (
    <TooltipProvider delayDuration={400}>
      {body}
      <Toaster theme={theme} position="bottom-center" offset={96} />
    </TooltipProvider>
  )
}
