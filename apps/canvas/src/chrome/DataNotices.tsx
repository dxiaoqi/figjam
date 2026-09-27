import { AlertTriangle, FolderOpen, History, ShieldAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { DataNotice } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useBoard } from '../board-context'
import { callCore } from '../lib/core'
import { openBackupFolder, openVersionHistory } from '../lib/versions'
import { useT } from '../i18n'

/** Recoveries, unreadable boards and failing saves — shown until the person dismisses them. */
export function DataNotices() {
  const { boardId } = useBoard()
  const [notices, setNotices] = useState<DataNotice[]>([])
  const t = useT()

  const load = useCallback(async () => {
    try {
      setNotices((await callCore<{ notices: DataNotice[] }>('get_notices', { board: boardId })).notices)
    } catch {
      // the connection banner covers an unreachable core
    }
  }, [boardId])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const dismiss = async (id: string) => {
    setNotices((n) => n.filter((x) => x.id !== id))
    await callCore('dismiss_notice', { id }).catch(() => {})
  }

  if (!notices.length) return null
  return (
    <div className="pointer-events-none absolute top-16 left-1/2 z-[390] flex w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2" data-ui data-notices>
      {notices.slice(0, 3).map((n) => {
        const error = n.level === 'error'
        const Icon = error ? ShieldAlert : AlertTriangle
        return (
          <div key={n.id} role="alert" className="chrome pointer-events-auto flex animate-in gap-3 rounded-2xl py-3 pr-2.5 pl-3.5 fade-in slide-in-from-top-2" data-notice={n.kind}>
            <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', error ? 'bg-red-500/12 text-red-600 dark:text-red-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-snug">{n.title}</div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{n.detail}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {n.kind === 'recovered' && n.boardId === boardId && (
                  <Button size="sm" variant="secondary" className="h-7 gap-1.5 text-xs" onClick={() => openVersionHistory()}>
                    <History className="size-3.5" /> {t('versions.title')}
                  </Button>
                )}
                {n.kind !== 'save-failed' && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => openBackupFolder(n.boardId === boardId ? boardId : undefined)}>
                    <FolderOpen className="size-3.5" /> {t('board.openBackups')}
                  </Button>
                )}
              </div>
            </div>
            <button onClick={() => dismiss(n.id)} className="size-7 shrink-0 rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label={t('notices.dismiss')}>
              <X className="mx-auto size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
