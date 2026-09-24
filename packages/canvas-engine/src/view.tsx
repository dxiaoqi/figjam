import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { Block, Connector } from '@aifig/shared'
import type { Editor, HandleId, ShapeDef } from './editor'
import { center, expand, intersects, type Box, type Vec } from './geometry'
import { InputController } from './input'

export function useEditorVersion(editor: Editor) {
  return useSyncExternalStore(
    (fn) => editor.subscribe(fn),
    () => editor.getVersion(),
  )
}

/** Re-render on camera changes only. */
export function useCamera(editor: Editor) {
  const [, set] = useState(0)
  useEffect(() => editor.onCamera(() => set((n) => n + 1)), [editor])
  return editor.camera
}

const CULL_THRESHOLD = 300

// ---- blocks -------------------------------------------------------------

interface BlockViewProps {
  block: Block
  def: ShapeDef
  x: number
  y: number
  w: number
  h: number
  editing: boolean
  selected: boolean
  enterDelay: number | undefined
  accepted: boolean
  editor: Editor
}

const BlockView = memo(function BlockView({ block, def, x, y, w, h, editing, selected, enterDelay, accepted, editor }: BlockViewProps) {
  const Render = def.render
  const cls = [
    'ae-block',
    `ae-kind-${block.kind}`,
    `aifig-c-${block.color}`,
    block.pending ? 'is-pending' : '',
    enterDelay !== undefined ? 'is-entering' : '',
    accepted ? 'is-accepted' : '',
    editing ? 'is-editing' : '',
    selected ? 'is-selected' : '',
  ].join(' ')
  const style: CSSProperties = {
    transform: `translate(${x}px, ${y}px)`,
    width: w,
    height: h,
    ['--agent' as string]: block.author?.kind === 'agent' ? (block.author.color ?? '#6E56CF') : '#6E56CF',
    ['--enter-delay' as string]: `${enterDelay ?? 0}ms`,
    ['--r' as string]: `${def.radius ?? 4}px`,
  }
  return (
    <div className={cls} style={style} data-block-id={block.id}>
      <Render block={block} editing={editing} editor={editor} />
    </div>
  )
})

// ---- connectors ------------------------------------------------------------

function ConnectorLayer({ editor, connectors }: { editor: Editor; connectors: Connector[] }) {
  const paths = connectors
    .map((c) => ({ c, pts: editor.connectorPoints(c) }))
    .filter((p): p is { c: Connector; pts: { a: Vec; b: Vec } } => !!p.pts)
  return (
    <svg className="ae-connectors" width="1" height="1" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        <marker id="ae-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      {paths.map(({ c, pts }) => {
        const selected = editor.selection.has(c.id)
        const color = selected ? 'var(--ae-accent)' : c.pending ? (c.author?.color ?? 'var(--ae-connector)') : 'var(--ae-connector)'
        const d = `M${pts.a.x} ${pts.a.y} L${pts.b.x} ${pts.b.y}`
        return (
          <g key={c.id} className="ae-connector">
            <path d={d} stroke="transparent" strokeWidth={14 / editor.camera.z} fill="none" style={{ pointerEvents: 'stroke' }} data-connector-id={c.id} />
            <path d={d} stroke={color} strokeWidth={selected ? 2 : 1.6} fill="none" strokeDasharray={c.pending ? '5 4' : undefined} markerEnd="url(#ae-arrow)" strokeLinecap="round" />
          </g>
        )
      })}
    </svg>
  )
}

function edgeToward(b: Box, p: Vec, pad: number): Vec {
  const c = center(b)
  const dx = p.x - c.x
  const dy = p.y - c.y
  if (!dx && !dy) return c
  const s = Math.min((b.w / 2 + pad) / Math.abs(dx || 1e-9), (b.h / 2 + pad) / Math.abs(dy || 1e-9))
  return { x: c.x + dx * s, y: c.y + dy * s }
}

function ConnectorLabels({ editor, connectors }: { editor: Editor; connectors: Connector[] }) {
  return (
    <>
      {connectors.map((c) => {
        const editing = editor.editingId === c.id
        if (!c.label && !editing) return null
        const pts = editor.connectorPoints(c)
        if (!pts) return null
        const m = { x: (pts.a.x + pts.b.x) / 2, y: (pts.a.y + pts.b.y) / 2 }
        return (
          <div key={c.id} className="ae-connector-label" style={{ transform: `translate(${m.x}px, ${m.y}px) translate(-50%, -50%)` }} data-connector-id={c.id}>
            {editing ? <LabelInput editor={editor} connector={c} /> : c.label}
          </div>
        )
      })}
    </>
  )
}

