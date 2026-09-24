import { Check, MessageCircle, SendHorizonal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { randomId, useCamera, useEditorVersion } from '@aifig/canvas-engine'
import type { Author, Thread } from '@aifig/shared'
import { cn } from '@/lib/utils'
import { useBoard } from '../board-context'
import { AgentAvatar } from '../chrome/TopRight'
import { useEditor } from './editor-context'

const ME: Author = { kind: 'human', id: 'human:ui', name: 'You', color: '#1C1917' }

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

/** Comment badges on blocks, the thread popover, and the new-comment composer (screen space). */
export function CommentLayer() {
  const editor = useEditor()
  useEditorVersion(editor)
  useCamera(editor)
  const { threads, map } = useThreads()
  const [openId, setOpenId] = useState<string | null>(null)
  const [composeFor, setComposeFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onCompose = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const existing = [...map.values()].find((t) => t.target === id && !t.resolved)
      setDraft('')
      if (existing) {
        setOpenId(existing.id)
        setComposeFor(null)
      } else {
        setComposeFor(id)
        setOpenId(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key !== 'm' || e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || editor.editingId) return
      const sel = editor.selectedBlocks()
      if (sel.length !== 1) return
      e.preventDefault()
      onCompose(new CustomEvent('x', { detail: sel[0].id }))
    }
    window.addEventListener('aifig:comment', onCompose)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('aifig:comment', onCompose)
      window.removeEventListener('keydown', onKey)
    }
  }, [editor, map])

  useEffect(() => {
    if (composeFor || openId) requestAnimationFrame(() => inputRef.current?.focus())
  }, [composeFor, openId])

  const anchor = (blockId: string) => {
    const r = editor.visualRect(blockId)
    return r ? editor.pageToScreen({ x: r.x + r.w, y: r.y }) : null
  }

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    const now = Date.now()
    if (composeFor) {
      const id = `t${randomId()}`
      map.set(id, { id, target: composeFor, author: ME, text, createdAt: now, resolved: false, replies: [] })
      setOpenId(id)
      setComposeFor(null)
    } else if (openId) {
      const t = map.get(openId)
      if (t) map.set(openId, { ...t, replies: [...t.replies, { id: randomId(), author: ME, text, createdAt: now }] })
    }
    setDraft('')
  }

  const open = openId ? map.get(openId) : undefined
  const popoverAt = open ? anchor(open.target) : composeFor ? anchor(composeFor) : null
  const visible = threads.filter((t) => !t.resolved && editor.block(t.target))

  return (
    <div className="pointer-events-none absolute inset-0 z-[160]">
      {visible.map((t) => {
        const p = anchor(t.target)
        if (!p) return null
        const agentReplied = t.replies.some((r) => r.author.kind === 'agent')
        return (
          <button
            key={t.id}
            data-ui
            data-thread={t.id}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setOpenId(openId === t.id ? null : t.id)
              setComposeFor(null)
            }}
            className={cn(
              'pointer-events-auto absolute flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full rounded-bl-sm px-1.5 text-[10px] font-semibold text-white shadow-md transition-transform hover:scale-110',
              agentReplied ? 'bg-violet-600' : 'bg-foreground',
            )}
            style={{ left: p.x - 6, top: p.y - 18 }}
            aria-label="Open comment"
          >
            <MessageCircle className="size-3" />
            {t.replies.length + 1}
          </button>
        )
      })}
      {popoverAt && (open || composeFor) && (
        <div
          data-ui
          onPointerDown={(e) => e.stopPropagation()}
          className="chrome pointer-events-auto absolute w-72 rounded-2xl p-3 text-sm animate-in fade-in zoom-in-95 duration-150"
          style={{ left: Math.min(popoverAt.x + 14, editor.viewport.w - 300), top: Math.max(popoverAt.y - 8, 56) }}
          data-comment-popover
        >
          {open && (
            <div className="mb-2 flex max-h-72 flex-col gap-2.5 overflow-y-auto">
              {[{ id: open.id, author: open.author, text: open.text, createdAt: open.createdAt }, ...open.replies].map((m) => (
                <div key={m.id} className="flex gap-2">
                  <AgentAvatar agent={{ name: m.author.name, color: m.author.color ?? '#1C1917' }} className="mt-0.5 size-5 text-[9px] ring-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-muted-foreground">{m.author.name}</div>
                    <div className="text-[13px] leading-snug whitespace-pre-wrap">{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpenId(null)
                  setComposeFor(null)
                }
                e.stopPropagation()
              }}
              rows={1}
              placeholder={open ? 'Reply…' : 'Comment — agents read these (get_threads)'}
              className="max-h-28 min-h-8 flex-1 resize-none rounded-lg bg-muted/70 px-2.5 py-1.5 text-[13px] outline-none"
              data-comment-input
            />
            <button onClick={submit} disabled={!draft.trim()} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40" aria-label="Send comment">
              <SendHorizonal className="size-3.5" />
            </button>
          </div>
          {open && (
            <button
              onClick={() => {
                map.set(open.id, { ...open, resolved: true, resolvedAt: Date.now() })
                setOpenId(null)
              }}
              className="mt-2 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <Check className="size-3" /> Resolve
            </button>
          )}
        </div>
      )}
    </div>
  )
}
