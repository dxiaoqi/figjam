import { Eye, ListTree, Maximize, MessageCircle, Minus, Moon, Plus, Sun, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as Y from 'yjs'
import { CanvasView, Editor, useCamera } from '@aifig/canvas-engine'
import { COLORS, rotatePoint, SURFACES, type Block, type Thread, type WebExportData } from '@aifig/shared'
import { cn } from '@/lib/utils'
import { HeaderMark } from '../chrome/BoardMenu'
import { ago, relationLabel, t, useT } from '../i18n'
import { useViewer, viewer, viewerShapes } from './blocks'

function lodStyle(b: Block) {
  const mode = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  const s = SURFACES[mode]
  const c = COLORS[b.color] ?? COLORS.gray
  if (b.kind === 'frame') return { fill: s.frame, stroke: s.border }
  if (b.kind === 'card') return { fill: s.surface, stroke: s.border, accent: c[mode].accent }
  if (b.kind === 'text') return { fill: 'rgba(0,0,0,0)', accent: s.muted }
  if (b.kind === 'image' || b.kind === 'web') return { fill: s.border, stroke: s.border }
  if (b.kind === 'video') return { fill: '#1c1917', stroke: s.border }
  return { fill: c[mode].bg, accent: c[mode].accent }
}

function docFrom(data: WebExportData) {
  const doc = new Y.Doc()
  doc.transact(() => {
    const blocks = doc.getMap<Block>('blocks')
    for (const b of data.blocks) blocks.set(b.id, b)
    const conns = doc.getMap('connectors')
    for (const c of data.connectors) conns.set(c.id, c)
  })
  return doc
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('chrome pointer-events-auto flex items-center gap-1 rounded-xl p-1', className)}>{children}</div>
}

