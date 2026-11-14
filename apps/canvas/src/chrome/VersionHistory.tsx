import { Bookmark, FolderOpen, History, ImageOff, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { DiffSummary, VersionInfo } from '@nodboard/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useBoard, useBoardTitle } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { apiFetch } from '../lib/auth'
import { callCore } from '../lib/core'
import { kindBadge, openBackupFolder, restoreVersion, summarize, versionLabel, versionPreviewUrl } from '../lib/versions'
import { getLocale, t, useT } from '../i18n'

const time = (at: number) => new Date(at).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })

function dayLabel(at: number) {
  const d = new Date(at)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return t('versions.today')
  if (d.toDateString() === yesterday.toDateString()) return t('versions.yesterday')
  return d.toLocaleDateString(getLocale(), { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function groupByDay(versions: VersionInfo[]) {
  const out: { day: string; items: VersionInfo[] }[] = []
  for (const v of versions) {
    const day = dayLabel(v.createdAt)
    if (out.at(-1)?.day !== day) out.push({ day, items: [] })
    out.at(-1)!.items.push(v)
  }
  return out
}

function Preview({ boardId, version, theme }: { boardId: string; version: VersionInfo; theme: 'light' | 'dark' }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [src, setSrc] = useState<string | null>(null)
  // <img> can't send the access token, so the SVG goes through apiFetch and an object URL
  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    setState('loading')
    setSrc(null)
    apiFetch(versionPreviewUrl(boardId, version.id, theme))
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        const blob = await r.blob()
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => !cancelled && setState('error'))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [boardId, version.id, theme])
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-[var(--canvas)]" data-version-preview>
      {state !== 'error' && src && (
        <img
          src={src}
          alt={t('versions.previewAlt', { label: versionLabel(version) })}
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
          className={cn('max-h-full max-w-full object-contain p-4 transition-opacity duration-200', state === 'ready' ? 'opacity-100' : 'opacity-0')}
          draggable={false}
        />
      )}
      {state === 'loading' && <Loader2 className="absolute size-5 animate-spin text-muted-foreground" />}
      {state === 'error' && (
        <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
          <ImageOff className="size-5" />
          {t('versions.previewError')}
        </div>
      )}
      <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground backdrop-blur">{t('versions.readOnly')}</span>
    </div>
  )
}

