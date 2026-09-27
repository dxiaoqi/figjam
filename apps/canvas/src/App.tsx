import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BoardSummary, TemplateId } from '@aifig/shared'
import { BoardContext, type ThemeMode } from './board-context'
import { BoardCanvas } from './canvas/BoardCanvas'
import { Logo } from './chrome/BoardMenu'
import { TokenGate } from './chrome/TokenGate'
import { UNAUTHORIZED } from './lib/auth'
import { callCore, fetchBoards, fetchHealth, Unauthorized, type Health } from './lib/core'
import { setAssetKey } from './lib/assets'
import { desktop } from './lib/desktop'
import { CoreProvider } from './sync/provider'
import { getLocale, subscribeLocale, t, tn, useLocale, useT, type LocalePref } from './i18n'
import { NewBoardDialog } from './chrome/NewBoardDialog'
import { openNewBoard } from './chrome/new-board'
import { openSettings, SettingsDialog } from './chrome/SettingsDialog'
import { shouldShowWelcome, Welcome } from './chrome/Welcome'

type ThemePref = 'system' | ThemeMode

function initialPref(): ThemePref {
  const saved = localStorage.getItem('aifig:theme')
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

const systemTheme = (): ThemeMode => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function pickBoard(boards: BoardSummary[], active: string | null) {
  const fromUrl = new URLSearchParams(location.search).get('board')
  const saved = localStorage.getItem('aifig:board')
  for (const id of [fromUrl, saved, active]) if (id && boards.some((b) => b.id === id)) return id
  return boards[0]?.id ?? null
}

function CoreOffline({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  useT()
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-[440px] max-w-full rounded-3xl border bg-card p-8 shadow-sm">
        <Logo className="mb-5 size-9" />
        <h1 className="text-lg font-semibold tracking-tight">{t('offline.title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('offline.body')}</p>
        <pre className="mt-4 rounded-lg border bg-muted/60 p-3 font-mono text-[12px]">npm run core</pre>
        <p className="mt-2 text-xs text-muted-foreground">
          {tn('offline.orAll', { cmd: <code className="font-mono">npm run dev</code> })}
        </p>
        <Button variant="outline" size="sm" className="mt-5 gap-1.5" onClick={onRetry} disabled={retrying}>
          {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} {t('offline.retry')}
        </Button>
      </div>
    </div>
  )
}

export default function App() {
  useT()
  const [pref, setPref] = useState<ThemePref>(initialPref)
  const [system, setSystem] = useState<ThemeMode>(systemTheme)
  const theme: ThemeMode = pref === 'system' ? system : pref
  const [health, setHealth] = useState<Health | null>(null)
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [boardId, setBoardId] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [locked, setLocked] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [provider, setProvider] = useState<CoreProvider | null>(null)
  const [welcome, setWelcome] = useState(shouldShowWelcome)
  const { pref: localePref, setPref: setLocalePref } = useLocale()

  // the desktop shell mirrors the language in its native menus
  useEffect(() => {
    if (!desktop?.setLocale) return
    const report = () => desktop!.setLocale!(getLocale(), localePref)
    report()
    return subscribeLocale(report)
  }, [localePref])

  const setTheme = useCallback((t: ThemePref) => {
    setPref(t)
    if (t === 'system') localStorage.removeItem('aifig:theme')
    else localStorage.setItem('aifig:theme', t)
  }, [])

  // follow the OS appearance when set to "system"
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const load = useCallback(async () => {
    setRetrying(true)
    try {
      const [h, b] = await Promise.all([fetchHealth(), fetchBoards()])
      setAssetKey(h.assetKey)
      setHealth(h)
      setBoards(b.boards)
      setOffline(false)
      setLocked(false)
      setBoardId((cur) => (cur && b.boards.some((x) => x.id === cur) ? cur : pickBoard(b.boards, b.active)))
    } catch (e) {
      if (e instanceof Unauthorized) setLocked(true)
      else setOffline(true)
    } finally {
      setRetrying(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const on = () => setLocked(true)
    window.addEventListener(UNAUTHORIZED, on)
    return () => window.removeEventListener(UNAUTHORIZED, on)
  }, [])

  useEffect(() => {
    if (!offline) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [offline, load])

  useEffect(() => {
    if (!boardId || locked) return
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
  }, [boardId, locked])

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

  // desktop shell: native menu actions that don't need the editor, and window state
  useEffect(() => {
    if (!desktop) return
    return desktop.onMenu((action, payload) => {
      if (action === 'theme') setTheme(payload as ThemePref)
      else if (action === 'locale') setLocalePref(payload as LocalePref)
      else if (action === 'settings') openSettings()
      else if (action === 'os-theme') setSystem(payload ? 'dark' : 'light')
      else if (action === 'open-board') {
        refreshBoards().then(() => setBoardId(String(payload)))
      } else if (action === 'new-board') openNewBoard()
      else if (action === 'connect-agent') window.dispatchEvent(new Event('aifig:connect'))
    })
  }, [setTheme, refreshBoards, setLocalePref])
  useEffect(() => {
    const title = boards?.find((b) => b.id === boardId)?.title ?? ''
    document.title = title ? `${title} — ai-figma` : 'ai-figma'
    desktop?.reportState({ boardId, title })
  }, [boardId, boards])

  const createBoard = useCallback(
    async (opts: { title?: string; template?: TemplateId } = {}) => {
      try {
        const r = await callCore<{ board: BoardSummary }>('create_board', { title: opts.title ?? (opts.template ? undefined : t('board.untitled')), template: opts.template, language: getLocale() })
        await refreshBoards()
        setBoardId(r.board.id)
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
    [refreshBoards],
  )

  const openSample = useCallback(
    async (skill: string) => {
      try {
        const r = await callCore<{ board: BoardSummary }>('open_sample', { skill, language: getLocale() })
        await refreshBoards()
        setBoardId(r.board.id)
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
    [refreshBoards],
  )

  let body
  if (locked) body = <TokenGate onDone={load} />
  else if (offline && !provider) body = <CoreOffline retrying={retrying} onRetry={load} />
  else if (!boards || !provider || !boardId || provider.boardId !== boardId)
    body = (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> {t('app.starting')}
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
      <NewBoardDialog theme={theme} onCreate={createBoard} onOpenSample={openSample} />
      <SettingsDialog themePref={pref} setTheme={setTheme} onShowWelcome={() => setWelcome(true)} />
      {welcome && !offline && <Welcome theme={theme} onClose={() => setWelcome(false)} />}
      <Toaster theme={theme} position="bottom-center" offset={96} />
    </TooltipProvider>
  )
}