function LabelInput({ editor, connector }: { editor: Editor; connector: Connector }) {
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const t = requestAnimationFrame(() => ref.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [])
  return (
    <input
      ref={ref}
      data-editing-input
      value={connector.label ?? ''}
      placeholder="Label"
      size={Math.max(4, (connector.label ?? '').length + 1)}
      onChange={(e) => editor.updateConnector(connector.id, { label: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          editor.stopEditing()
        }
        e.stopPropagation()
      }}
    />
  )
}

// ---- overlay (screen space) ------------------------------------------------

const HANDLES_XY: HandleId[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']
const HANDLES_X: HandleId[] = ['e', 'w']

function toScreen(editor: Editor, r: Box): Box {
  const p = editor.pageToScreen(r)
  return { x: p.x, y: p.y, w: r.w * editor.camera.z, h: r.h * editor.camera.z }
}

function FrameLabel({ editor, frame }: { editor: Editor; frame: Block }) {
  const r = editor.pageRect(frame.id)
  const ref = useRef<HTMLInputElement>(null)
  const editing = editor.editingId === frame.id
  useLayoutEffect(() => {
    if (!editing) return
    const t = requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => cancelAnimationFrame(t)
  }, [editing])
  if (!r) return null
  const s = toScreen(editor, r)
  return (
    <div
      className={`ae-frame-label ${editor.selection.has(frame.id) ? 'is-selected' : ''}`}
      style={{ transform: `translate(${s.x}px, ${s.y - 24}px)`, maxWidth: Math.max(48, s.w) }}
      data-frame-label={frame.id}
    >
      {editing ? (
        <input
          ref={ref}
          data-editing-input
          value={frame.title ?? ''}
          onChange={(e) => editor.updateBlock(frame.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              editor.stopEditing()
            }
            e.stopPropagation()
          }}
          size={Math.max(6, (frame.title ?? '').length + 1)}
        />
      ) : (
        frame.title || 'Frame'
      )}
    </div>
  )
}