/** Browse versions, preview them read-only, restore (undoable), and save named checkpoints. */
export function VersionHistory() {
  const { boardId, theme } = useBoard()
  const title = useBoardTitle()
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffSummary | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'restore' | 'save' | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  useT()

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callCore<{ versions: VersionInfo[] }>('list_versions', { board: boardId, limit: 200 })
      setVersions(r.versions)
      setSelected((cur) => (cur && r.versions.some((v) => v.id === cur) ? cur : (r.versions[0]?.id ?? null)))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [boardId])

  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true)
      setVersions(null)
      load()
      if ((e as CustomEvent).detail?.checkpoint) setTimeout(() => nameRef.current?.focus(), 50)
    }
    window.addEventListener('nodboard:versions', onOpen)
    return () => window.removeEventListener('nodboard:versions', onOpen)
  }, [load])

  const current = versions?.find((v) => v.id === selected) ?? null
  useEffect(() => {
    setDiff(null)
    if (!open || !current) return
    let live = true
    callCore<{ diff: DiffSummary }>('get_version', { board: boardId, version: current.id })
      .then((r) => live && setDiff(r.diff))
      .catch(() => live && setDiff(null))
    return () => {
      live = false
    }
  }, [open, current, boardId])

  const groups = useMemo(() => groupByDay(versions ?? []), [versions])

  const save = async () => {
    const n = name.trim()
    if (!n) return
    setBusy('save')
    try {
      const r = await callCore<{ version: VersionInfo }>('create_version', { board: boardId, name: n })
      setName('')
      await load()
      setSelected(r.version.id)
      toast.success(t('versions.savedCheckpoint', { name: n }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const restore = async () => {
    if (!current) return
    setBusy('restore')
    try {
      await restoreVersion(editor, boardId, current)
      setOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (v: VersionInfo) => {
    try {
      await callCore('delete_version', { board: boardId, version: v.id })
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(640px,88vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl" data-ui data-version-history>
        <DialogHeader className="border-b px-5 pt-4 pb-3.5 text-left">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <History className="size-4 text-muted-foreground" strokeWidth={1.75} /> {t('versions.title')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('versions.description', { title: title || t('board.untitled') })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="flex max-h-[38%] min-h-0 flex-col border-b sm:max-h-none sm:w-72 sm:border-r sm:border-b-0">
            <form
              className="flex gap-1.5 border-b p-3"
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('versions.namePlaceholder')} className="h-8 text-[13px]" maxLength={120} data-checkpoint-name />
              <Button type="submit" size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5" disabled={!name.trim() || busy === 'save'}>
                {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className="size-3.5" />} {t('common.save')}
              </Button>
            </form>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5" data-version-list>
              {error && <div className="px-2.5 py-3 text-xs text-destructive">{t('versions.loadFailed', { error })}</div>}
              {!error && !versions && (
                <div className="space-y-1.5 p-1.5">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="h-11 animate-pulse rounded-lg bg-muted/60" />
                  ))}
                </div>
              )}
              {versions && !versions.length && (
                <div className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                  {t('versions.empty')}
                </div>
              )}
              {groups.map((g) => (
                <section key={g.day} className="mb-1">
                  <h3 className="sticky top-0 z-[1] bg-background/95 px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground backdrop-blur">{g.day}</h3>
                  {g.items.map((v) => {
                    const badge = kindBadge(v.kind)
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelected(v.id)}
                        className={cn(
                          'group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                          v.id === selected ? 'bg-accent' : 'hover:bg-accent/50',
                        )}
                        data-version={v.id}
                        aria-current={v.id === selected}
                      >
                        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', v.kind === 'checkpoint' ? 'bg-violet-500' : v.kind === 'recovered' ? 'bg-amber-500' : 'bg-muted-foreground/35')} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={cn('truncate text-[13px]', v.kind === 'checkpoint' ? 'font-medium' : '')}>{versionLabel(v)}</span>
                          </span>
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="tabular-nums">{time(v.createdAt)}</span>
                            <span>·</span>
                            <span className="tabular-nums">{t('versions.blocks', { count: v.blockCount })}</span>
                            {badge && v.kind !== 'checkpoint' && <span className="rounded bg-muted px-1 text-[10px]">{badge}</span>}
                          </span>
                        </span>
                        {v.kind === 'checkpoint' && (
                          <span
                            role="button"
                            tabIndex={-1}
                            aria-label={t('versions.deleteCheckpoint')}
                            onClick={(e) => {
                              e.stopPropagation()
                              remove(v)
                            }}
                            className="mt-0.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </section>
              ))}
            </div>
            <div className="border-t p-1.5">
              <Button variant="ghost" size="sm" className="h-8 w-full justify-start gap-2 text-xs text-muted-foreground" onClick={() => openBackupFolder(boardId)} data-open-backups>
                <FolderOpen className="size-3.5" /> {t('board.openBackups')}
              </Button>
            </div>
          </aside>
          <section className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            {current ? (
              <>
                <Preview key={`${current.id}:${theme}`} boardId={boardId} version={current} theme={theme} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{versionLabel(current)}</div>
                    <div className="text-xs text-muted-foreground" data-version-diff>
                      {new Date(current.createdAt).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' })}
                      {current.by ? ` · ${t('versions.by', { name: current.by })}` : ''}
                      {diff ? ` · ${summarize(diff)}` : ''}
                    </div>
                  </div>
                  <Button onClick={restore} disabled={busy === 'restore' || (diff !== null && !diff.added && !diff.removed && !diff.changed)} className="gap-1.5" data-restore-version>
                    {busy === 'restore' ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} {t('versions.restore')}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{versions ? t('versions.select') : ''}</div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
