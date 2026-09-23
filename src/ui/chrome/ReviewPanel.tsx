import { Check, Crosshair, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Box, useEditor, type TLShapeId } from 'tldraw'
import { Button } from '@/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { cn } from '@/ui/lib/utils'
import type { ChangeSet } from '@/shared/model'
import { useBoard, useChangeSets } from '../board-context'
import { callCore } from '../lib/core'
import { AgentAvatar, useNow } from './TopRight'

function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

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
  if (blocks) parts.push(`${blocks} new`)
  if (connectors) parts.push(`${connectors} connector${connectors === 1 ? '' : 's'}`)
  if (edits) parts.push(`${edits} edited`)
  if (frames && !edits) parts.push(`${frames} frame${frames === 1 ? '' : 's'} resized`)
  if (removed) parts.push(`${removed} removed`)
  return parts.join(' · ') || 'No changes'
}

export function ReviewPanel() {
  const editor = useEditor()
  const { boardId } = useBoard()
  const all = useChangeSets()
  const now = useNow(5000)
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
        toast(action === 'accept' ? `Accepted ${n === 1 ? 'change' : `${n} changes`}` : `Rejected ${n === 1 ? 'change' : `${n} changes`} — the canvas is back to how it was`)
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [boardId],
  )

  const locate = (cs: ChangeSet) => {
    const ids = cs.entries.map((e) => `shape:${e.id}` as TLShapeId).filter((id) => editor.getShape(id))
    const boxes = ids.map((id) => editor.getShapePageBounds(id)).filter(Boolean) as Box[]
    if (!boxes.length) return
    editor.zoomToBounds(Box.Common(boxes), { inset: 120, targetZoom: 1, animation: { duration: 320 } })
    editor.select(...ids.filter((id) => editor.getShape(id)?.type !== 'arrow'))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !pending.length || editor.getEditingShapeId()) return
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
    <div className="pointer-events-auto absolute right-3 bottom-11 z-[300] flex w-[340px] max-w-[calc(100vw-24px)] flex-col gap-2">
      {pending.length > 1 && (
        <div className="chrome flex items-center justify-between rounded-xl py-1.5 pr-1.5 pl-3 text-xs">
          <span className="font-medium">{pending.length} changes to review</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => review('all', 'reject')}>
              Reject all
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => review('all', 'accept')}>
              Accept all
            </Button>
          </div>
        </div>
      )}
      {pending.slice(0, 3).map((cs, i) => (
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
                <span>{cs.status === 'open' ? 'working…' : ago(cs.updatedAt, now)}</span>
              </div>
              <div className="mt-0.5 text-[13px] leading-snug font-medium">{cs.intent}</div>
              <div className="mt-1 text-xs text-muted-foreground">{summarize(cs)}</div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="-mt-1 -mr-1 size-7" onClick={() => locate(cs)} aria-label="Show on canvas">
                  <Crosshair className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Show on canvas</TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-3 flex gap-1.5">
            <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5 text-xs" disabled={!!busy} onClick={() => review(cs.id, 'reject')}>
              <X className="size-3.5" /> Reject
              {i === 0 && <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⌥R</kbd>}
            </Button>
            <Button size="sm" className="h-8 flex-1 gap-1.5 text-xs" disabled={!!busy} onClick={() => review(cs.id, 'accept')}>
              <Check className="size-3.5" /> Accept
              {i === 0 && <kbd className="ml-auto font-mono text-[10px] opacity-60">⌥A</kbd>}
            </Button>
          </div>
        </div>
      ))}
      {pending.length > 3 && <div className="text-center text-[11px] text-muted-foreground">+{pending.length - 3} more</div>}
    </div>
  )
}
