import { ArrowLeft, ArrowRight, Check, LayoutTemplate, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { COLORS, type ColorToken } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '../board-context'
import { LOCALES, useLocale, useT } from '../i18n'
import { Logo } from './BoardMenu'
import { AgentSetup } from './AgentSetup'
import { ScenarioChips } from './NewBoardDialog'
import { openNewBoard } from './new-board'

const SEEN_KEY = 'aifig:welcomed'

/**
 * First launch only. Automated browsers (tests, screenshot scripts) skip it unless the URL has `?welcome=1`,
 * so existing flows don't have to dismiss it.
 */
export function shouldShowWelcome() {
  const force = new URLSearchParams(location.search).get('welcome')
  if (force === '1') return true
  if (force === '0' || navigator.webdriver) return false
  try {
    return !localStorage.getItem(SEEN_KEY)
  } catch {
    return false
  }
}

export function markWelcomed() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    /* private mode */
  }
}

// ---- illustrations -----------------------------------------------------------------

function Note({ c, theme, className, children, style }: { c: ColorToken; theme: ThemeMode; className?: string; children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className={cn('absolute rounded-[4px] p-2 text-[11px] leading-snug font-medium shadow-sm', className)} style={{ background: COLORS[c][theme].bg, color: COLORS[c][theme].ink, ...style }}>
      {children}
    </div>
  )
}

function Lines({ w = [70, 52] }: { w?: number[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {w.map((x, i) => (
        <span key={i} className="h-1.5 rounded-full bg-current opacity-25" style={{ width: `${x}%` }} />
      ))}
    </div>
  )
}

function BoardArt({ theme }: { theme: ThemeMode }) {
  const t = useT()
  return (
    <div className="aifig-canvas relative h-full overflow-hidden" aria-hidden>
      <div className="absolute top-8 left-1/2 h-[140px] w-[328px] -translate-x-1/2 rounded-xl border max-sm:scale-90 sm:-translate-x-[62%]" style={{ background: theme === 'dark' ? '#1A1A1D' : '#F4F4F2' }}>
        <div className="absolute -top-5 left-0 text-[10px] font-medium text-muted-foreground">{t('type.insight.plural')}</div>
        <Note theme={theme} c="yellow" className="top-4 left-4 size-[88px] rotate-[-2deg]">
          <Lines />
        </Note>
        <Note theme={theme} c="purple" className="top-4 left-[120px] size-[88px]">
          <Lines w={[80, 60, 40]} />
        </Note>
        <div
          className="aifig-welcome-suggest absolute top-4 left-[224px] size-[88px] rounded-[4px] border-[1.5px] border-dashed border-[#6E56CF] p-2"
          style={{ background: COLORS.teal[theme].bg, color: COLORS.teal[theme].ink }}
        >
          <Lines w={[66, 48]} />
        </div>
      </div>
      <div className="aifig-welcome-cursor absolute top-[118px] left-1/2 translate-x-[70px] max-sm:hidden">
        <svg width="18" height="18" viewBox="0 0 22 22">
          <path d="M3 2.5 L18 9.5 L11 11.5 L8.2 18.5 Z" fill="#6E56CF" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span className="absolute top-4 left-3 rounded-full bg-[#6E56CF] px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-white shadow">Claude Code</span>
      </div>
      <div className="absolute right-5 bottom-5 hidden w-[176px] rounded-xl border bg-background/95 p-2.5 text-[10px] shadow-md sm:block">
        <div className="truncate font-medium">Claude Code · {t('review.sumNew', { count: 1 })}</div>
        <div className="mt-2 flex gap-1">
          <span className="flex-1 rounded-md border py-1 text-center">{t('review.reject')}</span>
          <span className="flex-1 rounded-md bg-primary py-1 text-center text-primary-foreground">{t('review.accept')}</span>
        </div>
      </div>
    </div>
  )
}

interface TryNote {
  id: number
  x: number
  y: number
  text: string
}

function TryArea({ theme }: { theme: ThemeMode }) {
  const t = useT()
  const [notes, setNotes] = useState<TryNote[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const colors: ColorToken[] = ['yellow', 'purple', 'teal', 'orange', 'blue']
  const add = (x: number, y: number) => {
    const id = Date.now()
    setNotes((n) => [...n, { id, x: Math.round(x / 8) * 8, y: Math.round(y / 8) * 8, text: '' }])
    setEditing(id)
  }
  const onKey = (e: ReactKeyboardEvent, n: TryNote) => {
    e.stopPropagation()
    if (e.key === 'Tab') {
      e.preventDefault()
      const w = area.current?.clientWidth ?? 400
      const nx = n.x + 96
      add(nx + 88 > w ? 16 : nx, nx + 88 > w ? n.y + 96 : n.y)
    } else if (e.key === 'Escape') setEditing(null)
  }
  return (
    <div
      ref={area}
      data-welcome-try
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('textarea')) return
        const r = e.currentTarget.getBoundingClientRect()
        add(Math.min(Math.max(8, e.clientX - r.left - 44), r.width - 96), Math.min(Math.max(8, e.clientY - r.top - 44), r.height - 96))
      }}
      className="aifig-canvas relative h-full cursor-crosshair overflow-hidden"
    >
      {!notes.length && (
        <div className="pointer-events-none absolute inset-5 flex items-center justify-center rounded-2xl border-2 border-dashed border-foreground/15 text-center text-sm text-muted-foreground">
          {t('welcome.2.try')}
        </div>
      )}
      {notes.map((n, i) => {
        const c = COLORS[colors[i % colors.length]][theme]
        return (
          <div
            key={n.id}
            className="absolute size-[88px] rounded-[4px] p-2 shadow-sm animate-in fade-in zoom-in-95 duration-150"
            style={{ left: n.x, top: n.y, background: c.bg, color: c.ink }}
            onDoubleClick={(e) => (e.stopPropagation(), setEditing(n.id))}
            data-welcome-note
          >
            {editing === n.id ? (
              <textarea
                autoFocus
                value={n.text}
                placeholder={t('welcome.2.tryPlaceholder')}
                onChange={(e) => setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, text: e.target.value } : x)))}
                onKeyDown={(e) => onKey(e, n)}
                onBlur={() => setEditing((cur) => (cur === n.id ? null : cur))}
                className="size-full resize-none bg-transparent text-[12px] leading-snug font-medium outline-none placeholder:opacity-50"
              />
            ) : (
              <div className="text-[12px] leading-snug font-medium break-words">{n.text || '…'}</div>
            )}
          </div>
        )
      })}
      {notes.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-1 text-[11px] whitespace-nowrap text-background shadow">
          {t('welcome.2.tryDone')}
        </div>
      )}
    </div>
  )
}

