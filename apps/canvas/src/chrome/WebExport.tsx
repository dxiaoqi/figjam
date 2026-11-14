import { AlertTriangle, FileCode2, FolderOpen, Globe, Loader2, MessageSquare, ListTree, ShieldCheck, FileArchive } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { formatBytes } from '@nodboard/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useBoard, useBoardTitle } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { apiFetch } from '../lib/auth'
import { callCore } from '../lib/core'
import { desktop } from '../lib/desktop'
import { getLocale, t, useT, type MessageKey } from '../i18n'

type Mode = 'folder' | 'zip' | 'single'
const size = (n: number) => formatBytes(n, getLocale())
export const openWebExport = () => window.dispatchEvent(new Event('nodboard:export-web'))

function Option({ active, onClick, icon, label, hint, detail, ...rest }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; hint: string; detail?: string } & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn('flex min-w-0 flex-1 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors', active ? 'border-foreground/60 bg-accent/60 ring-1 ring-foreground/20' : 'hover:border-foreground/25 hover:bg-accent/30')}
      {...rest}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium">
        {icon} {label}
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>
      {detail && <span className="text-[11px] text-muted-foreground tabular-nums">{detail}</span>}
    </button>
  )
}

/** Export a read-only interactive web page of the board (folder, zip or one HTML file). */
export function WebExportDialog() {
  const { boardId, theme } = useBoard()
  const title = useBoardTitle()
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>(desktop?.savePath ? 'folder' : 'zip')
  const [comments, setComments] = useState(true)
  const [fields, setFields] = useState(true)
  const [estimate, setEstimate] = useState<{ folder: number; single: number; warnAbove: number } | null>(null)
  const [busy, setBusy] = useState(false)
  useT()

  useEffect(() => {
    const on = () => {
      setOpen(true)
      setEstimate(null)
      callCore<{ folder: number; single: number; warnAbove: number }>('estimate_web', { board: boardId })
        .then(setEstimate)
        .catch(() => setEstimate(null))
    }
    window.addEventListener('nodboard:export-web', on)
    return () => window.removeEventListener('nodboard:export-web', on)
  }, [boardId])

  const threads = editor.doc.getMap('threads').size
  const typed = editor.blocks().some((b) => b.type)
  const heavy = !!estimate && mode === 'single' && estimate.single > estimate.warnAbove
  const safeName = (title || 'board').replace(/[\\/:*?"<>|]+/g, '-').trim()

  const run = async () => {
    setBusy(true)
    try {
      if (desktop?.savePath) {
        const target = await desktop.savePath({ defaultName: mode === 'folder' ? `${safeName} (web)` : mode === 'zip' ? `${safeName} (web).zip` : `${safeName}.html`, kind: mode === 'folder' ? 'folder' : mode === 'zip' ? 'zip' : 'html' })
        if (!target) return
        const r = await callCore<{ path: string; size: number; warning?: string }>('export_web', { board: boardId, path: target, mode, include_comments: comments, show_fields: fields, theme, overwrite: true })
        toast.success(t('web.exported', { name: r.path.split(/[\\/]/).pop() ?? '', size: size(r.size) }), {
          description: [r.warning, t('web.publish')].filter(Boolean).join(' '),
          duration: 9000,
          action: desktop.revealPath ? { label: t('pack.showFile'), onClick: () => desktop!.revealPath!(r.path) } : undefined,
        })
      } else {
        const q = new URLSearchParams({ comments: comments ? '1' : '0', fields: fields ? '1' : '0', theme })
        const r = await apiFetch(`/api/boards/${encodeURIComponent(boardId)}/web.${mode === 'single' ? 'html' : 'zip'}?${q}`)
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Export failed (${r.status})`)
        const name = decodeURIComponent(r.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? 'board.zip')
        const warning = r.headers.get('x-nodboard-warning')
        const url = URL.createObjectURL(await r.blob())
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        toast.success(t('web.downloaded', { name }), { description: [warning && decodeURIComponent(warning), t('web.publish')].filter(Boolean).join(' '), duration: 9000 })
      }
      setOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const modes: { id: Mode; icon: ReactNode; label: MessageKey; hint: MessageKey; bytes?: number }[] = [
    ...(desktop?.savePath ? [{ id: 'folder' as Mode, icon: <FolderOpen className="size-3.5" />, label: 'web.folder' as MessageKey, hint: 'web.folderHint' as MessageKey, bytes: estimate?.folder }] : []),
    { id: 'zip', icon: <FileArchive className="size-3.5" />, label: 'web.zip', hint: 'web.zipHint', bytes: estimate?.folder },
    { id: 'single', icon: <FileCode2 className="size-3.5" />, label: 'web.single', hint: 'web.singleHint', bytes: estimate?.single },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-4 sm:max-w-lg" data-ui data-web-export>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Globe className="size-4 text-muted-foreground" strokeWidth={1.75} /> {t('web.title')}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{t('web.description', { title: title || t('board.untitled') })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <div className="text-xs font-medium">{t('web.format')}</div>
          <div className="flex gap-2" role="radiogroup">
            {modes.map((m) => (
              <Option key={m.id} active={mode === m.id} onClick={() => setMode(m.id)} icon={m.icon} label={t(m.label)} hint={t(m.hint)} detail={m.bytes ? t('web.estimate', { size: size(m.bytes) }) : undefined} data-web-mode={m.id} />
            ))}
          </div>
        </div>
        <div className="divide-y rounded-xl border">
          <label className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <MessageSquare className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{t('web.comments')}</span>
              <span className="block text-[11.5px] text-muted-foreground">{threads ? `${t('pack.commentsDetail', { count: threads })} · ${t('web.commentsHint')}` : t('web.commentsHint')}</span>
            </span>
            <Switch checked={comments} onCheckedChange={setComments} data-web-comments />
          </label>
          {typed && (
            <label className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <ListTree className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{t('web.fields')}</span>
                <span className="block text-[11.5px] text-muted-foreground">{t('web.fieldsHint')}</span>
              </span>
              <Switch checked={fields} onCheckedChange={setFields} data-web-fields />
            </label>
          )}
        </div>
        {heavy && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-800 dark:text-amber-200" data-web-warning>
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {t('web.singleWarn', { size: size(estimate!.single) })}
          </p>
        )}
        <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> {t('web.safe')}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={run} disabled={busy} className="gap-1.5" data-web-export-run>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />} {t('web.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
