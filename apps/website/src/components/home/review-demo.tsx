'use client'

import { Check, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dict } from '@/i18n'
import { cn } from '@/lib/utils'

type Phase = 'idle' | 'drafting' | 'review' | 'accepted' | 'rejected'
const accents = ['var(--tk-blue-accent)', 'var(--tk-purple-accent)', 'var(--tk-teal-accent)']
const AGENT = 'var(--tk-agent-0)'
const AGENT_LABEL = 'var(--agent-label)'

/** A miniature canvas: an agent drafts three cards into a frame as a change set; you accept or reject it. */
export function ReviewDemo({ t }: { t: Dict['home']['presence']['demo'] }) {
  const root = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const timers = useRef<number[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [shown, setShown] = useState(0)
  const [cursor, setCursor] = useState({ x: 24, y: 24, visible: false })

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }
  const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))

  const pointAt = useCallback((i: number) => {
    const el = cardRefs.current[i]
    const box = root.current
    if (!el || !box) return
    const a = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    setCursor({ x: a.left - b.left + a.width * 0.72, y: a.top - b.top + a.height * 0.7, visible: true })
  }, [])

  const run = useCallback(() => {
    clear()
    setShown(0)
    setPhase('drafting')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(3)
      setPhase('review')
      return
    }
    setCursor((c) => ({ ...c, visible: true }))
    at(350, () => {
      setShown(1)
      pointAt(0)
    })
    at(1150, () => {
      setShown(2)
      pointAt(1)
    })
    at(1950, () => {
      setShown(3)
      pointAt(2)
    })
    at(2900, () => setPhase('review'))
  }, [pointAt])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          run()
          io.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      clear()
    }
  }, [run])

  useLayoutEffect(() => {
    if (shown > 0 && phase === 'drafting') pointAt(shown - 1)
  }, [shown, phase, pointAt])

  const decide = (d: 'accepted' | 'rejected') => {
    if (phase !== 'review') return
    setPhase(d)
    setCursor((c) => ({ ...c, visible: false }))
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'a' || e.key === 'A') decide('accepted')
    if (e.key === 'r' || e.key === 'R') decide('rejected')
  }

  const working = phase === 'drafting'
  const pending = phase === 'drafting' || phase === 'review'

  return (
    <div
      ref={root}
      role="group"
      aria-label={t.label}
      onKeyDown={onKey}
      className="dot-grid shot relative isolate overflow-hidden rounded-xl border border-black/[0.07] p-5 pb-28 sm:p-8 sm:pb-32"
    >
      <p className="mb-2 text-[12px] font-medium text-stone-500">{t.frame}</p>
      <div
        className={cn(
          'relative rounded-xl border border-black/[0.06] bg-frame p-4 transition-shadow sm:p-5',
          working && 'agent-focus',
        )}
        style={working ? { outline: `1.5px solid ${AGENT}`, outlineOffset: 4 } : undefined}
      >
        <div className="grid min-h-[228px] grid-cols-1 gap-3 sm:min-h-[132px] sm:grid-cols-3 sm:gap-4">
          {t.cards.map((c, i) => (
            <div
              key={c.title}
              ref={(el) => {
                cardRefs.current[i] = el
              }}
              className={cn(
                'relative rounded-lg transition-opacity',
                i < shown ? 'animate-sticky-in' : 'invisible',
                pending && i < shown && 'pending-outline opacity-[0.88]',
                phase === 'accepted' && 'accepted-outline',
                phase === 'rejected' && 'rejected',
              )}
              style={{ '--agent': AGENT } as React.CSSProperties}
            >
              <div className="relative overflow-hidden rounded-lg border border-black/[0.07] bg-white px-3.5 pt-4 pb-3 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_2px_8px_rgb(0_0_0/0.04)]">
                <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: accents[i] }} />
                <p className="text-[13.5px] font-semibold text-stone-900">{c.title}</p>
                <p className="mt-0.5 text-[12.5px] text-stone-500">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 z-10 transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, opacity: cursor.visible ? 1 : 0 }}
      >
        <svg width="16" height="18" viewBox="0 0 16 18" className="drop-shadow-sm">
          <path d="M1 1l13 6.5-5.6 1.6L6 15z" fill={AGENT} stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span
          className="ml-3 -mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium whitespace-nowrap text-white shadow-sm"
          style={{ background: AGENT_LABEL }}
        >
          {t.agent}
          <span className="hidden opacity-80 sm:inline">· {t.status}</span>
        </span>
      </div>

      <div className="absolute inset-x-3 bottom-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[320px]">
        {phase === 'review' && (
          <div className="animate-sticky-in rounded-xl border border-black/[0.08] bg-white p-3.5 shadow-[0_8px_24px_-6px_rgb(28_25_23/0.18)]">
            <div className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: AGENT_LABEL }}>
                C
              </span>
              <p className="truncate text-[13px] font-semibold text-stone-900">{t.intent}</p>
            </div>
            <p className="mt-1 pl-7 text-[12px] text-stone-500">{t.summary}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => decide('rejected')}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-[12.5px] font-medium text-stone-700 hover:bg-stone-50"
              >
                <X className="size-3.5" aria-hidden />
                {t.reject}
                <kbd className="ml-1 font-sans text-[10.5px] text-stone-400">R</kbd>
              </button>
              <button
                type="button"
                onClick={() => decide('accepted')}
                autoFocus={false}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-stone-900 px-3 text-[12.5px] font-medium text-white hover:bg-stone-800"
              >
                <Check className="size-3.5" aria-hidden />
                {t.accept}
                <kbd className="ml-1 font-sans text-[10.5px] text-white/50">A</kbd>
              </button>
            </div>
          </div>
        )}
        {(phase === 'accepted' || phase === 'rejected') && (
          <div className="animate-sticky-in flex items-center justify-between gap-3 rounded-xl border border-black/[0.08] bg-white px-3.5 py-3 shadow-[0_8px_24px_-6px_rgb(28_25_23/0.18)]">
            <p className="text-[13px] text-stone-700" role="status">
              {phase === 'accepted' ? t.accepted : t.rejected}
            </p>
            <button
              type="button"
              onClick={run}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-stone-600 hover:bg-stone-100"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t.replay}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
