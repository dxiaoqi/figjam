import { edgePoint, intersects, useCamera, useEditorVersion } from '@aifig/canvas-engine'
import type { Block, ChangeSet, Connector } from '@aifig/shared'
import { useChangeSets } from '../board-context'
import { useEditor } from './editor-context'
import { t } from '../i18n'

const snippet = (b: Block) => {
  const t = (b.kind === 'card' || b.kind === 'frame' ? b.title || b.text : b.text).replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
  return t.length > 80 ? `${t.slice(0, 79)}…` : t
}

/**
 * Pending suggestions shown in place: removed blocks as red dashed ghosts where they were, and moved
 * blocks as a dashed outline at their old spot with an arrow to the new one.
 */
export function ReviewGhosts() {
  const editor = useEditor()
  useEditorVersion(editor)
  useCamera(editor)
  const sets = useChangeSets().filter((c) => (c.status === 'pending' || c.status === 'open') && c.entries.length)
  if (!sets.length) return null
  const z = editor.camera.z

  const absRect = (b: Block) => {
    const p = b.parent ? editor.pageRect(b.parent) : null
    return { x: b.x + (p?.x ?? 0), y: b.y + (p?.y ?? 0), w: b.w, h: b.h }
  }
  const toScreen = (r: { x: number; y: number; w: number; h: number }) => {
    const p = editor.pageToScreen(r)
    return { left: p.x, top: p.y, width: r.w * z, height: r.h * z }
  }

  const removed: { cs: ChangeSet; b: Block }[] = []
  const moved: { cs: ChangeSet; before: Block; now: Block }[] = []
  const removedLinks: { cs: ChangeSet; c: Connector }[] = []
  for (const cs of sets) {
    const firstBefore = new Map<string, Block>()
    for (const e of cs.entries) {
      if (e.target === 'connector') {
        if (e.op === 'delete' && e.before) removedLinks.push({ cs, c: e.before as Connector })
        continue
      }
      if (e.op === 'delete' && e.before && !editor.block(e.id)) removed.push({ cs, b: e.before as Block })
      if (e.op === 'update' && e.before && !firstBefore.has(e.id)) firstBefore.set(e.id, e.before as Block)
    }
    for (const [id, before] of firstBefore) {
      const now = editor.block(id)
      if (!now || now.kind === 'frame' || (before.parent ?? null) !== (now.parent ?? null)) continue
      if (Math.hypot(now.x - before.x, now.y - before.y) >= 8) moved.push({ cs, before, now })
    }
  }
  if (!removed.length && !moved.length && !removedLinks.length) return null

  const center = (r: { x: number; y: number; w: number; h: number }) => editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

  return (
    <div className="pointer-events-none absolute inset-0 z-[150]" data-review-ghosts>
      <svg className="absolute inset-0 size-full overflow-visible">
        <defs>
          <marker id="ghost-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {moved.map(({ cs, before, now }) => {
          const ra = absRect(before)
          const rb = editor.pageRect(now.id) ?? absRect(now)
          if (intersects(ra, rb)) return null
          const mid = (r: typeof ra) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
          const a = editor.pageToScreen(edgePoint(ra, mid(rb), 4))
          const b = editor.pageToScreen(edgePoint(rb, mid(ra), 6))
          return (
            <line
              key={`m${cs.id}${now.id}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={cs.author.color ?? '#6E56CF'}
              strokeOpacity={0.7}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              markerEnd="url(#ghost-arrow)"
            />
          )
        })}
        {removedLinks.map(({ cs, c }) => {
          const fa = c.from ? editor.pageRect(c.from) : null
          const fb = c.to ? editor.pageRect(c.to) : null
          const pa = fa ? center(fa) : c.fromPoint ? editor.pageToScreen(c.fromPoint) : null
          const pb = fb ? center(fb) : c.toPoint ? editor.pageToScreen(c.toPoint) : null
          if (!pa || !pb) return null
          return <line key={`c${cs.id}${c.id}`} data-ghost="connector" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#EF4444" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="3 5" />
        })}
      </svg>
      {moved.map(({ cs, before, now }) => (
        <div
          key={`g${cs.id}${now.id}`}
          data-ghost="move"
          data-ghost-for={now.id}
          className="absolute rounded-md border-[1.5px] border-dashed opacity-70"
          style={{ ...toScreen(absRect(before)), borderColor: cs.author.color ?? '#6E56CF', background: `color-mix(in srgb, ${cs.author.color ?? '#6E56CF'} 5%, transparent)` }}
        />
      ))}
      {removed.map(({ cs, b }) => {
        const s = toScreen(absRect(b))
        return (
          <div
            key={`d${cs.id}${b.id}`}
            data-ghost="delete"
            data-ghost-for={b.id}
            className="absolute overflow-hidden rounded-md border-[1.5px] border-dashed border-red-500/70 bg-red-500/[0.06]"
            style={s}
          >
            {s.width > 60 && s.height > 28 && (
              <div className="p-1.5" style={{ fontSize: Math.max(10, Math.min(14, 13 * z)) }}>
                <span className="rounded bg-red-500/90 px-1 py-px text-[10px] font-semibold text-white">{t('review.ghostRemoved', { name: cs.author.name })}</span>
                {s.height > 48 && <div className="mt-1 line-clamp-3 leading-snug text-red-700/80 line-through dark:text-red-300/80">{snippet(b)}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
