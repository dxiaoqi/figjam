import { Check, ChevronLeft, ChevronRight, Crosshair, ListChecks, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { union, type Box } from '@aifig/canvas-engine'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Asset, Block, ChangeSet, Connector, WebSnippet } from '@aifig/shared'
import { useBoard, useChangeSets } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { callCore } from '../lib/core'
import { snippetText } from '../lib/assets'
import { blockChanges, type DiffPart, type FieldChange } from '../lib/diff'
import { AgentAvatar, useNow } from './TopRight'
import { ago, t, tn, useT, type MessageKey } from '../i18n'

function summarize(cs: ChangeSet) {
  let blocks = 0
  let frames = 0
  let connectors = 0
  let edits = 0
  let removed = 0
  const seenUpdate = new Set<string>()
  for (const e of cs.entries) {
    if (e.op === 'create' && e.target === 'block') blocks++
    else if (e.op === 'create') connectors++
    else if (e.op === 'update' && !seenUpdate.has(e.id)) {
      seenUpdate.add(e.id)
      if ((e.before as any).kind === 'frame') frames++
      else edits++
    } else if (e.op === 'delete') removed++
  }
  const parts: string[] = []
  if (blocks) parts.push(t('review.sumNew', { count: blocks }))
  if (connectors) parts.push(t('review.sumConnectors', { count: connectors }))
  if (edits) parts.push(t('review.sumEdited', { count: edits }))
  if (frames && !edits) parts.push(t('review.sumFrames', { count: frames }))
  if (removed) parts.push(t('review.sumRemoved', { count: removed }))
  return parts.join(' · ') || t('review.none')
}

interface ReviewItem {
  id: string
  label: string
  op: 'create' | 'update' | 'delete'
}

const snippet = (s?: string) => {
  const t = (s ?? '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 59)}…` : t
}

/** One reviewable item per block / connector the change set touches. */
function itemsOf(cs: ChangeSet, editor: ReturnType<typeof useEditor>): ReviewItem[] {
  const seen = new Map<string, ReviewItem>()
  for (const e of cs.entries) {
    if (seen.has(e.id)) continue
    const cur = (e.target === 'block' ? editor.block(e.id) : editor.connector(e.id)) ?? (e.op !== 'create' ? (e.before as Block | Connector) : undefined)
    let what = ''
    if (e.target === 'connector') {
      const c = cur as Connector | undefined
      const name = (id?: string | null) => {
        const b = id ? editor.block(id) : undefined
        return b ? `“${snippet(b.kind === 'card' || b.kind === 'frame' ? b.title : b.text) || kindName(b.kind)}”` : t('review.aPoint')
      }
      what = t('review.connectorWhat', { from: name(c?.from), to: name(c?.to) })
    } else {
      const b = cur as Block | undefined
      const text = b ? snippet(b.kind === 'card' || b.kind === 'frame' ? b.title || b.text : b.text) : ''
      what = `${kindName(b?.kind ?? 'block')}${text ? ` “${text}”` : ''}`
      if (e.op === 'update' && b?.kind === 'frame') {
        seen.set(e.id, { id: e.id, op: 'update', label: t('review.itemResized', { text: text ? ` “${text}”` : '' }) })
        continue
      }
    }
    seen.set(e.id, { id: e.id, op: e.op, label: t(e.op === 'create' ? 'review.itemNew' : e.op === 'update' ? 'review.itemEdited' : 'review.itemRemoved', { what }) })
  }
  return [...seen.values()]
}

function Parts({ parts }: { parts: DiffPart[] }) {
  return (
    <span className="break-words whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.kind === 'same' ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === 'add' ? (
          <ins key={i} className="rounded-sm bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-300" data-diff="add">
            {p.text}
          </ins>
        ) : (
          <del key={i} className="rounded-sm bg-red-500/10 text-red-700/80 dark:text-red-300/80" data-diff="del">
            {p.text}
          </del>
        ),
      )}
    </span>
  )
}