function Overlay({ editor }: { editor: Editor }) {
  const it = editor.interaction
  const z = editor.camera.z
  const selected = editor.selectedBlocks()
  const single = selected.length === 1 && editor.selection.size === 1 ? selected[0] : null
  const def = single ? editor.shape(single.kind) : null
  const busy = it.type !== 'idle' && it.type !== 'pending'
  const showHandles = single && def && def.resize !== 'none' && !busy && editor.editingId !== single.id && editor.tool === 'select'
  const hover = editor.hover && !editor.selection.has(editor.hover) ? editor.block(editor.hover) : null
  const connectHost = editor.tool === 'select' || editor.tool === 'connector' ? (!busy ? (hover && hover.kind !== 'frame' ? hover : single && single.kind !== 'frame' && editor.editingId !== single.id ? single : null) : null) : null
  const connectTarget = it.type === 'connect' && it.target ? editor.pageRect(it.target) : null
  const selBounds = selected.length > 1 ? editor.selectionBounds() : null

  return (
    <div className="ae-overlay">
      {editor.blocks()
        .filter((b) => b.kind === 'frame')
        .map((f) => (
          <FrameLabel key={f.id} editor={editor} frame={f} />
        ))}
      {hover && !busy && (() => {
        const r = editor.pageRect(hover.id)
        if (!r) return null
        const s = toScreen(editor, r)
        return <div className="ae-hover" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h, borderRadius: (editor.shape(hover.kind)?.radius ?? 4) * z }} />
      })()}
      {selected.map((b) => {
        const r = editor.pageRect(b.id)
        if (!r) return null
        const s = toScreen(editor, r)
        return (
          <div
            key={b.id}
            className={`ae-selection ${selBounds ? 'is-multi' : ''}`}
            style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h, borderRadius: (editor.shape(b.kind)?.radius ?? 4) * z }}
          />
        )
      })}
      {selBounds && !busy && (() => {
        const s = toScreen(editor, expand(selBounds, 4 / z))
        return <div className="ae-selection-bounds" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />
      })()}
      {showHandles &&
        (() => {
          const s = toScreen(editor, editor.pageRect(single.id)!)
          return (def.resize === 'xy' ? HANDLES_XY : HANDLES_X).map((h) => {
            const x = h.includes('w') ? s.x : h.includes('e') ? s.x + s.w : s.x + s.w / 2
            const y = h.includes('n') ? s.y : h.includes('s') ? s.y + s.h : s.y + s.h / 2
            const edge = h.length === 1
            return <div key={h} data-handle={h} className={`ae-handle ae-handle-${h} ${edge ? 'is-edge' : ''}`} style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }} />
          })
        })()}
      {connectHost && (() => {
        const r = editor.pageRect(connectHost.id)
        if (!r) return null
        const s = toScreen(editor, r)
        const off = 14
        const pts = [
          { x: s.x + s.w / 2, y: s.y - off },
          { x: s.x + s.w + off, y: s.y + s.h / 2 },
          { x: s.x + s.w / 2, y: s.y + s.h + off },
          { x: s.x - off, y: s.y + s.h / 2 },
        ]
        return pts.map((p, i) => <div key={i} className="ae-connect-handle" data-connect-from={connectHost.id} style={{ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)` }} />)
      })()}
      {connectTarget && (() => {
        const s = toScreen(editor, connectTarget)
        return <div className="ae-connect-target" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />
      })()}
      {it.type === 'connect' && (() => {
        const fr = editor.pageRect(it.from)
        if (!fr) return null
        const tr = it.target ? editor.pageRect(it.target) : null
        const a = editor.pageToScreen(edgeToward(fr, tr ? center(tr) : it.point, 4))
        const b = editor.pageToScreen(tr ? edgeToward(tr, center(fr), 7) : it.point)
        return (
          <svg className="ae-connect-preview" width="1" height="1" style={{ overflow: 'visible' }}>
            <defs>
              <marker id="ae-arrow-preview" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--ae-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            <path d={`M${a.x} ${a.y} L${b.x} ${b.y}`} stroke="var(--ae-accent)" strokeWidth={1.6} fill="none" markerEnd="url(#ae-arrow-preview)" strokeDasharray="4 4" />
            <circle cx={a.x} cy={a.y} r={3} fill="var(--ae-accent)" />
          </svg>
        )
      })()}
      {editor.guides.map((g, i) => {
        const a = editor.pageToScreen(g.axis === 'x' ? { x: g.at, y: g.from } : { x: g.from, y: g.at })
        const len = (g.to - g.from) * z
        return <div key={i} className="ae-guide" style={g.axis === 'x' ? { transform: `translate(${a.x}px, ${a.y}px)`, width: 1, height: len } : { transform: `translate(${a.x}px, ${a.y}px)`, height: 1, width: len }} />
      })}
      {it.type === 'marquee' && (() => {
        const s = toScreen(editor, it.rect)
        return <div className="ae-marquee" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />
      })()}
      {it.type === 'frame' && (() => {
        const s = toScreen(editor, it.rect)
        return <div className="ae-frame-preview" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />
      })()}
    </div>
  )
}

// ---- canvas ------------------------------------------------------------------

export interface CanvasViewProps {
  editor: Editor
  className?: string
  /** Screen-space overlays rendered above the canvas (presence, panels). */
  children?: ReactNode
}

export function CanvasView({ editor, className, children }: CanvasViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEditorVersion(editor)

  useEffect(() => {
    const el = ref.current!
    const input = new InputController(editor, el)
    const ro = new ResizeObserver(() => editor.setViewportSize(el.clientWidth, el.clientHeight))
    ro.observe(el)
    editor.setViewportSize(el.clientWidth, el.clientHeight)
    return () => {
      input.dispose()
      ro.disconnect()
    }
  }, [editor])

  const cam = editor.camera
  const all = editor.blocks()
  let visible = all
  if (all.length > CULL_THRESHOLD && editor.viewport.w) {
    const vp = expand(editor.viewportPageBounds(), 400 / cam.z)
    visible = all.filter((b) => {
      if (editor.selection.has(b.id) || editor.editingId === b.id) return true
      const r = editor.pageRect(b.id)
      return r && intersects(vp, r)
    })
  }
  const frames = visible.filter((b) => b.kind === 'frame')
  const others = visible.filter((b) => b.kind !== 'frame')
  const connectors = editor.connectors()

  const it = editor.interaction
  const cursor =
    it.type === 'pan' ? 'grabbing' : editor.spaceDown || editor.tool === 'hand' ? 'grab' : editor.tool !== 'select' ? 'crosshair' : it.type === 'move' ? 'grabbing' : 'default'

  let step = 24 * cam.z
  while (step < 12) step *= 4
  const renderBlock = (b: Block) => {
    const def = editor.shape(b.kind)
    const r = editor.pageRect(b.id)
    if (!def || !r) return null
    return (
      <BlockView
        key={b.id}
        block={b}
        def={def}
        x={r.x}
        y={r.y}
        w={r.w}
        h={r.h}
        editing={editor.editingId === b.id}
        selected={editor.selection.has(b.id)}
        enterDelay={editor.entering.get(b.id)}
        accepted={editor.accepted.has(b.id)}
        editor={editor}
      />
    )
  }

  return (
    <div
      ref={ref}
      className={`ae-canvas ${className ?? ''}`}
      style={{
        cursor,
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${cam.x % step}px ${cam.y % step}px`,
      }}
    >
      <div className="ae-world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
        <div className="ae-layer">{frames.map(renderBlock)}</div>
        <ConnectorLayer editor={editor} connectors={connectors} />
        <div className="ae-layer">{others.map(renderBlock)}</div>
        <div className="ae-layer">
          <ConnectorLabels editor={editor} connectors={connectors} />
        </div>
      </div>
      <Overlay editor={editor} />
      {children}
    </div>
  )
}
