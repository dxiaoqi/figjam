import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { rotatePoint, type Block, type Connector } from '@aifig/shared'
import type { Editor, HandleId, ShapeDef } from './editor'
import { center, containsBox, expand, intersects, type Box, type Vec } from './geometry'
import { InputController } from './input'

export function useEditorVersion(editor: Editor) {
  return useSyncExternalStore(
    (fn) => editor.subscribe(fn),
    () => editor.getVersion(),
  )
}

/** Re-render on camera changes. */
export function useCamera(editor: Editor) {
  const [, set] = useState(0)
  useEffect(() => editor.onCamera(() => set((n) => n + 1)), [editor])
  return editor.camera
}

/** Below this zoom, or above this many visible blocks, blocks are drawn on a canvas instead of the DOM. */
const LOD_ENTER_Z = 0.3
const LOD_EXIT_Z = 0.34
const LOD_MAX_DOM = 700

// ---- blocks -------------------------------------------------------------

interface BlockViewProps {
  block: Block
  def: ShapeDef
  x: number
  y: number
  w: number
  h: number
  rotation: number
  editing: boolean
  selected: boolean
  enterDelay: number | undefined
  accepted: boolean
  held: boolean
  settling: boolean
  editor: Editor
}

const BlockView = memo(function BlockView({ block, def, x, y, w, h, rotation, editing, selected, enterDelay, accepted, held, settling, editor }: BlockViewProps) {
  const Render = def.render
  const cls = [
    'ae-block',
    `ae-kind-${block.kind}`,
    `aifig-c-${block.color}`,
    block.pending ? 'is-pending' : '',
    enterDelay !== undefined ? 'is-entering' : '',
    accepted ? 'is-accepted' : '',
    held ? 'is-held' : '',
    settling ? 'is-settling' : '',
    editing ? 'is-editing' : '',
    selected ? 'is-selected' : '',
  ].join(' ')
  const style: CSSProperties = {
    transform: rotation ? `translate(${x}px, ${y}px) rotate(${rotation}deg)` : `translate(${x}px, ${y}px)`,
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
  return (
    <svg className="ae-connectors" width="1" height="1" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        <marker id="ae-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      {connectors.map((c) => {
        const route = editor.connectorRoute(c)
        if (!route) return null
        const selected = editor.selection.has(c.id)
        const color = selected ? 'var(--ae-accent)' : c.pending ? (c.author?.color ?? 'var(--ae-connector)') : 'var(--ae-connector)'
        return (
          <path
            key={c.id}
            className="ae-connector"
            data-connector={c.id}
            d={route.d}
            stroke={color}
            strokeWidth={selected ? 2 : 1.6}
            fill="none"
            strokeDasharray={c.pending ? '5 4' : undefined}
            markerEnd="url(#ae-arrow)"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}

function ConnectorLabels({ editor, connectors }: { editor: Editor; connectors: Connector[] }) {
  return (
    <>
      {connectors.map((c) => {
        const editing = editor.editingId === c.id
        const relationOnly = !c.label && !!c.relation
        if (!c.label && !c.relation && !editing) return null
        const m = editor.labelPosition(c)
        if (!m) return null
        return (
          <div key={c.id} className={`ae-connector-label ${relationOnly && !editing ? 'is-relation' : ''}`} style={{ transform: `translate(${m.x}px, ${m.y}px) translate(-50%, -50%)` }} data-connector-id={c.id} data-relation={c.relation}>
            {editing ? <LabelInput editor={editor} connector={c} /> : (c.label || editor.relationText(c.relation!))}
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
      onBlur={() => editor.editingId === connector.id && editor.stopEditing()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          editor.stopEditing()
        }
        e.stopPropagation()
      }}
    />
  )
}

// ---- level-of-detail canvas ---------------------------------------------------

type LodStyleFn = (b: Block) => { fill: string; stroke?: string; accent?: string }

function drawLod(editor: Editor, canvas: HTMLCanvasElement, host: HTMLElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const { x, y, z } = editor.camera
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * x, dpr * y)
  const vp = expand(editor.viewportPageBounds(), 40 / z)
  const css = getComputedStyle(host)
  const connectorColor = css.getPropertyValue('--ae-connector').trim() || '#a8a29e'
  const style: LodStyleFn = editor.options.lodStyle ?? (() => ({ fill: '#e7e5e4' }))
  const editing = editor.editingId
  for (const b of editor.blocks()) {
    if (b.id === editing) continue
    const r = editor.pageRect(b.id)
    const vr = editor.visualRect(b.id)
    if (!r || !vr || !intersects(vp, vr)) continue
    const s = style(b)
    const radius = editor.shape(b.kind)?.radius ?? 4
    const rot = editor.rotationOf(b.id)
    if (rot) {
      ctx.save()
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
      ctx.rotate((rot * Math.PI) / 180)
      ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2))
    }
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, radius)
    ctx.fillStyle = s.fill
    ctx.fill()
    if (s.stroke) {
      ctx.lineWidth = 1 / z
      ctx.strokeStyle = s.stroke
      ctx.stroke()
    }
    if (s.accent) {
      ctx.fillStyle = s.accent
      ctx.fillRect(r.x, r.y, r.w, Math.min(4, r.h))
    }
    if (b.kind === 'text') {
      ctx.fillStyle = s.accent ?? '#78716c'
      const lines = Math.max(1, Math.round(r.h / 24))
      for (let i = 0; i < lines; i++) ctx.fillRect(r.x, r.y + i * (r.h / lines) + r.h / lines / 4, r.w * (i === lines - 1 ? 0.6 : 0.9), r.h / lines / 2)
    }
    if (b.pending) {
      ctx.setLineDash([5 / z, 4 / z])
      ctx.lineWidth = 1.5 / z
      ctx.strokeStyle = b.author?.color ?? '#6E56CF'
      ctx.strokeRect(r.x - 4 / z, r.y - 4 / z, r.w + 8 / z, r.h + 8 / z)
      ctx.setLineDash([])
    }
    if (rot) ctx.restore()
  }
  ctx.lineWidth = 1.2 / z
  ctx.strokeStyle = connectorColor
  for (const c of editor.connectors()) {
    const route = editor.connectorRoute(c)
    if (!route) continue
    ctx.stroke(new Path2D(route.d))
  }
}

// ---- overlay (screen space) ------------------------------------------------

const HANDLES_XY: HandleId[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']
const HANDLES_X: HandleId[] = ['e', 'w']

function toScreen(editor: Editor, r: Box): Box {
  const p = editor.pageToScreen(r)
  return { x: p.x, y: p.y, w: r.w * editor.camera.z, h: r.h * editor.camera.z }
}

/** CSS for a screen-space box rotated around its center. */
function boxStyle(s: Box, rot: number, radius?: number): CSSProperties {
  return {
    transform: rot ? `translate(${s.x}px, ${s.y}px) rotate(${rot}deg)` : `translate(${s.x}px, ${s.y}px)`,
    transformOrigin: `${s.w / 2}px ${s.h / 2}px`,
    width: s.w,
    height: s.h,
    borderRadius: radius,
  }
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
      className={`ae-frame-label ${editor.selection.has(frame.id) ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`}
      style={{ transform: `translate(${s.x}px, ${s.y - 24}px)`, maxWidth: Math.max(editing ? 160 : 48, s.w) }}
      data-frame-label={frame.id}
    >
      {editing ? (
        <input
          ref={ref}
          data-editing-input
          value={frame.title ?? ''}
          placeholder="Frame"
          onChange={(e) => editor.updateBlock(frame.id, { title: e.target.value })}
          onBlur={() => editor.editingId === frame.id && editor.stopEditing()}
          onKeyDown={(e) => {
            // IME composition (e.g. Chinese input) uses Enter to confirm candidates
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
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
  useEditorVersion(editor)
  useCamera(editor)
  const it = editor.interaction
  const z = editor.camera.z
  const selected = editor.selectedBlocks()
  const single = selected.length === 1 && editor.selection.size === 1 ? selected[0] : null
  const def = single ? editor.shape(single.kind) : null
  const busy = it.type !== 'idle' && it.type !== 'pending'
  const showHandles = single && def && def.resize !== 'none' && !busy && editor.editingId !== single.id && editor.tool === 'select'
  const hover = editor.hover && !editor.selection.has(editor.hover) ? editor.block(editor.hover) : null
  const connectHost = editor.tool === 'select' || editor.tool === 'connector' ? (!busy ? (hover && hover.kind !== 'frame' ? hover : single && single.kind !== 'frame' && editor.editingId !== single.id ? single : null) : null) : null
  const connectTarget = (it.type === 'connect' || it.type === 'endpoint') && it.target ? editor.pageRect(it.target) : null
  const selBounds = selected.length > 1 ? editor.selectionBounds() : null
  const selConnector = editor.selection.size === 1 && !single ? editor.connector([...editor.selection][0]) : null
  const vp = editor.viewportPageBounds()

  return (
    <div className="ae-overlay">
      {editor.blocks()
        .filter((b) => b.kind === 'frame')
        .filter((b) => {
          const r = editor.pageRect(b.id)
          return r && intersects(expand(vp, 40 / z), r)
        })
        .map((f) => (
          <FrameLabel key={f.id} editor={editor} frame={f} />
        ))}
      {hover &&
        !busy &&
        (() => {
          const r = editor.pageRect(hover.id)
          if (!r) return null
          const s = toScreen(editor, r)
          return <div className="ae-hover" style={boxStyle(s, editor.rotationOf(hover.id), (editor.shape(hover.kind)?.radius ?? 4) * z)} />
        })()}
      {selected.map((b) => {
        const r = editor.pageRect(b.id)
        if (!r) return null
        const s = toScreen(editor, r)
        return (
          <div key={b.id} className={`ae-selection ${selBounds ? 'is-multi' : ''}`} style={boxStyle(s, editor.rotationOf(b.id), (editor.shape(b.kind)?.radius ?? 4) * z)} />
        )
      })}
      {selBounds &&
        !busy &&
        (() => {
          const s = toScreen(editor, expand(selBounds, 4 / z))
          return <div className="ae-selection-bounds" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />
        })()}
      {single &&
        def?.rotatable &&
        !busy &&
        editor.editingId !== single.id &&
        editor.tool === 'select' &&
        (() => {
          const s = toScreen(editor, editor.pageRect(single.id)!)
          const rot = editor.rotationOf(single.id)
          const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 }
          const p = rotatePoint({ x: s.x + s.w + 18, y: s.y - 18 }, c, rot)
          // invisible rotate zones just outside each corner (tldraw/Figma convention) + a visible handle
          const zones = [
            { x: s.x - 11, y: s.y - 11 },
            { x: s.x + s.w + 11, y: s.y - 11 },
            { x: s.x - 11, y: s.y + s.h + 11 },
            { x: s.x + s.w + 11, y: s.y + s.h + 11 },
          ].map((z) => rotatePoint(z, c, rot))
          return (
            <>
              {zones.map((z, i) => (
                <div key={i} data-rotate={single.id} className="ae-rotate-zone" style={{ transform: `translate(${z.x}px, ${z.y}px) translate(-50%, -50%)` }} />
              ))}
              <div data-rotate={single.id} className="ae-rotate-handle" title="Rotate (snaps to 15°, hold ⌥ for free)" style={{ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)` }} />
            </>
          )
        })()}
      {showHandles &&
        (() => {
          const s = toScreen(editor, editor.pageRect(single.id)!)
          const rot = editor.rotationOf(single.id)
          const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 }
          const list = def.lockAspect ? HANDLES_XY.filter((h) => h.length === 2) : def.resize === 'xy' ? HANDLES_XY : HANDLES_X
          return list.map((h) => {
            const p = rotatePoint({ x: h.includes('w') ? s.x : h.includes('e') ? s.x + s.w : c.x, y: h.includes('n') ? s.y : h.includes('s') ? s.y + s.h : c.y }, c, rot)
            const edge = h.length === 1
            return <div key={h} data-handle={h} className={`ae-handle ae-handle-${h} ${edge ? 'is-edge' : ''}`} style={{ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${rot}deg)` }} />
          })
        })()}
      {it.type === 'rotate' &&
        (() => {
          const p = editor.pageToScreen(it.center)
          return (
            <div className="ae-rotate-readout" style={{ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)` }}>
              {Math.round(it.angle)}°
            </div>
          )
        })()}
      {selConnector &&
        it.type !== 'endpoint' &&
        (() => {
          const route = editor.connectorRoute(selConnector)
          if (!route) return null
          return (['start', 'end'] as const).map((which) => {
            const p = editor.pageToScreen(which === 'start' ? route.start : route.end)
            const bound = which === 'start' ? !!selConnector.from : !!selConnector.to
            return (
              <div
                key={which}
                data-endpoint={which}
                data-connector-endpoint={selConnector.id}
                className={`ae-endpoint ${bound ? 'is-bound' : ''}`}
                style={{ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)` }}
              />
            )
          })
        })()}
      {selConnector &&
        selConnector.route === 'elbow' &&
        (it.type === 'idle' || it.type === 'pending' || it.type === 'waypoint') &&
        (() => {
          const route = editor.connectorRoute(selConnector)
          if (!route) return null
          const wps = editor.waypointsOf(selConnector) ?? []
          const ctrl = [route.start, ...wps, route.end]
          const out: ReactNode[] = []
          wps.forEach((w, i) => {
            const p = editor.pageToScreen(w)
            out.push(<div key={`w${i}`} data-waypoint={selConnector.id} data-index={i} className="ae-waypoint" title="Drag to move · double-click to remove" style={{ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)` }} />)
          })
          if (it.type !== 'waypoint')
            for (let i = 0; i < ctrl.length - 1; i++) {
              const m = editor.pageToScreen({ x: (ctrl[i].x + ctrl[i + 1].x) / 2, y: (ctrl[i].y + ctrl[i + 1].y) / 2 })
              out.push(<div key={`m${i}`} data-waypoint={selConnector.id} data-index={i} data-insert="true" className="ae-waypoint is-insert" title="Drag to add a bend" style={{ transform: `translate(${m.x}px, ${m.y}px) translate(-50%, -50%)` }} />)
            }
          return out
        })()}
      {connectHost &&
        (() => {
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
      {connectTarget &&
        (() => {
          const s = toScreen(editor, connectTarget)
          return <div className="ae-connect-target" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />
        })()}
      {it.type === 'connect' &&
        (() => {
          const fr = it.from ? editor.pageRect(it.from) : null
          const tr = it.target ? editor.pageRect(it.target) : null
          const startPage = fr ? edgeToward(fr, tr ? center(tr) : it.point, 4) : it.start
          const a = editor.pageToScreen(startPage)
          const b = editor.pageToScreen(tr ? edgeToward(tr, fr ? center(fr) : it.start, 7) : it.point)
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
        return <div key={`g${i}`} className="ae-guide" style={g.axis === 'x' ? { transform: `translate(${a.x}px, ${a.y}px)`, width: 1, height: len } : { transform: `translate(${a.x}px, ${a.y}px)`, height: 1, width: len }} />
      })}
      {editor.spacing.map((sp, i) => {
        const a = editor.pageToScreen(sp.axis === 'x' ? { x: sp.from, y: sp.at } : { x: sp.at, y: sp.from })
        const len = (sp.to - sp.from) * z
        const gap = Math.round(sp.to - sp.from)
        return (
          <div
            key={`s${i}`}
            className={`ae-spacing ae-spacing-${sp.axis} ${sp.snapped ? 'is-snapped' : ''}`}
            style={sp.axis === 'x' ? { transform: `translate(${a.x}px, ${a.y}px)`, width: len } : { transform: `translate(${a.x}px, ${a.y}px)`, height: len }}
          >
            {len > 18 && <span className="ae-spacing-label">{gap}</span>}
          </div>
        )
      })}
      {it.type === 'marquee' &&
        (() => {
          const s = toScreen(editor, it.rect)
          return <div className="ae-marquee" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />
        })()}
      {it.type === 'frame' &&
        (() => {
          const s = toScreen(editor, it.rect)
          return <div className="ae-frame-preview" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />
        })()}
    </div>
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

// ---- canvas ------------------------------------------------------------------

export interface CanvasViewProps {
  editor: Editor
  className?: string
  /** Screen-space overlays rendered above the canvas (presence, panels). */
  children?: ReactNode
}

export function CanvasView({ editor, className, children }: CanvasViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const lodRef = useRef<HTMLCanvasElement>(null)
  const region = useRef<Box | null>(null)
  const lodOn = useRef(false)
  const [, setTick] = useState(0)
  useEditorVersion(editor)

  useEffect(() => {
    const el = ref.current!
    const input = new InputController(editor, el)
    const resize = () => {
      editor.setViewportSize(el.clientWidth, el.clientHeight)
      const c = lodRef.current
      if (c) {
        const dpr = window.devicePixelRatio || 1
        c.width = Math.round(el.clientWidth * dpr)
        c.height = Math.round(el.clientHeight * dpr)
        if (lodOn.current) drawLod(editor, c, el)
      }
      setTick((t) => t + 1)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    let raf = 0
    // camera moves bypass React: transform the world layer directly and only re-render when the
    // rendered region or level of detail needs to change
    const applyCamera = () => {
      const cam = editor.camera
      if (worldRef.current) worldRef.current.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`
      let step = 24 * cam.z
      while (step < 12) step *= 4
      el.style.backgroundSize = `${step}px ${step}px`
      el.style.backgroundPosition = `${cam.x % step}px ${cam.y % step}px`
      const wantLod = lodOn.current ? cam.z < LOD_EXIT_Z : cam.z < LOD_ENTER_Z
      const vp = editor.viewportPageBounds()
      if (wantLod !== lodOn.current || !region.current || !containsBox(region.current, vp)) setTick((t) => t + 1)
      else if (lodOn.current && lodRef.current) {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => lodRef.current && drawLod(editor, lodRef.current, el))
      }
    }
    const off = editor.onCamera(applyCamera)
    return () => {
      input.dispose()
      ro.disconnect()
      off()
      cancelAnimationFrame(raf)
    }
  }, [editor])

  const cam = editor.camera
  const all = editor.blocks()
  const vp = editor.viewportPageBounds()
  const pad = Math.max(vp.w, vp.h) * 0.75
  const reg = { x: vp.x - pad, y: vp.y - pad, w: vp.w + pad * 2, h: vp.h + pad * 2 }
  region.current = reg
  let visible = all.filter((b) => {
    if (editor.selection.has(b.id) || editor.editingId === b.id) return true
    const r = editor.visualRect(b.id)
    return r && intersects(reg, r)
  })
  const inView = visible.filter((b) => {
    const r = editor.pageRect(b.id)
    return r && intersects(vp, r)
  }).length
  const lod = editor.viewport.w > 0 && (lodOn.current ? cam.z < LOD_EXIT_Z || inView > LOD_MAX_DOM : cam.z < LOD_ENTER_Z || inView > LOD_MAX_DOM)
  lodOn.current = lod
  if (lod) visible = visible.filter((b) => b.id === editor.editingId)
  const frames = visible.filter((b) => b.kind === 'frame')
  const others = visible.filter((b) => b.kind !== 'frame')
  const connectors = lod ? [] : editor.connectors()

  useLayoutEffect(() => {
    const c = lodRef.current
    if (c && lod && ref.current) drawLod(editor, c, ref.current)
  })

  const it = editor.interaction
  const cursor =
    it.type === 'pan' || it.type === 'pinch' ? 'grabbing' : editor.spaceDown || editor.tool === 'hand' ? 'grab' : editor.tool !== 'select' ? 'crosshair' : it.type === 'move' ? 'grabbing' : 'default'

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
        rotation={editor.rotationOf(b.id)}
        editing={editor.editingId === b.id}
        selected={editor.selection.has(b.id)}
        enterDelay={editor.entering.get(b.id)}
        accepted={editor.accepted.has(b.id)}
        held={editor.held.has(b.id)}
        settling={editor.settling.has(b.id)}
        editor={editor}
      />
    )
  }

  return (
    <div
      ref={ref}
      className={`ae-canvas ${lod ? 'is-lod' : ''} ${className ?? ''}`}
      data-lod={lod ? 'canvas' : 'dom'}
      style={{
        cursor,
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${cam.x % step}px ${cam.y % step}px`,
      }}
    >
      <canvas ref={lodRef} className="ae-lod" style={{ display: lod ? 'block' : 'none' }} />
      <div ref={worldRef} className="ae-world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
        <div className="ae-layer">{frames.map(renderBlock)}</div>
        <div className="ae-layer">{others.map(renderBlock)}</div>
        <ConnectorLayer editor={editor} connectors={connectors} />
        <div className="ae-layer">
          <ConnectorLabels editor={editor} connectors={connectors} />
        </div>
      </div>
      <Overlay editor={editor} />
      {children}
    </div>
  )
}

// ---- minimap -------------------------------------------------------------------

export function Minimap({ editor, width = 200, height = 136, className }: { editor: Editor; width?: number; height?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const version = useEditorVersion(editor)
  const cam = useCamera(editor)
  const mapRef = useRef<{ bounds: Box; scale: number; ox: number; oy: number } | null>(null)

  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr
    c.height = height * dpr
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const vp = editor.viewportPageBounds()
    const content = editor.contentBounds()
    const all = content ? [content, vp] : [vp]
    const x1 = Math.min(...all.map((b) => b.x))
    const y1 = Math.min(...all.map((b) => b.y))
    const x2 = Math.max(...all.map((b) => b.x + b.w))
    const y2 = Math.max(...all.map((b) => b.y + b.h))
    const pad = 8
    const scale = Math.min((width - pad * 2) / Math.max(1, x2 - x1), (height - pad * 2) / Math.max(1, y2 - y1))
    const ox = pad + ((width - pad * 2) - (x2 - x1) * scale) / 2 - x1 * scale
    const oy = pad + ((height - pad * 2) - (y2 - y1) * scale) / 2 - y1 * scale
    mapRef.current = { bounds: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, scale, ox, oy }
    const style: LodStyleFn = editor.options.lodStyle ?? (() => ({ fill: '#d6d3d1' }))
    for (const b of editor.blocks()) {
      const r = editor.pageRect(b.id)
      if (!r) continue
      const s = style(b)
      ctx.fillStyle = b.kind === 'frame' ? (s.stroke ?? s.fill) : (s.accent ?? s.fill)
      ctx.globalAlpha = b.kind === 'frame' ? 0.35 : 1
      ctx.fillRect(ox + r.x * scale, oy + r.y * scale, Math.max(1, r.w * scale), Math.max(1, r.h * scale))
    }
    ctx.globalAlpha = 1
    const accent = getComputedStyle(c).getPropertyValue('--ae-accent').trim() || '#5b5bd6'
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.fillStyle = `${accent}14`
    ctx.beginPath()
    ctx.roundRect(ox + vp.x * scale, oy + vp.y * scale, vp.w * scale, vp.h * scale, 3)
    ctx.fill()
    ctx.stroke()
  }, [editor, version, cam.x, cam.y, cam.z, width, height])

  const moveTo = (e: React.PointerEvent) => {
    const m = mapRef.current
    if (!m) return
    const r = ref.current!.getBoundingClientRect()
    const px = (e.clientX - r.left - m.ox) / m.scale
    const py = (e.clientY - r.top - m.oy) / m.scale
    const z = editor.camera.z
    editor.setCamera({ x: editor.viewport.w / 2 - px * z, y: editor.viewport.h / 2 - py * z, z })
  }

  return (
    <canvas
      ref={ref}
      className={`ae-minimap ${className ?? ''}`}
      style={{ width, height }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        moveTo(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && moveTo(e)}
      aria-label="Minimap"
    />
  )
}
