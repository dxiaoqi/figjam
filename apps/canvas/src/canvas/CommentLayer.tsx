import { Check, MessageCircle, RotateCcw, SendHorizonal, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { center, randomId, useCamera, useEditorVersion } from '@aifig/canvas-engine'
import { rotatePoint, type Author, type Thread } from '@aifig/shared'
import { cn } from '@/lib/utils'
import { useBoard } from '../board-context'
import { isUnread, lastActivity, markSeen, ME_ID, setCommentPrefs, useCommentPrefs, useSeen } from './comment-prefs'
import { useEditor } from './editor-context'

const ME: Author = { kind: 'human', id: ME_ID, name: 'You', color: '#1C1917' }

type Vec = { x: number; y: number }
type Compose = { target: string; anchor?: Vec }

function useThreads() {
  const { provider } = useBoard()
  const map = provider.doc.getMap<Thread>('threads')
  const [threads, setThreads] = useState(() => [...map.values()])
  useEffect(() => {
    const update = () => setThreads([...map.values()])
    update()
    map.observe(update)
    return () => map.unobserve(update)
  }, [map])
  return { threads, map }
}

function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

function Avatar({ author, className, style }: { author: Author; className?: string; style?: CSSProperties }) {
  const mine = author.id === ME_ID
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold', mine ? 'bg-foreground text-background' : 'text-white', className)}
      style={mine ? style : { background: author.color ?? '#57534E', ...style }}
    >
      {author.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

/**
 * Comments, FigJam-style: quiet pins by default; one thread card at a time, opened by the user only.
 * Comment mode (M or the toolbar) makes pins prominent, lets a click on any block start a thread,
 * and shows the thread list.
 */
export function CommentLayer() {
  const editor = useEditor()
  useEditorVersion(editor)
  useCamera(editor)
  const { boardId } = useBoard()
  const { threads, map } = useThreads()
  const { mode, showResolved } = useCommentPrefs()
  const seen = useSeen(boardId)
  const [openId, setOpenId] = useState<string | null>(null)
  const [compose, setCompose] = useState<Compose | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const swallowUp = useRef(false)

  const close = useCallback(() => {
    setOpenId(null)
    setCompose(null)
    setDraft('')
  }, [])

  const openThread = useCallback((id: string) => {
    setCompose(null)
    setDraft('')
    setHoverId(null)
    setOpenId(id)
  }, [])

  const commentOn = useCallback(
    (target: string, anchor?: Vec) => {
      const existing = !anchor && [...map.values()].find((t) => t.target === target && !t.resolved)
      if (existing) return openThread(existing.id)
      setOpenId(null)
      setDraft('')
      setCompose({ target, anchor })
    },
    [map, openThread],
  )

  // Keyboard: M toggles comment mode, Esc closes the card first, then leaves comment mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const inComment = (e.target as HTMLElement | null)?.closest?.('[data-comment-popover]')
        if (isTyping(e.target) && !inComment) return
        if (openId || compose) {
          e.preventDefault()
          e.stopPropagation()
          close()
        } else if (mode && !editor.editingId) {
          e.preventDefault()
          e.stopPropagation()
          setCommentPrefs({ mode: false })
        }
        return
      }
      if (e.key !== 'm' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || editor.editingId) return
      e.preventDefault()
      e.stopPropagation()
      const sel = editor.selectedBlocks()
      if (!mode) {
        setCommentPrefs({ mode: true })
        if (editor.tool !== 'select') editor.setTool('select')
        if (sel.length === 1) commentOn(sel[0].id)
      } else {
        setCommentPrefs({ mode: false })
        close()
      }
    }
    const onCompose = (e: Event) => commentOn((e as CustomEvent<string>).detail)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('aifig:comment', onCompose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('aifig:comment', onCompose)
    }
  }, [editor, mode, openId, compose, close, commentOn])

  // Pointer: a click outside the comment UI closes the card; in comment mode a click on a block starts a thread.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-comment-popover],[data-thread],[data-comment-preview],[data-comment-sidebar],[data-comment-ui]')) return
      if (openId || compose) close()
      const canvas = layerRef.current?.closest('.aifig-canvas')
      if (!mode || e.button !== 0 || !canvas?.contains(t) || t.closest('[data-ui]')) return
      e.preventDefault()
      e.stopPropagation()
      swallowUp.current = true
      const rect = canvas.getBoundingClientRect()
      const page = editor.screenToPage({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      const b = editor.hitTest(page) ?? editor.hitTest(page, { frames: true })
      if (!b) {
        toast('Comments attach to blocks', { description: 'Click a sticky, card, heading or frame to leave one.', id: 'comment-hint' })
        return
      }
      const r = editor.pageRect(b.id)!
      const local = b.rotation ? rotatePoint(page, center(r), -b.rotation) : page
      const anchor = { x: Math.min(1, Math.max(0, (local.x - r.x) / r.w)), y: Math.min(1, Math.max(0, (local.y - r.y) / r.h)) }
      setOpenId(null)
      setDraft('')
      setCompose({ target: b.id, anchor })
    }
    const onUp = (e: PointerEvent) => {
      if (!swallowUp.current) return
      swallowUp.current = false
      e.stopPropagation()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
    }
  }, [editor, mode, openId, compose, close])

  const open = openId ? threads.find((t) => t.id === openId) : undefined

  // Reading a thread (including replies that arrive while it's open) clears its unread dot.
  useEffect(() => {
    if (open) markSeen(boardId, [open])
  }, [open, boardId])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [openId, open?.replies.length])

  useEffect(() => {
    if (compose || openId) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }, [compose, openId])

  useEffect(() => {
    if (openId && !map.has(openId)) setOpenId(null)
  }, [threads, openId, map])

  const anchorPoint = (target: string, anchor?: Vec) => {
    const r = editor.pageRect(target)
    if (!r) return null
    if (!anchor) {
      const v = editor.visualRect(target)!
      return editor.pageToScreen({ x: v.x + v.w, y: v.y })
    }
    const p = { x: r.x + anchor.x * r.w, y: r.y + anchor.y * r.h }
    const rot = editor.rotationOf(target)
    return editor.pageToScreen(rot ? rotatePoint(p, center(r), rot) : p)
  }

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    const now = Date.now()
    if (compose) {
      const id = `t${randomId()}`
      map.set(id, { id, target: compose.target, author: ME, text, createdAt: now, resolved: false, replies: [], ...(compose.anchor ? { anchor: compose.anchor } : {}) })
      setCompose(null)
      setOpenId(id)
    } else if (open) {
      map.set(open.id, { ...open, replies: [...open.replies, { id: randomId(), author: ME, text, createdAt: now }] })
    }
    setDraft('')
  }

  const setResolved = (t: Thread, resolved: boolean) => {
    map.set(t.id, resolved ? { ...t, resolved: true, resolvedAt: Date.now() } : { ...t, resolved: false, resolvedAt: undefined })
    if (resolved && !showResolved) close()
  }

  const live = threads.filter((t) => editor.block(t.target))
  const shown = live.filter((t) => showResolved || !t.resolved || t.id === openId)
  const z = editor.camera.z
  const scale = Math.min(1.15, Math.max(0.75, Math.sqrt(z)))
  const size = Math.round((mode ? 30 : 23) * scale)
  const tiny = !mode && z < 0.3

  const cardFor = open ? anchorPoint(open.target, open.anchor) : compose ? anchorPoint(compose.target, compose.anchor) : null
  const hover = hoverId && hoverId !== openId ? live.find((t) => t.id === hoverId) : undefined
  const hoverAt = hover ? anchorPoint(hover.target, hover.anchor) : null
  const place = (p: Vec, w: number, h: number) => ({
    left: p.x + size + 8 + w > editor.viewport.w - 12 ? Math.max(12, p.x - w - 8) : p.x + size + 8,
    top: Math.min(Math.max(p.y - size, 64), Math.max(64, editor.viewport.h - h - 96)),
  })
  const targetLabel = (id: string) => {
    const b = editor.block(id)
    const s = (b?.title || b?.text || b?.kind || '').replace(/[#*_`>\-[\]]/g, '').trim()
    return s.length > 42 ? `${s.slice(0, 40)}…` : s
  }

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-[160]" data-comment-layer data-mode={mode || undefined}>
      {shown.map((t) => {
        const p = anchorPoint(t.target, t.anchor)
        if (!p) return null
        const unread = isUnread(t, seen)
        const isOpen = t.id === openId
        const count = t.replies.length + 1
        if (tiny && !isOpen && !unread) {
          return (
            <button
              key={t.id}
              data-ui
              data-thread={t.id}
              data-resolved={t.resolved || undefined}
              onClick={() => openThread(t.id)}
              className={cn('pointer-events-auto absolute size-2.5 rounded-full ring-2 ring-background', t.resolved ? 'bg-muted-foreground/50' : 'bg-foreground/70')}
              style={{ left: p.x - 5, top: p.y - 5 }}
              aria-label={`Comment by ${t.author.name}`}
            />
          )
        }
        return (
          <button
            key={t.id}
            data-ui
            data-thread={t.id}
            data-unread={unread || undefined}
            data-resolved={t.resolved || undefined}
            onClick={() => (isOpen ? close() : openThread(t.id))}
            onPointerEnter={() => setHoverId(t.id)}
            onPointerLeave={() => setHoverId((h) => (h === t.id ? null : h))}
            className={cn(
              'group pointer-events-auto absolute origin-bottom-left transition-[transform,opacity] duration-150 ease-out hover:scale-110',
              !mode && !isOpen && !unread && 'opacity-80 hover:opacity-100',
              isOpen && 'scale-110',
            )}
            style={{ left: p.x, top: p.y - size, width: size, height: size }}
            aria-label={`${t.resolved ? 'Resolved comment' : 'Comment'} by ${t.author.name}, ${count} message${count > 1 ? 's' : ''}${unread ? ', unread' : ''}`}
          >
            <span
              className={cn(
                'flex size-full items-center justify-center rounded-full rounded-bl-none p-[2px] shadow-[0_2px_8px_rgb(0_0_0/0.18)] ring-1 ring-black/5 dark:ring-white/15',
                isOpen ? 'bg-primary' : 'bg-background',
                mode && !isOpen && 'p-[3px] shadow-[0_4px_14px_rgb(0_0_0/0.24)]',
              )}
            >
              {t.resolved ? (
                <span className="flex size-full items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Check className="size-[55%]" strokeWidth={2.5} />
                </span>
              ) : (
                <Avatar author={t.author} className="size-full" style={{ fontSize: Math.max(9, size * 0.42) }} />
              )}
            </span>
            {unread && <span data-unread-dot className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-sky-500 ring-2 ring-background" />}
            {count > 1 && (mode || isOpen || size >= 20) && (
              <span className="absolute -right-2 -bottom-1.5 min-w-4 rounded-full bg-background px-1 text-center text-[9px] leading-4 font-semibold text-foreground tabular-nums shadow-sm ring-1 ring-border">
                {count}
              </span>
            )}
          </button>
        )
      })}

      {compose && cardFor && (
        <span
          className="absolute rounded-full rounded-bl-none bg-primary p-[2px] shadow-md animate-in zoom-in-50 duration-150"
          style={{ left: cardFor.x, top: cardFor.y - size, width: size, height: size }}
        >
          <Avatar author={ME} className="size-full text-[10px]" />
        </span>
      )}

      {hover && hoverAt && (
        <div
          data-comment-preview
          className="chrome pointer-events-none absolute w-60 rounded-xl px-3 py-2 text-[12px] animate-in fade-in duration-150"
          style={place(hoverAt, 240, 90)}
        >
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{hover.author.name}</span>
            <span>· {ago(hover.createdAt)}</span>
            {hover.resolved && <span>· Resolved</span>}
          </div>
          <div className="mt-0.5 line-clamp-2 leading-snug">{hover.text}</div>
          {hover.replies.length > 0 && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <MessageCircle className="size-3" /> {hover.replies.length} {hover.replies.length === 1 ? 'reply' : 'replies'}
              {isUnread(hover, seen) && <span className="ml-1 font-medium text-sky-600 dark:text-sky-400">· New</span>}
            </div>
          )}
        </div>
      )}

      {cardFor && (open || compose) && (
        <div
          data-ui
          data-comment-popover
          onPointerDown={(e) => e.stopPropagation()}
          className="chrome pointer-events-auto absolute w-80 max-w-[calc(100vw-24px)] rounded-2xl text-sm animate-in fade-in zoom-in-95 duration-150"
          style={place(cardFor, 320, open ? 340 : 120)}
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {open ? (open.resolved ? 'Resolved · ' : '') : 'New comment · '}
              <span className="text-foreground/80">{targetLabel(open?.target ?? compose!.target)}</span>
            </div>
            {open && (
              <button
                onClick={() => setResolved(open, !open.resolved)}
                className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={open.resolved ? 'Reopen' : 'Resolve'}
              >
                {open.resolved ? <RotateCcw className="size-3" /> : <Check className="size-3" />}
                {open.resolved ? 'Reopen' : 'Resolve'}
              </button>
            )}
            <button onClick={close} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close comment">
              <X className="size-3.5" />
            </button>
          </div>
          {open && (
            <div ref={listRef} className="flex max-h-72 flex-col gap-3 overflow-y-auto px-3 pt-3" data-comment-messages>
              {[{ id: open.id, author: open.author, text: open.text, createdAt: open.createdAt }, ...open.replies].map((m) => (
                <div key={m.id} className="flex gap-2">
                  <Avatar author={m.author} className="mt-0.5 size-5 text-[9px]" />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5 text-[11px]">
                      <span className="font-medium">{m.author.name}</span>
                      <span className="text-muted-foreground">{ago(m.createdAt)}</span>
                    </div>
                    <div className="text-[13px] leading-snug break-words whitespace-pre-wrap">{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5 p-3">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
                e.stopPropagation()
              }}
              rows={1}
              placeholder={open ? 'Reply…' : 'Add a comment — agents read these'}
              className="max-h-28 min-h-8 flex-1 resize-none rounded-lg bg-muted/70 px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/80"
              data-comment-input
            />
            <button onClick={submit} disabled={!draft.trim()} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40" aria-label="Send comment">
              <SendHorizonal className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {mode && (
        <>
          <div data-comment-ui className="pointer-events-auto absolute top-3 left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-full bg-foreground py-1.5 pr-1.5 pl-3 text-[12px] text-background shadow-lg animate-in fade-in slide-in-from-top-1 duration-200 md:flex">
            <MessageCircle className="size-3.5" />
            Click a block to comment
            <button onClick={() => (close(), setCommentPrefs({ mode: false }))} className="rounded-full bg-background/15 px-2 py-0.5 text-[11px] font-medium hover:bg-background/25">
              Done <kbd className="ml-0.5 font-mono opacity-70">Esc</kbd>
            </button>
          </div>
          <CommentSidebar
            threads={live}
            seen={seen}
            openId={openId}
            showResolved={showResolved}
            label={targetLabel}
            onOpen={(t) => {
              const r = editor.visualRect(t.target)
              if (r) {
                const vp = editor.viewportPageBounds()
                const inView = r.x > vp.x && r.y > vp.y && r.x + r.w < vp.x + vp.w && r.y + r.h < vp.y + vp.h
                if (!inView) editor.zoomToBounds({ x: r.x - 360, y: r.y - 160, w: r.w + 720, h: r.h + 320 }, { maxZoom: 1 })
              }
              openThread(t.id)
            }}
          />
        </>
      )}
    </div>
  )
}

function CommentSidebar({
  threads,
  seen,
  openId,
  showResolved,
  label,
  onOpen,
}: {
  threads: Thread[]
  seen: Record<string, number>
  openId: string | null
  showResolved: boolean
  label: (id: string) => string
  onOpen: (t: Thread) => void
}) {
  const list = threads.filter((t) => showResolved || !t.resolved).sort((a, b) => lastActivity(b) - lastActivity(a))
  const openCount = threads.filter((t) => !t.resolved).length
  return (
    <aside
      data-ui
      data-comment-sidebar
      onPointerDown={(e) => e.stopPropagation()}
      className="chrome pointer-events-auto absolute top-16 left-3 flex max-h-[min(560px,calc(100%-180px))] w-[300px] max-w-[calc(100vw-24px)] flex-col rounded-2xl animate-in fade-in slide-in-from-left-2 duration-200"
    >
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <div className="flex-1 text-[13px] font-semibold">
          Comments <span className="ml-0.5 font-normal text-muted-foreground tabular-nums">{openCount}</span>
        </div>
        <button onClick={() => setCommentPrefs({ mode: false })} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close comments">
          <X className="size-3.5" />
        </button>
      </div>
      <label className="flex cursor-pointer items-center justify-between px-3.5 pb-2 text-[12px] text-muted-foreground">
        Show resolved
        <button
          role="switch"
          aria-checked={showResolved}
          aria-label="Show resolved"
          data-show-resolved
          onClick={() => setCommentPrefs({ showResolved: !showResolved })}
          className={cn('relative h-[18px] w-8 rounded-full transition-colors', showResolved ? 'bg-primary' : 'bg-muted-foreground/30')}
        >
          <span className={cn('absolute top-[2px] left-[2px] size-[14px] rounded-full bg-background shadow-sm transition-transform', showResolved && 'translate-x-[14px]')} />
        </button>
      </label>
      <div className="h-px bg-border/60" />
      <div className="flex-1 overflow-y-auto p-1.5">
        {list.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
            <MessageCircle className="mx-auto mb-2 size-5 opacity-60" />
            {threads.length ? 'All caught up — no open comments.' : 'No comments yet.'}
            <br />
            Click any block to start a thread. Agents read and reply over MCP.
          </div>
        ) : (
          list.map((t) => {
            const unread = isUnread(t, seen)
            const last = t.replies.at(-1)
            return (
              <button
                key={t.id}
                data-sidebar-thread={t.id}
                onClick={() => onOpen(t)}
                className={cn('flex w-full gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent', openId === t.id && 'bg-accent', t.resolved && 'opacity-60')}
              >
                <Avatar author={t.author} className="mt-0.5 size-6 text-[10px]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="truncate font-medium">{t.author.name}</span>
                    <span className="shrink-0 text-muted-foreground">{ago(lastActivity(t))}</span>
                    {t.resolved && <Check className="size-3 shrink-0 text-muted-foreground" />}
                    {unread && <span className="ml-auto size-2 shrink-0 rounded-full bg-sky-500" />}
                  </div>
                  <div className="line-clamp-2 text-[12.5px] leading-snug">{t.text}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {t.replies.length > 0 ? `${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'} · ${last!.author.name}: ${last!.text}` : `on ${label(t.target)}`}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
