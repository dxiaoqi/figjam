import { AlertTriangle, Code2, Database, ExternalLink, FileCode2, Film, FolderOpen, HardDrive, History, ImageIcon, Loader2, RefreshCw, Replace, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { formatBytes, type Asset, type AssetRole, type Block } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useBoard, useBoardTitle } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { assetUrl, uploadAsset } from '../lib/assets'
import { callCore } from '../lib/core'
import { desktop } from '../lib/desktop'
import { getLocale, t, useT, type MessageKey } from '../i18n'

interface StorageAsset extends Asset {
  file: string
  status: 'used' | 'unused' | 'missing'
  usedBy: { id: string; kind: Block['kind']; label: string }[]
  pendingOnly: boolean
  /** videos: the poster a block shows for it */
  poster?: string
}

interface StorageInfo {
  board: { id: string; title: string; file: string; assetsDir: string; externalPath: string | null; externalAssetsDir: string | null; schema: string }
  totals: { boardFile: number; assetFiles: number; assetBytes: number; total: number }
  assets: StorageAsset[]
  cleanup: { entries: number; bytes: number; orphanFiles: number; historyOnlyFiles: number; historyOnlyBytes: number }
  history: { dir: string; versions: number; bytes: number; unreadable: number }
  backups: { dir: string; count: number; bytes: number; poolBytes: number }
}

type Filter = 'all' | 'image' | 'video' | 'snippet' | 'unused'
type Group = 'image' | 'video' | 'snippet' | 'preview'

const groupOf = (r: AssetRole): Group => (r === 'video' ? 'video' : r.startsWith('snippet-') ? 'snippet' : r === 'image' ? 'image' : 'preview')

/** Token-based fills for the composition bar (soft, same lightness). */
const GROUP_COLOR: Record<Group, string> = {
  image: 'bg-sky-400/80 dark:bg-sky-400/70',
  video: 'bg-violet-400/80 dark:bg-violet-400/70',
  snippet: 'bg-emerald-400/80 dark:bg-emerald-400/70',
  preview: 'bg-amber-300/90 dark:bg-amber-300/70',
}

const size = (n: number) => formatBytes(n, getLocale())

export const openStorage = () => window.dispatchEvent(new Event('aifig:storage'))

function revealLabel(): MessageKey {
  const p = desktop?.platform ?? (navigator.platform.toLowerCase().includes('mac') ? 'darwin' : navigator.platform.toLowerCase().includes('win') ? 'win32' : 'linux')
  return p === 'darwin' ? 'storage.revealMac' : p === 'win32' ? 'storage.revealWin' : 'storage.revealOther'
}

/** Middle-ellipsis for long paths, keeping the file name. */
function PathText({ path, className }: { path: string; className?: string }) {
  const cut = path.length > 64 ? `${path.slice(0, 26)}…${path.slice(-34)}` : path
  return (
    <span className={cn('truncate font-mono text-[11.5px] text-muted-foreground', className)} title={path}>
      {cut}
    </span>
  )
}

function IconButton({ label, onClick, children, disabled, ...rest }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean } & Record<`data-${string}`, string | boolean>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40" {...rest}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function Thumb({ boardId, asset, assets }: { boardId: string; asset: StorageAsset; assets: StorageAsset[] }) {
  const g = groupOf(asset.role)
  const [failed, setFailed] = useState(false)
  const poster = asset.poster ? assets.find((a) => a.id === asset.poster) : undefined
  const img = asset.status !== 'missing' && (asset.mime.startsWith('image/') ? asset : poster)
  return (
    <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50">
      {img && !failed ? <img src={assetUrl(boardId, img)} alt="" className="size-full object-cover" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : g === 'snippet' ? <FileCode2 className="size-4 text-muted-foreground" strokeWidth={1.75} /> : g === 'video' ? <Film className="size-4 text-muted-foreground" strokeWidth={1.75} /> : <ImageIcon className="size-4 text-muted-foreground" strokeWidth={1.75} />}
      {g === 'video' && img && <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-[9px] text-white">▶</span>}
    </div>
  )
}

