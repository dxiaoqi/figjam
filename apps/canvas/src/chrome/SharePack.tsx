import { AlertTriangle, Check, FileArchive, FolderOpen, History, Loader2, MessageSquare, Package, PackageOpen, Puzzle, ShieldCheck, Shapes, Files } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { formatBytes } from '@nodboard/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useBoard, useBoardTitle } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { callCore } from '../lib/core'
import { desktop } from '../lib/desktop'
import { downloadPack, uploadPack, type PackPreview } from '../lib/packs'
import { getLocale, t, useT } from '../i18n'

const size = (n: number) => formatBytes(n, getLocale())

function Row({ icon, label, detail, children }: { icon: ReactNode; label: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{label}</span>
        {detail && <span className="block truncate text-[11.5px] text-muted-foreground">{detail}</span>}
      </span>
      {children}
    </div>
  )
}

const safeFile = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'board'

/** Export the board as a .nodboardpack: the board, its files and skills, optionally history and comments. */
export function ExportPackDialog() {
  const { boardId } = useBoard()
  const title = useBoardTitle()
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<{ files: number; bytes: number; versions: number; historyBytes: number } | null>(null)
  const [history, setHistory] = useState(false)
  const [comments, setComments] = useState(true)
  const [busy, setBusy] = useState(false)
  useT()

  useEffect(() => {
    const on = () => {
      setOpen(true)
      setInfo(null)
      callCore<{ assets: { status: string; size: number }[]; history: { versions: number; bytes: number } }>('get_storage', { board: boardId })
        .then((r) => {
          const used = r.assets.filter((a) => a.status !== 'unused')
          setInfo({ files: used.length, bytes: used.reduce((n, a) => n + a.size, 0), versions: r.history.versions, historyBytes: r.history.bytes })
        })
        .catch(() => setInfo({ files: 0, bytes: 0, versions: 0, historyBytes: 0 }))
    }
    window.addEventListener('nodboard:export-pack', on)
    return () => window.removeEventListener('nodboard:export-pack', on)
  }, [boardId])

  const threads = [...editor.doc.getMap<{ resolved: boolean }>('threads').values()].length
  const skills = [...editor.doc.getMap('skills').keys()]
  const blocks = editor.blocksMap.size

  const run = async () => {
    setBusy(true)
    try {
      if (desktop?.savePath) {
        const target = await desktop.savePath({ defaultName: `${safeFile(title)}.nodboardpack`, kind: 'pack' })
        if (!target) return
        const r = await callCore<{ path: string; size: number; notes?: string[] }>('export_pack', { board: boardId, path: target, include_history: history, include_comments: comments, overwrite: true })
        toast.success(t('pack.exported', { name: r.path.split(/[\\/]/).pop() ?? '', size: size(r.size) }), {
          description: r.notes?.join(' '),
          action: desktop.revealPath ? { label: t('pack.showFile'), onClick: () => desktop!.revealPath!(r.path) } : undefined,
        })
      } else {
        const name = await downloadPack(boardId, { history, comments })
        toast.success(t('pack.downloaded', { name }))
      }
      setOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-4 sm:max-w-md" data-ui data-export-pack>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Package className="size-4 text-muted-foreground" strokeWidth={1.75} /> {t('pack.exportTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{t('pack.exportDescription', { title: title || t('board.untitled') })}</DialogDescription>
        </DialogHeader>
        <div className="divide-y rounded-xl border">
          <Row icon={<Shapes className="size-3.5" />} label={t('pack.board')} detail={t('pack.blocks', { count: blocks })} />
          <Row icon={<Files className="size-3.5" />} label={t('pack.files')} detail={info ? t('pack.filesDetail', { count: info.files, size: size(info.bytes) }) : '…'} />
          {skills.length > 0 && <Row icon={<Puzzle className="size-3.5" />} label={t('pack.skills')} detail={skills.join(', ')} />}
          <Row icon={<History className="size-3.5" />} label={t('pack.history')} detail={info ? t('pack.historyDetail', { count: info.versions, size: size(info.historyBytes) }) : '…'}>
            <Switch checked={history} onCheckedChange={setHistory} disabled={!info?.versions} aria-label={t('pack.history')} data-pack-history />
          </Row>
          <Row icon={<MessageSquare className="size-3.5" />} label={t('pack.comments')} detail={t('pack.commentsDetail', { count: threads })}>
            <Switch checked={comments} onCheckedChange={setComments} aria-label={t('pack.comments')} data-pack-comments />
          </Row>
        </div>
        <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> {t('pack.never')}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={run} disabled={busy} className="gap-1.5" data-pack-export>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileArchive className="size-4" />} {t('pack.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ImportState = { step: 'pick' } | { step: 'uploading'; name: string; pct: number } | { step: 'preview'; pack: PackPreview; name: string } | { step: 'error'; message: string }

/** Open a .nodboardpack: check it, show what's inside, extract it to a folder the person picks, open the board. */
export function ImportPackDialog() {
  const { switchBoard, refreshBoards } = useBoard()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ImportState>({ step: 'pick' })
  const [dest, setDest] = useState('')
  const [installSkills, setInstallSkills] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useT()

  const preview = (pack: PackPreview, name: string) => {
    setDest(pack.defaultDest)
    setInstallSkills(false)
    setState({ step: 'preview', pack, name })
  }

  useEffect(() => {
    const on = async (e: Event) => {
      const p = (e as CustomEvent<{ path?: string }>).detail?.path
      setOpen(true)
      setState({ step: 'pick' })
      if (!p) return setTimeout(() => input.current?.click(), 60)
      try {
        const r = await callCore<PackPreview>('inspect_pack', { path: p })
        preview(r, p.split(/[\\/]/).pop() ?? p)
      } catch (err) {
        setState({ step: 'error', message: (err as Error).message })
      }
    }
    window.addEventListener('nodboard:import-pack', on)
    return () => window.removeEventListener('nodboard:import-pack', on)
  }, [])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setState({ step: 'uploading', name: file.name, pct: 0 })
    try {
      const r = await uploadPack(file, (pct) => setState({ step: 'uploading', name: file.name, pct }))
      preview(r, file.name)
    } catch (err) {
      setState({ step: 'error', message: (err as Error).message })
    }
  }

  const run = async () => {
    if (state.step !== 'preview') return
    setBusy(true)
    try {
      const r = await callCore<{ board: { id: string; title: string }; path: string; skills: { installed: string[] }; notes?: string[] }>('import_pack', { path: state.pack.path, dest: dest.trim() || undefined, install_skills: installSkills })
      setOpen(false)
      refreshBoards()
      switchBoard(r.board.id)
      toast.success(t('pack.opened', { title: r.board.title }), { description: [t('pack.savedIn', { path: r.path }), ...(r.notes ?? [])].join(' ') })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const m = state.step === 'preview' ? state.pack.manifest : null
  const assetFiles = m?.files.filter((f) => f.path.startsWith('assets/')) ?? []
  const versions = m?.files.filter((f) => f.path.startsWith('history/')).length ?? 0

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="gap-4 sm:max-w-md" data-ui data-import-pack>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <PackageOpen className="size-4 text-muted-foreground" strokeWidth={1.75} /> {t('pack.importTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">{t('pack.importDescription')}</DialogDescription>
          </DialogHeader>

          {state.step === 'pick' && (
            <button onClick={() => input.current?.click()} className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors hover:border-foreground/30 hover:bg-accent/40" data-pack-pick>
              <FileArchive className="size-6 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-sm font-medium">{t('pack.choose')}</span>
              <span className="text-xs text-muted-foreground">{t('pack.chooseHint')}</span>
            </button>
          )}
          {state.step === 'uploading' && (
            <div className="space-y-2 rounded-xl border px-4 py-5">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-muted-foreground" /> {t('pack.checking', { name: state.name })}
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground/70 transition-[width]" style={{ width: `${Math.round(state.pct * 100)}%` }} />
              </div>
            </div>
          )}
          {state.step === 'error' && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-3.5 py-3 text-[13px]" data-pack-error>
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
              <span className="min-w-0 break-words">{state.message}</span>
            </div>
          )}
          {state.step === 'preview' && m && (
            <>
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3.5 py-3" data-pack-preview>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
                  <Package className="size-5 text-muted-foreground" strokeWidth={1.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{m.board.title}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {state.name} · {size(state.pack.size)} · {new Date(m.createdAt).toLocaleDateString(getLocale(), { dateStyle: 'medium' })}
                  </span>
                </span>
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-label={t('pack.verified')} />
              </div>
              <div className="divide-y rounded-xl border">
                <Row icon={<Shapes className="size-3.5" />} label={t('pack.board')} detail={t('pack.blocks', { count: m.board.blocks })} />
                <Row icon={<Files className="size-3.5" />} label={t('pack.files')} detail={t('pack.filesDetail', { count: assetFiles.length, size: size(assetFiles.reduce((n, f) => n + f.size, 0)) })} />
                {m.includes.history && <Row icon={<History className="size-3.5" />} label={t('pack.history')} detail={t('pack.versions', { count: versions })} />}
                <Row icon={<MessageSquare className="size-3.5" />} label={t('pack.comments')} detail={t(m.includes.comments ? 'pack.commentsIncluded' : 'pack.commentsLeftOut')} />
                {m.includes.skills.length > 0 && (
                  <Row icon={<Puzzle className="size-3.5" />} label={t('pack.skills')} detail={m.includes.skills.join(', ')}>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t('pack.install')}
                      <Switch checked={installSkills} onCheckedChange={setInstallSkills} data-pack-install-skills />
                    </label>
                  </Row>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium">{t('pack.saveTo')}</div>
                <div className="flex gap-1.5">
                  <Input value={dest} onChange={(e) => setDest(e.target.value)} className={cn('h-8 font-mono text-[12px]')} data-pack-dest />
                  {desktop?.pickFolder && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5"
                      onClick={async () => {
                        const d = await desktop!.pickFolder!(dest)
                        if (d) setDest(d)
                      }}
                    >
                      <FolderOpen className="size-3.5" /> {t('pack.chooseFolder')}
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{t('pack.saveToHint', { name: m.board.title })}</p>
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            {state.step === 'error' ? (
              <Button variant="secondary" onClick={() => input.current?.click()}>
                {t('pack.chooseAnother')}
              </Button>
            ) : (
              <Button onClick={run} disabled={state.step !== 'preview' || busy || !dest.trim()} className="gap-1.5" data-pack-import>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <PackageOpen className="size-4" />} {t('pack.open')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <input
        ref={input}
        type="file"
        accept=".nodboardpack,.aifigpack,application/zip"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? undefined)
          e.target.value = ''
        }}
        data-pack-input
      />
    </>
  )
}