const kindName = (k: string) => t(`kind.${k}` as MessageKey)

const direction = (dx: number, dy: number) =>
  [dx ? t(dx > 0 ? 'review.dirRight' : 'review.dirLeft', { n: Math.abs(dx) }) : '', dy ? t(dy > 0 ? 'review.dirDown' : 'review.dirUp', { n: Math.abs(dy) }) : ''].filter(Boolean).join(', ')

function ChangeRow({ c }: { c: FieldChange }) {
  const label = (s: string) => <span className="w-14 shrink-0 text-muted-foreground">{s}</span>
  switch (c.field) {
    case 'text':
    case 'title':
    case 'source':
      return (
        <div className={cn('flex gap-2', c.field === 'source' && 'font-mono text-[11px]')} data-diff-field={c.field}>
          {label(t(c.field === 'title' ? 'review.fieldTitle' : c.field === 'source' ? 'review.fieldSource' : 'review.fieldText'))}
          <Parts parts={c.parts} />
        </div>
      )
    case 'moved':
      return (
        <div className="flex gap-2" data-diff-field="moved">
          {label(t('review.fieldMoved'))}
          <span>{t('review.ghostHint', { dir: direction(c.dx, c.dy) })}</span>
        </div>
      )
    default:
      return (
        <div className="flex gap-2" data-diff-field={c.field}>
          {label(t(({ resized: 'review.fieldSize', color: 'review.fieldColor', size: 'review.fieldScale', rotation: 'review.fieldRotation', frame: 'review.fieldFrame', url: 'review.fieldUrl' } as const)[c.field]))}
          <span>
            <span className="text-muted-foreground line-through">{c.from}</span> → {c.to}
          </span>
        </div>
      )
  }
}