/** Where the board's files live, what each is used by, and actions on them (reveal, open, replace, clean up). */
export function StoragePanel() {
  const { boardId } = useBoard()
  const title = useBoardTitle()
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [confirm, setConfirm] = useState<null | { removedEntries: { name: string; size: number }[]; deleted: { name: string; size: number }[]; freed: number; keptForHistory: number }>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const replacing = useRef<StorageAsset | null>(null)
  useT()

  const load = useCallback(async () => {
    setError(null)
    try {
      setInfo(await callCore<StorageInfo>('get_storage', { board: boardId }))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [boardId])

  useEffect(() => {
    const on = () => {
      setOpen(true)
      setInfo(null)
      setFilter('all')
      load()
    }
    window.addEventListener('aifig:storage', on)
    return () => window.removeEventListener('aifig:storage', on)
  }, [load])

  // stay current while open (uploads, agents, clean-up)
  useEffect(() => {
    if (!open) return
    const assets = editor.doc.getMap('assets')
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(load, 400)
    }
    assets.observe(refresh)
    editor.blocksMap.observe(refresh)
    return () => {
      clearTimeout(timer)
      assets.unobserve(refresh)
      editor.blocksMap.unobserve(refresh)
    }
  }, [open, editor, load])

  const counts = useMemo(() => {
    const c = { all: 0, image: 0, video: 0, snippet: 0, unused: 0 }
    for (const a of info?.assets ?? []) {
      c.all++
      const g = groupOf(a.role)
      if (g === 'image' || g === 'video' || g === 'snippet') c[g]++
      if (a.status === 'unused') c.unused++
    }
    return c
  }, [info])

  const bars = useMemo(() => {
    const by: Record<Group, number> = { image: 0, video: 0, snippet: 0, preview: 0 }
    for (const a of info?.assets ?? []) by[groupOf(a.role)] += a.size
    const total = Object.values(by).reduce((n, v) => n + v, 0)
    return { by, total }
  }, [info])

  const list = (info?.assets ?? []).filter((a) => filter === 'all' || (filter === 'unused' ? a.status === 'unused' : groupOf(a.role) === filter))

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const reveal = (args: Record<string, unknown>) =>
    act(`reveal:${JSON.stringify(args)}`, async () => {
      const r = await callCore<{ opened: boolean; path: string }>('reveal_asset', { board: boardId, ...args })
      if (!r.opened) toast.message(t('storage.noFileManager'), { description: r.path })
    })

  const select = (a: StorageAsset) => {
    const ids = a.usedBy.map((u) => u.id).filter((id) => editor.block(id))
    if (!ids.length) return
    editor.select(ids)
    const rects = ids.map((id) => editor.visualRect(id)).filter((r): r is NonNullable<typeof r> => !!r)
    if (rects.length) {
      const x = Math.min(...rects.map((r) => r.x))
      const y = Math.min(...rects.map((r) => r.y))
      editor.zoomToBounds({ x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }, { maxZoom: 1, animate: true })
    }
    setOpen(false)
  }

  const startReplace = (a: StorageAsset) => {
    replacing.current = a
    if (replaceInput.current) {
      const g = groupOf(a.role)
      replaceInput.current.accept = g === 'video' ? 'video/mp4,video/webm' : g === 'snippet' ? `.${a.ext}` : 'image/png,image/jpeg,image/gif,image/webp'
      replaceInput.current.value = ''
      replaceInput.current.click()
    }
  }

  const onReplaceFile = (file: File | undefined) => {
    const a = replacing.current
    if (!file || !a) return
    act(`replace:${a.id}`, async () => {
      const g = groupOf(a.role)
      if (g === 'snippet') {
        const block = a.usedBy.find((u) => u.kind === 'web')
        if (!block) throw new Error(t('storage.notUsed'))
        await callCore('update_snippet', { board: boardId, id: block.id, [a.ext]: await file.text() })
      } else {
        const up = await uploadAsset(boardId, file, g === 'video' ? 'video' : a.role === 'poster' ? 'poster' : 'image', file.name)
        await callCore('replace_asset', { board: boardId, asset: a.id, with: up.id })
      }
      toast.success(t('storage.replaced', { name: a.name ?? a.ext }))
      await load()
    })
  }

  const cleanup = () =>
    act('cleanup', async () => {
      setConfirm(await callCore('cleanup_assets', { board: boardId, dry_run: true }))
    })

  const runCleanup = () =>
    act('cleanup-run', async () => {
      const r = await callCore<{ freed: number; deleted: unknown[]; removedEntries: unknown[] }>('cleanup_assets', { board: boardId })
      setConfirm(null)
      toast.success(t('storage.cleaned', { size: size(r.freed), count: r.removedEntries.length }))
      await load()
    })

  const roleLabel = (a: StorageAsset) => t(`storage.role.${a.role}` as MessageKey)
  const usedLabel = (a: StorageAsset) =>
    a.status === 'missing' ? t('storage.missing') : a.usedBy.length ? t('storage.usedBy', { count: a.usedBy.length }) : a.pendingOnly ? t('storage.inReview') : t('storage.notUsed')

  const tabs: { id: Filter; label: MessageKey }[] = [
    { id: 'all', label: 'storage.all' },
    { id: 'image', label: 'storage.images' },
    { id: 'video', label: 'storage.videos' },
    { id: 'snippet', label: 'storage.snippets' },
    { id: 'unused', label: 'storage.unused' },
  ]

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(700px,90vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" data-ui data-storage-panel>
          <DialogHeader className="border-b px-5 pt-4 pb-3.5 text-left">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <HardDrive className="size-4 text-muted-foreground" strokeWidth={1.75} /> {t('storage.title')}
            </DialogTitle>
            <DialogDescription className="text-xs">{t('storage.description', { title: title || t('board.untitled') })}</DialogDescription>
          </DialogHeader>

          {error && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <AlertTriangle className="size-5 text-destructive" />
              {t('storage.loadFailed', { error })}
              <Button size="sm" variant="secondary" onClick={load} className="gap-1.5">
                <RefreshCw className="size-3.5" /> {t('storage.retry')}
              </Button>
            </div>
          )}
          {!error && !info && (
            <div className="space-y-3 p-5">
              <div className="h-16 animate-pulse rounded-xl bg-muted/60" />
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          )}
          {!error && info && (
            <div className="flex min-h-0 flex-1 flex-col">
              <section className="space-y-3 border-b px-5 py-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-semibold tracking-tight tabular-nums" data-storage-total>
                      {size(info.totals.total)}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">{t('storage.summary', { board: size(info.totals.boardFile), count: info.totals.assetFiles, files: size(info.totals.assetBytes) })}</div>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {(Object.keys(bars.by) as Group[])
                      .filter((g) => bars.by[g])
                      .map((g) => (
                        <span key={g} className="flex items-center gap-1.5">
                          <span className={cn('size-2 rounded-full', GROUP_COLOR[g])} />
                          {t(`storage.group.${g}` as MessageKey)} <span className="tabular-nums">{size(bars.by[g])}</span>
                        </span>
                      ))}
                  </div>
                </div>
                {bars.total > 0 && (
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    {(Object.keys(bars.by) as Group[]).map((g) => (bars.by[g] ? <div key={g} className={cn('h-full', GROUP_COLOR[g])} style={{ width: `${Math.max(1.5, (bars.by[g] / bars.total) * 100)}%` }} /> : null))}
                  </div>
                )}
                <div className="grid gap-1.5">
                  <LocationRow icon={<Database className="size-3.5" />} label={t('storage.boardFile')} path={info.board.externalPath ?? info.board.file} action={t(revealLabel())} onAction={() => reveal({ what: 'board' })} data-reveal-board />
                  <LocationRow icon={<FolderOpen className="size-3.5" />} label={t('storage.filesFolder')} path={info.board.externalAssetsDir ?? info.board.assetsDir} action={t(revealLabel())} onAction={() => reveal({ what: 'assets' })} />
                  {info.board.externalPath && <LocationRow icon={<Database className="size-3.5" />} label={t('storage.workingCopy')} path={info.board.file} muted />}
                </div>
              </section>

              <div className="flex items-center gap-1 overflow-x-auto border-b px-4 py-2" role="tablist">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={filter === tab.id}
                    onClick={() => setFilter(tab.id)}
                    data-storage-filter={tab.id}
                    className={cn('flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors', filter === tab.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent')}
                  >
                    {t(tab.label)} <span className="tabular-nums opacity-70">{counts[tab.id]}</span>
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5" data-storage-list>
                {!list.length && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-10 text-center">
                    <div className="flex size-10 items-center justify-center rounded-xl border bg-muted/40">
                      <Sparkles className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    </div>
                    <div className="text-sm font-medium">{t(filter === 'unused' ? 'storage.emptyUnused' : 'storage.empty')}</div>
                    <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{t(filter === 'unused' ? 'storage.emptyUnusedHint' : 'storage.emptyHint')}</p>
                  </div>
                )}
                {list.map((a) => (
                  <div key={a.id} className="group flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-accent/40" data-storage-asset={a.id} data-role={a.role} data-status={a.status}>
                    <Thumb boardId={boardId} asset={a} assets={info.assets} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{a.name ?? `${a.hash.slice(0, 10)}.${a.ext}`}</span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{roleLabel(a)}</span>
                        {a.status !== 'used' && (
                          <span className={cn('shrink-0 rounded px-1.5 py-px text-[10px] font-medium', a.status === 'missing' ? 'bg-red-500/12 text-red-600 dark:text-red-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300')}>
                            {t(a.status === 'missing' ? 'storage.missingBadge' : 'storage.unusedBadge')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {a.usedBy.length ? (
                          <button className="truncate underline-offset-2 hover:text-foreground hover:underline" onClick={() => select(a)} title={a.usedBy.map((u) => u.label || u.kind).join(', ')} data-storage-used-by>
                            {usedLabel(a)}
                          </button>
                        ) : (
                          <span>{usedLabel(a)}</span>
                        )}
                        {a.w && a.h ? <span className="tabular-nums">· {a.w}×{a.h}</span> : null}
                        {a.duration ? <span className="tabular-nums">· {Math.round(a.duration)} s</span> : null}
                      </div>
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{size(a.size)}</span>
                    <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton label={t(revealLabel())} onClick={() => reveal({ asset: a.id })} disabled={a.status === 'missing'} data-storage-reveal>
                        <FolderOpen className="size-3.5" />
                      </IconButton>
                      {groupOf(a.role) === 'snippet' && a.usedBy[0] ? (
                        <IconButton label={t('storage.editInEditor')} onClick={() => reveal({ block: a.usedBy[0].id, open: true })} data-storage-edit>
                          <Code2 className="size-3.5" />
                        </IconButton>
                      ) : (
                        <IconButton label={t('storage.openDefault')} onClick={() => reveal({ asset: a.id, open: true })} disabled={a.status === 'missing'} data-storage-open>
                          <ExternalLink className="size-3.5" />
                        </IconButton>
                      )}
                      <IconButton label={t('storage.replace')} onClick={() => startReplace(a)} disabled={busy === `replace:${a.id}` || (!a.usedBy.length && a.status !== 'missing')} data-storage-replace>
                        {busy === `replace:${a.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Replace className="size-3.5" />}
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>

              <footer className="grid gap-2 border-t bg-muted/20 px-5 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                <PlaceCard icon={<History className="size-3.5" />} title={t('storage.history')} detail={t('storage.historyDetail', { count: info.history.versions, size: size(info.history.bytes) })} path={info.history.dir} onReveal={() => reveal({ what: 'history' })} data-reveal-history />
                <PlaceCard icon={<Database className="size-3.5" />} title={t('storage.backups')} detail={t('storage.backupsDetail', { count: info.backups.count, size: size(info.backups.bytes) })} path={info.backups.dir} onReveal={() => reveal({ what: 'backups' })} data-reveal-backups />
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={cleanup} disabled={busy === 'cleanup' || (!info.cleanup.entries && !info.cleanup.orphanFiles)} data-storage-cleanup>
                  {busy === 'cleanup' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {!info.cleanup.entries && !info.cleanup.orphanFiles ? t('storage.cleanupNone') : info.cleanup.bytes ? t('storage.cleanupSize', { size: size(info.cleanup.bytes) }) : t('storage.cleanupCount', { count: info.cleanup.entries + info.cleanup.orphanFiles })}
                </Button>
              </footer>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md" data-ui data-cleanup-confirm>
          <DialogHeader>
            <DialogTitle>{t('storage.cleanupTitle')}</DialogTitle>
            <DialogDescription>{confirm && (confirm.deleted.length || confirm.removedEntries.length) ? t('storage.cleanupHint', { count: confirm.deleted.length, size: size(confirm.freed) }) : t('storage.cleanupNothing')}</DialogDescription>
          </DialogHeader>
          {confirm && confirm.removedEntries.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-2 text-xs">
              {confirm.removedEntries.map((e, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate">{e.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{size(e.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {confirm && confirm.keptForHistory > 0 && <p className="text-xs text-muted-foreground">{t('storage.keptForHistory', { count: confirm.keptForHistory })}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={runCleanup} disabled={busy === 'cleanup-run' || !confirm?.removedEntries.length} data-cleanup-run>
              {busy === 'cleanup-run' ? <Loader2 className="size-4 animate-spin" /> : null} {t('storage.cleanupRun')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <input ref={replaceInput} type="file" hidden onChange={(e) => onReplaceFile(e.target.files?.[0])} />
    </>
  )
}

function LocationRow({ icon, label, path, action, onAction, muted, ...rest }: { icon: ReactNode; label: string; path: string; action?: string; onAction?: () => void; muted?: boolean } & Record<`data-${string}`, boolean>) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5', muted && 'border-dashed bg-transparent')}>
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-24 shrink-0 text-xs font-medium sm:w-28">{label}</span>
      <PathText path={path} className="min-w-0 flex-1" />
      {action && onAction && (
        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1.5 px-2 text-xs" onClick={onAction} {...rest}>
          <FolderOpen className="size-3.5" /> <span className="hidden sm:inline">{action}</span>
        </Button>
      )}
    </div>
  )
}

function PlaceCard({ icon, title, detail, path, onReveal, ...rest }: { icon: ReactNode; title: string; detail: string; path: string; onReveal: () => void } & Record<`data-${string}`, boolean>) {
  return (
    <button onClick={onReveal} className="group flex min-w-0 items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-left transition-colors hover:border-foreground/20" title={path} {...rest}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground tabular-nums">{detail}</span>
      </span>
      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