function ToolButton({ label, pressed, onClick, children, ...rest }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode } & Record<`data-${string}`, string | boolean>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn('flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium transition-colors', pressed ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Comment pins on their blocks; a pin opens the thread (read-only). */
function Pins({ editor, threads }: { editor: Editor; threads: Thread[] }) {
  const cam = useCamera(editor)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    const close = (e: PointerEvent) => !(e.target as HTMLElement).closest('[data-viewer-thread],[data-viewer-pin]') && setOpen(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])
  return (
    <>
      {threads.map((th) => {
        const r = editor.pageRect(th.target)
        if (!r) return null
        const b = editor.block(th.target)
        const ax = th.anchor?.x ?? 1
        const ay = th.anchor?.y ?? 0
        const p = rotatePoint({ x: r.x + ax * r.w, y: r.y + ay * r.h }, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, b?.rotation ?? 0)
        const x = cam.x + p.x * cam.z
        const y = cam.y + p.y * cam.z
        const isOpen = open === th.id
        return (
          <div key={th.id} className="pointer-events-none absolute top-0 left-0 z-[5]" style={{ transform: `translate(${x}px, ${y}px)` }}>
            <button
              type="button"
              data-ui
              data-viewer-pin={th.id}
              onClick={() => setOpen(isOpen ? null : th.id)}
              className={cn('aifig-viewer-pin pointer-events-auto', th.resolved && 'is-resolved', isOpen && 'is-open')}
              aria-label={t('viewer.openComment', { name: th.author.name })}
            >
              <span>{th.author.name.slice(0, 1).toUpperCase()}</span>
              {th.replies.length > 0 && <em>{th.replies.length + 1}</em>}
            </button>
            {isOpen && (
              <div data-ui data-viewer-thread={th.id} className="chrome pointer-events-auto absolute top-3 left-5 w-72 rounded-xl p-3 text-[13px] shadow-lg">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-muted-foreground">{b?.kind === 'card' ? b.title : b?.text?.slice(0, 40)}</span>
                  <button className="rounded p-0.5 text-muted-foreground hover:bg-accent" aria-label={t('common.close')} onClick={() => setOpen(null)}>
                    <X className="size-3.5" />
                  </button>
                </div>
                {[{ id: th.id, author: th.author, text: th.text, createdAt: th.createdAt }, ...th.replies].map((m) => (
                  <div key={m.id} className="border-t py-2 first-of-type:border-t-0 first-of-type:pt-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12.5px] font-semibold">{m.author.name}</span>
                      <span className="text-[11px] text-muted-foreground">{ago(m.createdAt, Date.now(), 'short')}</span>
                    </div>
                    <div className="leading-snug whitespace-pre-wrap">{m.text}</div>
                  </div>
                ))}
                {th.resolved && <div className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{t('viewer.resolved')}</div>}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function ZoomChip({ editor }: { editor: Editor }) {
  const cam = useCamera(editor)
  return (
    <Chip>
      <ToolButton label={t('zoom.out')} onClick={() => editor.zoomOut()}>
        <Minus className="size-4" />
      </ToolButton>
      <button type="button" onClick={() => editor.resetZoom()} className="w-12 text-center text-[12px] text-muted-foreground tabular-nums hover:text-foreground" data-viewer-zoom>
        {Math.round(cam.z * 100)}%
      </button>
      <ToolButton label={t('zoom.in')} onClick={() => editor.zoomIn()}>
        <Plus className="size-4" />
      </ToolButton>
      <ToolButton label={t('zoom.fit')} onClick={() => editor.zoomToFit()}>
        <Maximize className="size-4" />
      </ToolButton>
    </Chip>
  )
}

export function Viewer() {
  const { data, fields } = useViewer()
  useT()
  const [dark, setDark] = useState(data.theme === 'dark')
  const [comments, setComments] = useState(data.options.comments && data.threads.length > 0)
  const editor = useMemo(() => new Editor({ doc: docFrom(data), shapes: viewerShapes, author: { kind: 'human', id: 'viewer', name: 'Viewer' }, readOnly: true, lodStyle, relationLabel }), [data])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  useEffect(() => {
    document.title = `${data.title} — ai-figma`
    const raf = requestAnimationFrame(() => editor.zoomToFit(false))
    ;(window as { editor?: Editor }).editor = editor
    return () => cancelAnimationFrame(raf)
  }, [editor, data.title])
  // leave an interactive snippet: click elsewhere or Esc
  useEffect(() => {
    const leave = (e: PointerEvent) => {
      const el = e.target as HTMLElement
      if (!el.closest('[data-viewer-snippet]')) viewer.set({ active: null })
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && viewer.set({ active: null })
    // Esc pressed inside a snippet (its frame has the keyboard)
    const exit = (e: MessageEvent) => {
      const m = e.data as { aifig?: number; type?: string } | null
      if (m?.aifig === 1 && m.type === 'exit' && [...document.querySelectorAll('iframe')].some((f) => f.contentWindow === e.source)) viewer.set({ active: null })
    }
    window.addEventListener('pointerdown', leave, true)
    window.addEventListener('keydown', esc)
    window.addEventListener('message', exit)
    return () => {
      window.removeEventListener('pointerdown', leave, true)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('message', exit)
    }
  }, [])

  const typed = data.blocks.some((b) => b.type)
  const threads = data.threads.filter((th) => data.blocks.some((b) => b.id === th.target))
  const date = new Date(data.exportedAt)

  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--canvas)]" data-viewer>
      <CanvasView editor={editor} className="aifig-canvas">
        {comments && <Pins editor={editor} threads={threads} />}
      </CanvasView>
      {!data.blocks.length && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('viewer.empty')}</div>}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[300] flex flex-wrap items-start justify-between gap-2 p-3">
        <Chip className="max-w-[min(520px,70vw)] px-2.5 py-1.5">
          <HeaderMark />
          <div className="ml-1 min-w-0">
            <div className="truncate text-sm font-semibold" data-viewer-title>
              {data.title}
            </div>
            <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              <Eye className="size-3 shrink-0" /> {t('viewer.readOnly', { date: date.toLocaleDateString(undefined, { dateStyle: 'medium' }) })}
            </div>
          </div>
        </Chip>
        <Chip>
          {threads.length > 0 && (
            <ToolButton label={t('viewer.comments')} pressed={comments} onClick={() => setComments((c) => !c)} data-toggle-comments>
              <MessageCircle className="size-4" /> <span className="hidden sm:inline">{t('viewer.comments')}</span> <span className="tabular-nums opacity-70">{threads.length}</span>
            </ToolButton>
          )}
          {typed && (
            <ToolButton label={t('viewer.fields')} pressed={fields} onClick={() => viewer.set({ fields: !fields })} data-toggle-fields>
              <ListTree className="size-4" /> <span className="hidden sm:inline">{t('viewer.fields')}</span>
            </ToolButton>
          )}
          <ToolButton label={t(dark ? 'top.lightMode' : 'top.darkMode')} onClick={() => setDark((d) => !d)} data-toggle-theme>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </ToolButton>
        </Chip>
      </div>
      <div className="pointer-events-none absolute right-0 bottom-0 z-[300] p-3">
        <ZoomChip editor={editor} />
      </div>
      <div className="chrome pointer-events-none absolute bottom-3 left-3 z-[300] hidden rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground sm:block">{t('viewer.madeWith')}</div>
    </div>
  )
}