function AgentsArt() {
  return (
    <div className="aifig-canvas relative flex h-full items-center justify-center gap-5" aria-hidden>
      <span className="flex size-14 items-center justify-center rounded-2xl bg-[#D97757] text-xl font-semibold text-white shadow-md">C</span>
      <span className="aifig-welcome-link h-px w-12 border-t-2 border-dashed border-foreground/25 sm:w-16" />
      <Logo className="size-16 drop-shadow-md" />
      <span className="aifig-welcome-link h-px w-12 border-t-2 border-dashed border-foreground/25 sm:w-16" />
      <span className="flex size-14 items-center justify-center rounded-2xl bg-neutral-900 text-xl font-semibold text-white shadow-md dark:bg-neutral-700">⌘</span>
    </div>
  )
}

// ---- the flow ------------------------------------------------------------------------

export function Welcome({ theme, onClose }: { theme: ThemeMode; onClose: () => void }) {
  const t = useT()
  const { locale, setPref } = useLocale()
  const [step, setStep] = useState(0)
  const total = 3
  const finish = () => {
    markWelcomed()
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(total - 1, s + 1))
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const n = step + 1
  const eyebrow = t(`welcome.${n}.eyebrow` as 'welcome.1.eyebrow')
  const title = t(`welcome.${n}.title` as 'welcome.1.title')
  const body = t(`welcome.${n}.body` as 'welcome.1.body')

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/55 p-3 backdrop-blur-md animate-in fade-in duration-300 sm:p-6" role="dialog" aria-modal aria-label={t('welcome.1.eyebrow')} data-welcome data-welcome-step={n}>
      <div className="relative flex max-h-full w-[640px] max-w-full flex-col overflow-hidden rounded-[28px] border bg-card shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="relative h-[200px] shrink-0 border-b sm:h-[230px]">
          {step === 0 && <BoardArt theme={theme} />}
          {step === 1 && <TryArea theme={theme} />}
          {step === 2 && <AgentsArt />}
          <div className="absolute top-3 right-3 flex items-center gap-1">
            <div className="flex rounded-full border bg-background/85 p-0.5 text-[11px] backdrop-blur">
              {LOCALES.map((l) => (
                <button
                  key={l.id}
                  lang={l.id}
                  data-welcome-locale={l.id}
                  onClick={() => setPref(l.id)}
                  className={cn('rounded-full px-2.5 py-1 transition-colors', locale === l.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="h-7 rounded-full bg-background/85 px-2.5 text-xs backdrop-blur" onClick={finish} data-welcome-skip>
              {t('welcome.skip')} <X className="size-3" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-y-auto px-6 pt-5 pb-5 sm:px-8 sm:pt-6">
          <div className="text-xs font-medium tracking-wide text-violet-600 dark:text-violet-300" key={`e${step}`}>
            {eyebrow}
          </div>
          <h2 className="mt-1.5 text-[22px] leading-snug font-semibold tracking-tight text-balance" key={`t${step}`}>
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>

          {step === 0 && (
            <ul className="mt-4 flex flex-col gap-2 text-[13px]">
              {(['welcome.1.point1', 'welcome.1.point2', 'welcome.1.point3'] as const).map((k) => (
                <li key={k} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
          )}
          {step === 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                data-welcome-templates
                onClick={() => {
                  finish()
                  openNewBoard()
                }}
              >
                <LayoutTemplate className="size-3.5" /> {t('welcome.template')}
              </Button>
              <p className="mt-2 w-full text-xs text-muted-foreground">{t('welcome.scenarios')}</p>
              <ScenarioChips onPick={finish} className="w-full" />
            </div>
          )}
          {step === 2 && (
            <>
              <AgentSetup className="mt-4" />
              <p className="mt-2 text-xs text-muted-foreground">{t('welcome.3.later')}</p>
            </>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5" aria-label={t('welcome.step', { n, total })}>
              {Array.from({ length: total }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  aria-label={t('welcome.step', { n: i + 1, total })}
                  className={cn('h-1.5 rounded-full transition-all duration-300', i === step ? 'w-5 bg-foreground' : 'w-1.5 bg-foreground/20 hover:bg-foreground/40')}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="size-3.5" /> {t('common.back')}
                </Button>
              )}
              {step < total - 1 ? (
                <Button size="sm" className="gap-1" onClick={() => setStep(step + 1)} data-welcome-next>
                  {t('common.next')} <ArrowRight className="size-3.5" />
                </Button>
              ) : (
                <Button size="sm" onClick={finish} data-welcome-finish>
                  {t('welcome.finish')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