/** Before/after for the item under review. */
function ItemDiff({ cs, id }: { cs: ChangeSet; id: string }) {
  const editor = useEditor()
  const { boardId } = useBoard()
  const entry = cs.entries.find((e) => e.id === id)
  const now0 = editor.block(id)
  const first0 = cs.entries.find((e) => e.id === id && e.op === 'update') as { before: Block } | undefined
  // snippet source lives in files: read both sides before diffing
  const [texts, setTexts] = useState<{ key: string; before: Pick<WebSnippet, 'html' | 'css' | 'js'>; now: Pick<WebSnippet, 'html' | 'css' | 'js'> } | null>(null)
  const srcKey = `${JSON.stringify(first0?.before.web?.src ?? null)}|${JSON.stringify(now0?.web?.src ?? null)}`
  useEffect(() => {
    if (!first0?.before.web?.src && !now0?.web?.src) return
    let live = true
    const assets = editor.doc.getMap<Asset>('assets')
    Promise.all([snippetText(boardId, assets, first0?.before.web), snippetText(boardId, assets, now0?.web)])
      .then(([before, now]) => live && setTexts({ key: srcKey, before, now }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [srcKey, boardId, editor])
  if (!entry || entry.target !== 'block') return null
  const frameTitle = (fid?: string | null) => (fid ? editor.block(fid)?.title || kindName('frame') : t('review.canvas'))
  let body: ReactNode = null
  if (entry.op === 'update') {
    let now = now0
    let before = first0?.before
    if (!now || !before) return null
    if (texts?.key === srcKey && now.web && before.web) {
      now = { ...now, web: { ...now.web, ...texts.now } }
      before = { ...before, web: { ...before.web, ...texts.before } }
    }
    const changes = blockChanges(before, now, frameTitle)
    if (!changes.length) return null
    body = changes.map((c, i) => <ChangeRow key={i} c={c} />)
  } else if (entry.op === 'delete') {
    const b = entry.before as Block
    body = (
      <div className="flex gap-2">
        <span className="w-14 shrink-0 text-muted-foreground">{t('review.removed')}</span>
        <del className="text-red-700/80 dark:text-red-300/80">{snippet(b.kind === 'card' ? `${b.title ?? ''} ${b.text}` : b.text) || kindName(b.kind)}</del>
      </div>
    )
  } else {
    const b = editor.block(id)
    if (!b || (!b.text && !b.title)) return null
    body = (
      <div className="flex gap-2">
        <span className="w-14 shrink-0 text-muted-foreground">{t('review.adds')}</span>
        <ins className="text-emerald-800 no-underline dark:text-emerald-300">{snippet(b.kind === 'card' ? `${b.title ?? ''} — ${b.text}` : b.text)}</ins>
      </div>
    )
  }
  return (
    <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg bg-muted/50 px-2.5 py-2 text-[12px] leading-snug" data-item-diff>
      {body}
    </div>
  )
}

export function ReviewPanel() {
  const editor = useEditor()
  const { boardId } = useBoard()
  const all = useChangeSets()
  const now = useNow(5000)
  useT()
  const [busy, setBusy] = useState<string | null>(null)
  const pending = useMemo(
    () => all.filter((c) => (c.status === 'pending' || c.status === 'open') && c.entries.length).sort((a, b) => b.updatedAt - a.updatedAt),
    [all],
  )

  const review = useCallback(
    async (id: string, action: 'accept' | 'reject') => {
      setBusy(id)
      try {
        const r = await callCore<{ reviewed: string[] }>('review_change_set', { board: boardId, id, action })
        const n = r.reviewed.length
        toast(t(action === 'accept' ? 'review.accepted' : 'review.rejected', { count: n }))
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [boardId],
  )

  // ---- item-by-item review (J / K to move, A / R to decide) ----
  const [itemMode, setItemMode] = useState<{ csId: string; index: number } | null>(null)
  const [reason, setReason] = useState('')
  const activeCs = itemMode ? pending.find((c) => c.id === itemMode.csId) : undefined
  const items = useMemo(() => (activeCs ? itemsOf(activeCs, editor) : []), [activeCs, editor])
  const index = itemMode ? Math.min(itemMode.index, Math.max(0, items.length - 1)) : 0
  const current = items[index]

  useEffect(() => {
    if (itemMode && !activeCs) setItemMode(null)
  }, [itemMode, activeCs])

  // follow the current item on the canvas
  useEffect(() => {
    if (!current) return
    const b = editor.block(current.id)
    const c = editor.connector(current.id)
    let box: Box | null = null
    if (b) box = editor.visualRect(b.id)
    else if (c) {
      const r = editor.connectorRoute(c)
      box = r ? union(r.points.map((p) => ({ x: p.x, y: p.y, w: 1, h: 1 }))) : null
    }
    if (b || c) editor.select([current.id])
    if (box) editor.zoomToBounds(box, { inset: 200, maxZoom: 1 })
  }, [current?.id, editor])

  const decideItem = useCallback(
    async (action: 'accept' | 'reject') => {
      if (!activeCs || !current) return
      setBusy(activeCs.id)
      try {
        await callCore('review_change_set', { board: boardId, id: activeCs.id, action, items: [current.id], reason: action === 'reject' && reason.trim() ? reason.trim() : undefined })
        setReason('')
        if ((document.activeElement as HTMLElement | null)?.dataset.reviewReason) (document.activeElement as HTMLElement).blur()
        if (items.length <= 1) {
          toast(t('review.reviewed'))
          setItemMode(null)
        }
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [activeCs, current, boardId, reason, items.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !t.dataset.reviewReason) || editor.editingId) return
      if (t.dataset.reviewReason && e.key !== 'Enter' && e.key !== 'Escape') return
      if (!itemMode) {
        if (e.key === 'j' && !e.metaKey && !e.ctrlKey && !e.altKey && pending.length) {
          e.preventDefault()
          e.stopPropagation()
          setItemMode({ csId: pending[0].id, index: 0 })
        }
        return
      }
      const k = e.key.toLowerCase()
      const handled = ['j', 'k', 'a', 'r', 'escape', 'arrowdown', 'arrowup'].includes(k) || (k === 'enter' && t.dataset.reviewReason)
      if (!handled || e.metaKey || e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      if (k === 'escape') setItemMode(null)
      else if (k === 'j' || k === 'arrowdown') setItemMode({ ...itemMode, index: Math.min(index + 1, items.length - 1) })
      else if (k === 'k' || k === 'arrowup') setItemMode({ ...itemMode, index: Math.max(index - 1, 0) })
      else if (k === 'a' && e.shiftKey) activeCs && review(activeCs.id, 'accept')
      else if (k === 'a') decideItem('accept')
      else if (k === 'r' || k === 'enter') decideItem('reject')
    }
    // capture phase: while reviewing, these keys must not reach the canvas shortcuts
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [itemMode, index, items.length, pending, decideItem, review, activeCs, editor])

  const locate = (cs: ChangeSet) => {
    const ids = cs.entries.map((e) => e.id).filter((id) => editor.block(id))
    const b = union(ids.map((id) => editor.pageRect(id)).filter(Boolean) as Box[])
    if (!b) return
    editor.zoomToBounds(b, { inset: 120, maxZoom: 1 })
    editor.select(ids)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !pending.length || editor.editingId) return
      if (e.code === 'KeyA') {
        e.preventDefault()
        review(pending[0].id, 'accept')
      } else if (e.code === 'KeyR') {
        e.preventDefault()
        review(pending[0].id, 'reject')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, review, editor])

  if (!pending.length) return null

  return (
    <div className="pointer-events-auto absolute right-3 bottom-24 z-[300] sm:bottom-11 flex w-[340px] max-w-[calc(100vw-24px)] flex-col gap-2">
      {pending.length > 1 && (
        <div className="chrome flex items-center justify-between rounded-xl py-1.5 pr-1.5 pl-3 text-xs">
          <span className="font-medium">{t('review.changesToReview', { count: pending.length })}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => review('all', 'reject')}>
              {t('review.rejectAll')}
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => review('all', 'accept')}>
              {t('review.acceptAll')}
            </Button>
          </div>
        </div>
      )}
      {pending.length > 1 && (
        <div className="chrome flex flex-col rounded-2xl p-1">
          {pending.slice(1, 5).map((cs) => (
            <div key={cs.id} className={cn('group flex items-center gap-2 rounded-xl py-1.5 pr-1 pl-2 hover:bg-accent/60', busy === cs.id && 'opacity-60')}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: cs.author.color ?? '#6E56CF' }} />
              <button className="min-w-0 flex-1 text-left" onClick={() => locate(cs)}>
                <div className="truncate text-xs font-medium">{cs.intent}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {cs.author.name} · {summarize(cs)} · {ago(cs.updatedAt, now)}
                </div>
              </button>
              <Button size="icon" variant="ghost" className="size-7" disabled={!!busy} onClick={() => review(cs.id, 'reject')} aria-label={t('review.reject')}>
                <X className="size-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="size-7" disabled={!!busy} onClick={() => review(cs.id, 'accept')} aria-label={t('review.accept')}>
                <Check className="size-3.5" />
              </Button>
            </div>
          ))}
          {pending.length > 5 && <div className="px-2 py-1 text-[11px] text-muted-foreground">{t('review.more', { count: pending.length - 5 })}</div>}
        </div>
      )}
      {activeCs && current && (
        <div
          className="chrome animate-in fade-in rounded-2xl p-3 duration-150"
          style={{ borderColor: `color-mix(in srgb, ${activeCs.author.color ?? '#6E56CF'} 45%, var(--border))` }}
          data-review-items
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AgentAvatar agent={{ name: activeCs.author.name, color: activeCs.author.color ?? '#6E56CF' }} className="size-5 text-[9px] ring-0" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-foreground">{activeCs.intent}</span>
            </span>
            <span className="tabular-nums" data-review-position>
              {index + 1} / {items.length}
            </span>
          </div>
          <div className="mt-2.5 flex items-start gap-2">
            <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', current.op === 'create' ? 'bg-emerald-500' : current.op === 'update' ? 'bg-amber-500' : 'bg-red-500')} />
            <div className="text-[13px] leading-snug font-medium" data-review-item={current.id}>
              {current.label}
            </div>
          </div>
          <ItemDiff cs={activeCs} id={current.id} />
          <input
            data-review-reason="true"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('review.reasonPlaceholder')}
            className="mt-2.5 h-8 w-full rounded-lg bg-muted/70 px-2.5 text-xs outline-none placeholder:text-muted-foreground/70"
          />
          <div className="mt-2 flex items-center gap-1.5">
            <Button size="icon" variant="ghost" className="size-8" disabled={index === 0} onClick={() => setItemMode({ ...itemMode!, index: index - 1 })} aria-label={t('review.prev')}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" className="size-8" disabled={index >= items.length - 1} onClick={() => setItemMode({ ...itemMode!, index: index + 1 })} aria-label={t('review.next')}>
              <ChevronRight className="size-4" />
            </Button>
            <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5 text-xs" disabled={!!busy} onClick={() => decideItem('reject')}>
              <X className="size-3.5" /> {t('review.reject')} <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">R</kbd>
            </Button>
            <Button size="sm" className="h-8 flex-1 gap-1.5 text-xs" disabled={!!busy} onClick={() => decideItem('accept')}>
              <Check className="size-3.5" /> {t('review.accept')} <kbd className="ml-auto font-mono text-[10px] opacity-60">A</kbd>
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {tn('review.keys', { j: <kbd className="font-mono">J</kbd>, k: <kbd className="font-mono">K</kbd>, esc: <kbd className="font-mono">Esc</kbd> })}
            </span>
            <button className="font-medium text-foreground hover:underline" onClick={() => review(activeCs.id, 'accept')}>
              {t('review.acceptRest')} <kbd className="font-mono opacity-60">⇧A</kbd>
            </button>
          </div>
        </div>
      )}
      {!activeCs && pending.slice(0, 1).map((cs, i) => (
        <div
          key={cs.id}
          className={cn('chrome animate-in fade-in slide-in-from-bottom-2 rounded-2xl p-3 duration-200', busy === cs.id && 'opacity-60')}
          style={{ borderColor: `color-mix(in srgb, ${cs.author.color ?? '#6E56CF'} 35%, var(--border))` }}
        >
          <div className="flex items-start gap-2.5">
            <AgentAvatar agent={{ name: cs.author.name, color: cs.author.color ?? '#6E56CF' }} className="mt-0.5 size-6 text-[10px] ring-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{cs.author.name}</span>
                <span>·</span>
                <span>{cs.status === 'open' ? t('review.working') : ago(cs.updatedAt, now)}</span>
              </div>
              <div className="mt-0.5 text-[13px] leading-snug font-medium">{cs.intent}</div>
              <div className="mt-1 text-xs text-muted-foreground">{summarize(cs)}</div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="-mt-1 -mr-1 size-7" onClick={() => locate(cs)} aria-label={t('review.show')}>
                  <Crosshair className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('review.show')}</TooltipContent>
            </Tooltip>
          </div>
          <button
            className="mt-2.5 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            onClick={() => setItemMode({ csId: cs.id, index: 0 })}
          >
            <ListChecks className="size-3.5" /> {t('review.itemByItem')}
            <kbd className="ml-auto font-mono text-[10px]">J</kbd>
          </button>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5 text-xs" disabled={!!busy} onClick={() => review(cs.id, 'reject')}>
              <X className="size-3.5" /> {t('review.reject')}
              {i === 0 && <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⌥R</kbd>}
            </Button>
            <Button size="sm" className="h-8 flex-1 gap-1.5 text-xs" disabled={!!busy} onClick={() => review(cs.id, 'accept')}>
              <Check className="size-3.5" /> {t('review.accept')}
              {i === 0 && <kbd className="ml-auto font-mono text-[10px] opacity-60">⌥A</kbd>}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
