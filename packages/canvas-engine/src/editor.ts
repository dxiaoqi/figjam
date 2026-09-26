import type { ComponentType } from 'react'
import * as Y from 'yjs'
import { distanceToRoute, estimateLabelSize, placeLabel, rotatePoint, rotatedBounds, routeConnector, type Author, type Block, type Connector, type Route, type RouteStyle } from '@aifig/shared'
import {
  box,
  boxFromPoints,
  center,
  containsBox,
  containsPoint,
  intersects,
  randomId,
  snapTo,
  union,
  type Box,
  type Vec,
} from './geometry'

export interface Camera {
  /** screen = page * z + (x, y) */
  x: number
  y: number
  z: number
}

export interface BlockRenderProps {
  block: Block
  editing: boolean
  editor: Editor
}

export interface ShapeDef {
  kind: Block['kind']
  /** Which dimensions a person can resize. */
  resize: 'none' | 'x' | 'xy'
  canEdit: boolean
  /** Frames: hold children in relative coordinates. */
  container?: boolean
  minW?: number
  minH?: number
  /** Corner radius of the selection outline (page px). */
  radius?: number
  render: ComponentType<BlockRenderProps>
  /** Final size after a resize (e.g. grow a card to fit its text). */
  fit?: (block: Block, w: number, h: number) => { w: number; h: number }
  /** Blocks that are empty when editing ends are removed. */
  isEmpty?: (block: Block) => boolean
  /** Shows a rotation handle (snaps to 15°). */
  rotatable?: boolean
  /** Corner resizing keeps the aspect ratio (images). */
  lockAspect?: boolean
}

export type BlockDraft = Pick<Block, 'kind' | 'w' | 'h'> & Partial<Block>

export interface EditorOptions {
  doc: Y.Doc
  shapes: ShapeDef[]
  author: Author
  gridSize?: number
  /** Returns the block a creation tool should place at `at` (center point, page space). */
  createForTool?: (tool: string, at: Vec) => BlockDraft | null
  /** Block created when a connector is dropped on empty canvas. */
  createForConnectorDrop?: (from: Block, at: Vec) => BlockDraft | null
  onDoubleClickCanvas?: (at: Vec) => void
  onPasteText?: (text: string, at: Vec) => void
  /** Colors for the far-zoom (level-of-detail) canvas and the minimap. */
  lodStyle?: (block: Block) => { fill: string; stroke?: string; accent?: string }
  /** Right-click without dragging. `target` is the block/connector under the pointer, if any. */
  onContextMenu?: (info: { screen: Vec; page: Vec; target: string | null }) => void
  /** Image files pasted or dropped onto the canvas (page point where they landed). */
  onFiles?: (files: File[], at: Vec) => void
  /** Extra single-key tool shortcuts, e.g. { s: 'sticky' }. */
  toolKeys?: Record<string, string>
  /** Display text for a connector's relation (e.g. translated); defaults to the relation id. */
  relationLabel?: (relation: string) => string
}

export type HandleId = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

export type Interaction =
  | { type: 'idle' }
  | { type: 'pan'; startScreen: Vec; cam: Camera }
  | { type: 'pending'; startScreen: Vec; startPage: Vec; target: string | null; frameBody: string | null; shift: boolean; wasSelected: boolean }
  | { type: 'move'; startPage: Vec; ids: string[]; dx: number; dy: number }
  | { type: 'resize'; id: string; handle: HandleId; startPage: Vec; orig: Box; rect: Box }
  | { type: 'marquee'; startPage: Vec; rect: Box; base: string[] }
  | { type: 'connect'; from: string | null; start: Vec; point: Vec; target: string | null }
  | { type: 'endpoint'; id: string; which: 'start' | 'end'; point: Vec; target: string | null }
  | { type: 'frame'; startPage: Vec; rect: Box }
  | { type: 'pinch'; startDist: number; startMid: Vec; cam: Camera }
  | { type: 'rotate'; id: string; center: Vec; startAngle: number; orig: number; angle: number }
  | { type: 'waypoint'; id: string; index: number; point: Vec; insert: boolean }

export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

/** A measured gap between the moving selection and a neighbor, shown while dragging. */
export interface Spacing {
  axis: 'x' | 'y'
  /** Gap start/end along `axis`. */
  from: number
  to: number
  /** Position on the cross axis. */
  at: number
  snapped: boolean
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

type Listener = () => void

const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const MIN_Z = 0.05
const MAX_Z = 4
const SNAP_PX = 6
const FRAME_PAD = 32
const SPACING_GAP = 24

/** Stacking key: explicit y…/z… indexes from bring-to-front / send-to-back, else creation time. */
function zKey(b: Block) {
  return b.index && /^[yz]/.test(b.index) ? b.index : `z${b.createdAt.toString(36).padStart(10, '0')}`
}

/** Whiteboard editor over a board's Yjs document. The document is the source of truth. */
export class Editor {
  readonly doc: Y.Doc
  readonly blocksMap: Y.Map<Block>
  readonly connectorsMap: Y.Map<Connector>
  readonly undoManager: Y.UndoManager
  readonly origin = { editor: true }
  readonly shapes: Map<string, ShapeDef>
  readonly grid: number
  options: EditorOptions

  camera: Camera = { x: 0, y: 0, z: 1 }
  viewport = { w: 0, h: 0 }
  tool = 'select'
  selection = new Set<string>()
  hover: string | null = null
  editingId: string | null = null
  interaction: Interaction = { type: 'idle' }
  guides: Guide[] = []
  spacing: Spacing[] = []
  spaceDown = false
  /** Blocks added by others (agents) recently, with a stagger delay. */
  entering = new Map<string, number>()
  accepted = new Set<string>()
  /**
   * Moves made by others (agents, make-room) near the user's caret or drag, held at their old position
   * until the user pauses; then they settle in with an animation.
   */
  held = new Map<string, { x: number; y: number; by?: Author }>()
  settling = new Set<string>()
  /** How long the user must pause before held moves are applied. */
  holdIdleMs = 1200
  private lastLocalEdit = 0
  private holdTimer: ReturnType<typeof setInterval> | null = null

  private version = 0
  private listeners = new Set<Listener>()
  private cameraListeners = new Set<Listener>()
  private sortedCache: { version: number; list: Block[] } | null = null
  private docVersion = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private disposers: (() => void)[] = []
  private clipboard: string | null = null

  constructor(options: EditorOptions) {
    this.options = options
    this.doc = options.doc
    this.blocksMap = this.doc.getMap<Block>('blocks')
    this.connectorsMap = this.doc.getMap<Connector>('connectors')
    this.shapes = new Map(options.shapes.map((s) => [s.kind, s]))
    this.grid = options.gridSize ?? 8
    this.undoManager = new Y.UndoManager([this.blocksMap, this.connectorsMap], {
      trackedOrigins: new Set([this.origin]),
      captureTimeout: 400,
    })

    const onBlocks = (e: Y.YMapEvent<Block>, tr: Y.Transaction) => {
      this.docVersion++
      if (tr.origin === this.origin) {
        this.lastLocalEdit = Date.now()
        e.changes.keys.forEach((_c, key) => this.held.delete(key))
      } else {
        this.holdRemoteMoves(e)
        let i = 0
        const entering: string[] = []
        const accepted: string[] = []
        e.changes.keys.forEach((change, key) => {
          const b = this.blocksMap.get(key)
          if (change.action === 'add' && b && b.author?.kind === 'agent' && b.kind !== 'frame') {
            this.entering.set(key, Math.min(i++, 30) * 40)
            entering.push(key)
          }
          if (change.action === 'update' && b && (change.oldValue as Block | undefined)?.pending && !b.pending) {
            this.accepted.add(key)
            accepted.push(key)
          }
          if (change.action === 'delete') {
            this.selection.delete(key)
            if (this.editingId === key) this.editingId = null
          }
        })
        if (entering.length) this.later(1600 + i * 40, () => entering.forEach((k) => this.entering.delete(k)))
        if (accepted.length) this.later(520, () => accepted.forEach((k) => this.accepted.delete(k)))
      }
      this.bump()
    }
    const onConnectors = () => {
      this.docVersion++
      for (const id of [...this.selection]) if (!this.blocksMap.has(id) && !this.connectorsMap.has(id)) this.selection.delete(id)
      this.bump()
    }
    this.blocksMap.observe(onBlocks)
    this.connectorsMap.observe(onConnectors)
    const onStack = () => this.bump()
    this.undoManager.on('stack-item-added', onStack)
    this.undoManager.on('stack-item-popped', onStack)
    this.disposers.push(
      () => this.blocksMap.unobserve(onBlocks),
      () => this.connectorsMap.unobserve(onConnectors),
      () => this.undoManager.destroy(),
    )
  }

  /** Is the user in the middle of something (typing, dragging) right now? */
  userBusy() {
    const it = this.interaction.type
    if (it === 'move' || it === 'resize' || it === 'rotate' || it === 'connect' || it === 'marquee') return true
    return Date.now() - this.lastLocalEdit < this.holdIdleMs
  }

  /** Where the user is working: the block being edited, or what's being dragged, padded. */
  private focusRegion(): Box | null {
    const pad = 240
    const it = this.interaction
    let r: Box | null = null
    if (this.editingId) r = this.baseRect(this.editingId)
    else if ((it.type === 'move' || it.type === 'resize' || it.type === 'rotate') && this.selection.size) r = union([...this.selection].map((id) => this.pageRect(id)).filter(Boolean) as Box[])
    else if (Date.now() - this.lastLocalEdit < this.holdIdleMs && this.selection.size) r = union([...this.selection].map((id) => this.baseRect(id)).filter(Boolean) as Box[])
    return r ? { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 } : null
  }

  private holdRemoteMoves(e: Y.YMapEvent<Block>) {
    if (!this.userBusy()) return
    const region = this.focusRegion()
    if (!region) return
    e.changes.keys.forEach((change, key) => {
      if (change.action === 'delete') return void this.held.delete(key)
      const old = change.oldValue as Block | undefined
      const b = this.blocksMap.get(key)
      if (change.action !== 'update' || !old || !b || b.kind === 'frame') return
      if ((old.x === b.x && old.y === b.y) || (old.parent ?? null) !== (b.parent ?? null)) return
      const parent = b.parent ? this.baseRect(b.parent) : null
      const abs = (v: { x: number; y: number }) => ({ x: v.x + (parent?.x ?? 0), y: v.y + (parent?.y ?? 0), w: b.w, h: b.h })
      if (key !== this.editingId && !intersects(abs(old), region) && !intersects(abs(b), region)) return
      if (!this.held.has(key)) this.held.set(key, { x: old.x, y: old.y, by: b.editedBy ?? b.author })
    })
    if (this.held.size && !this.holdTimer) {
      this.holdTimer = setInterval(() => {
        if (this.userBusy()) return
        this.releaseHeld()
      }, 200)
    }
  }

  /** Apply held moves now, animating each block from where it was shown to where it is. */
  releaseHeld() {
    if (this.holdTimer) clearInterval(this.holdTimer)
    this.holdTimer = null
    if (!this.held.size) return
    const ids = [...this.held.keys()]
    ids.forEach((id) => this.settling.add(id))
    this.held.clear()
    this.bump()
    this.later(460, () => ids.forEach((id) => this.settling.delete(id)))
  }

  dispose() {
    if (this.holdTimer) clearInterval(this.holdTimer)
    this.disposers.forEach((d) => d())
    this.timers.forEach((t) => clearTimeout(t))
    this.listeners.clear()
    this.cameraListeners.clear()
  }

  // ---- subscriptions -------------------------------------------------------

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  onCamera(fn: Listener) {
    this.cameraListeners.add(fn)
    return () => {
      this.cameraListeners.delete(fn)
    }
  }

  getVersion() {
    return this.version
  }

  bump() {
    this.version++
    for (const l of [...this.listeners]) l()
  }

  private bumpCamera() {
    for (const l of [...this.cameraListeners]) l()
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
      this.bump()
    }, ms)
    this.timers.add(t)
  }

  // ---- document reads -----------------------------------------------------

  shape(kind: string) {
    return this.shapes.get(kind)
  }

  block(id: string) {
    return this.blocksMap.get(id)
  }

  connector(id: string) {
    return this.connectorsMap.get(id)
  }

  /** Frames first, then everything else in creation order. */
  blocks(): Block[] {
    if (this.sortedCache?.version === this.docVersion) return this.sortedCache.list
    const list = [...this.blocksMap.values()].sort((a, b) => {
      const fa = a.kind === 'frame' ? 0 : 1
      const fb = b.kind === 'frame' ? 0 : 1
      const ka = zKey(a)
      const kb = zKey(b)
      return fa - fb || (ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : 1)
    })
    this.sortedCache = { version: this.docVersion, list }
    return list
  }

  connectors(): Connector[] {
    return [...this.connectorsMap.values()]
  }

  childrenOf(id: string | null) {
    return this.blocks().filter((b) => (b.parent ?? null) === id)
  }

  /** Page-space rect including in-progress move/resize previews. */
  pageRect(id: string): Box | null {
    const b = this.blocksMap.get(id)
    if (!b) return null
    const it = this.interaction
    if (it.type === 'resize' && it.id === id) return it.rect
    const hold = this.held.get(id)
    let x = hold ? hold.x : b.x
    let y = hold ? hold.y : b.y
    if (b.parent) {
      const p = this.pageRect(b.parent)
      if (p) {
        x += p.x
        y += p.y
      }
    }
    if (it.type === 'move' && it.ids.includes(id)) {
      x += it.dx
      y += it.dy
    }
    return { x, y, w: b.w, h: b.h }
  }

  /** Page rect from the document only, ignoring previews. */
  baseRect(id: string): Box | null {
    const b = this.blocksMap.get(id)
    if (!b) return null
    let x = b.x
    let y = b.y
    if (b.parent) {
      const p = this.baseRect(b.parent)
      if (p) {
        x += p.x
        y += p.y
      }
    }
    return { x, y, w: b.w, h: b.h }
  }

  rotationOf(id: string): number {
    const it = this.interaction
    if (it.type === 'rotate' && it.id === id) return it.angle
    return this.blocksMap.get(id)?.rotation ?? 0
  }

  /** Axis-aligned bounds including rotation (and previews). */
  visualRect(id: string): Box | null {
    const r = this.pageRect(id)
    return r ? rotatedBounds(r, this.rotationOf(id)) : null
  }

  private baseVisual(id: string): Box | null {
    const r = this.baseRect(id)
    return r ? rotatedBounds(r, this.blocksMap.get(id)?.rotation) : null
  }

  /** Is a page point inside the (possibly rotated) block? */
  containsPage(id: string, p: Vec, pad = 0): boolean {
    const r = this.pageRect(id)
    if (!r) return false
    const rot = this.rotationOf(id)
    const q = rot ? rotatePoint(p, center(r), -rot) : p
    return containsPoint(r, q, pad)
  }

  contentBounds(): Box | null {
    return union(this.blocks().map((b) => this.baseVisual(b.id)!).filter(Boolean))
  }

  /** Topmost block under a page point. Non-frames win over frames. */
  hitTest(p: Vec, opts: { exclude?: Set<string>; frames?: boolean } = {}): Block | null {
    const list = this.blocks()
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]
      if (opts.exclude?.has(b.id)) continue
      if (b.kind === 'frame' && !opts.frames) continue
      if (this.containsPage(b.id, p)) return b
    }
    return null
  }

  frameAt(p: Vec, exclude?: Set<string>): Block | null {
    const frames = this.blocks().filter((b) => b.kind === 'frame' && !exclude?.has(b.id))
    for (let i = frames.length - 1; i >= 0; i--) {
      const r = this.pageRect(frames[i].id)
      if (r && containsPoint(r, p)) return frames[i]
    }
    return null
  }

  connectorAt(p: Vec, tolerancePx = 8): Connector | null {
    const tol = tolerancePx / this.camera.z
    let best: Connector | null = null
    let bestD = tol
    for (const c of this.connectors()) {
      const r = this.connectorRoute(c)
      if (!r) continue
      const d = distanceToRoute(p, r)
      if (d <= bestD) {
        best = c
        bestD = d
      }
    }
    return best
  }

  private routeCache = new Map<string, { key: string; route: Route | null }>()

  /** Effective endpoints, including an endpoint being dragged. */
  connectorEnds(c: Connector) {
    let { from, to, fromPoint, toPoint } = c
    const it = this.interaction
    if (it.type === 'endpoint' && it.id === c.id) {
      if (it.which === 'start') {
        from = it.target
        fromPoint = it.target ? null : it.point
      } else {
        to = it.target
        toPoint = it.target ? null : it.point
      }
    }
    return { from: from ?? null, to: to ?? null, fromPoint: fromPoint ?? null, toPoint: toPoint ?? null }
  }

  /** Routed path of a connector (cached until its endpoints or the document change). */
  connectorRoute(c: Connector): Route | null {
    const e = this.connectorEnds(c)
    const fr = e.from ? this.pageRect(e.from) : null
    const tr = e.to ? this.pageRect(e.to) : null
    if ((e.from && !fr) || (e.to && !tr)) return null
    const rk = (r: Box | null) => (r ? `${r.x},${r.y},${r.w},${r.h}` : '-')
    const pk = (p: Vec | null) => (p ? `${p.x},${p.y}` : '-')
    const wps = this.waypointsOf(c)
    const fRot = e.from ? this.rotationOf(e.from) : 0
    const tRot = e.to ? this.rotationOf(e.to) : 0
    const key = `${rk(fr)}|${rk(tr)}|${pk(e.fromPoint)}|${pk(e.toPoint)}|${c.route ?? ''}|${fRot}|${tRot}|${wps ? wps.map(pk).join(';') : ''}|${this.docVersion}`
    const hit = this.routeCache.get(c.id)
    if (hit && hit.key === key) return hit.route
    const a = fr ?? (e.fromPoint ? box(e.fromPoint.x, e.fromPoint.y, 0, 0) : null)
    const b = tr ?? (e.toPoint ? box(e.toPoint.x, e.toPoint.y, 0, 0) : null)
    let obstacles: Box[] = []
    if (c.route !== 'straight' && a && b) {
      const area = union([a, b])!
      const pad = 360
      const x1 = area.x - pad
      const y1 = area.y - pad
      const x2 = area.x + area.w + pad
      const y2 = area.y + area.h + pad
      for (const blk of this.blocks()) {
        if (blk.kind === 'frame' || blk.id === e.from || blk.id === e.to) continue
        const r = this.baseVisual(blk.id)!
        if (r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1) obstacles.push(r)
      }
      if (obstacles.length > 60) obstacles = obstacles.slice(0, 60)
    }
    const route = routeConnector({ from: fr, fromPoint: e.fromPoint, fromRotation: fRot, to: tr, toPoint: e.toPoint, toRotation: tRot, style: c.route, waypoints: wps, obstacles })
    this.routeCache.set(c.id, { key, route })
    return route
  }

  /** Waypoints including an in-progress waypoint drag. */
  waypointsOf(c: Connector): Vec[] | null {
    if (c.route !== 'elbow') return null
    const it = this.interaction
    const base = c.waypoints ?? []
    if (it.type === 'waypoint' && it.id === c.id) {
      const next = [...base]
      if (it.insert) next.splice(it.index, 0, it.point)
      else next[it.index] = it.point
      return next
    }
    return base.length ? base : null
  }

  relationText(relation: string) {
    return this.options.relationLabel?.(relation) ?? relation
  }

  /** Where a connector's label sits: along the route, clear of blocks. */
  labelPosition(c: Connector): Vec | null {
    const route = this.connectorRoute(c)
    if (!route) return null
    const text = c.label || (c.relation ? this.relationText(c.relation) : '')
    if (!text) return route.mid
    const { w, h } = estimateLabelSize(text)
    const area = union(route.points.map((p) => box(p.x, p.y, 0, 0)))!
    const obstacles: Box[] = []
    for (const b of this.blocks()) {
      if (b.kind === 'frame') continue
      const r = this.visualRect(b.id)!
      if (r.x < area.x + area.w + w && r.x + r.w > area.x - w && r.y < area.y + area.h + h && r.y + r.h > area.y - h) obstacles.push(r)
    }
    return placeLabel(route, w, h, obstacles)
  }

  // ---- rotation ------------------------------------------------------------

  beginRotate(id: string, page: Vec) {
    const r = this.pageRect(id)
    if (!r) return
    const c = center(r)
    this.interaction = { type: 'rotate', id, center: c, startAngle: (Math.atan2(page.y - c.y, page.x - c.x) * 180) / Math.PI, orig: this.blocksMap.get(id)?.rotation ?? 0, angle: this.blocksMap.get(id)?.rotation ?? 0 }
    this.bump()
  }

  updateRotate(page: Vec, free: boolean) {
    const it = this.interaction
    if (it.type !== 'rotate') return
    const a = (Math.atan2(page.y - it.center.y, page.x - it.center.x) * 180) / Math.PI
    let angle = it.orig + a - it.startAngle
    angle = free ? Math.round(angle) : Math.round(angle / 15) * 15
    angle = ((angle % 360) + 360) % 360
    this.interaction = { ...it, angle }
    this.bump()
  }

  endRotate() {
    const it = this.interaction
    if (it.type !== 'rotate') return
    this.interaction = { type: 'idle' }
    if (it.angle !== it.orig) this.updateBlocks([{ id: it.id, patch: { rotation: it.angle } }])
    else this.bump()
  }

  // ---- waypoints -------------------------------------------------------------

  beginWaypoint(id: string, index: number, insert: boolean, point: Vec) {
    this.interaction = { type: 'waypoint', id, index, insert, point }
    this.bump()
  }

  updateWaypoint(point: Vec) {
    const it = this.interaction
    if (it.type !== 'waypoint') return
    this.interaction = { ...it, point: { x: snapTo(point.x, this.grid), y: snapTo(point.y, this.grid) } }
    this.bump()
  }

  endWaypoint() {
    const it = this.interaction
    if (it.type !== 'waypoint') return
    const next = this.waypointsOf(this.connectorsMap.get(it.id)!) ?? []
    this.interaction = { type: 'idle' }
    this.setWaypoints(it.id, next)
  }

  setWaypoints(id: string, waypoints: Vec[]) {
    const c = this.connectorsMap.get(id)
    if (!c) return
    this.undoManager.stopCapturing()
    this.transact(() => this.connectorsMap.set(id, this.stamp(c, { waypoints: waypoints.length ? waypoints : null, route: 'elbow' })))
    this.bump()
  }

  removeWaypoint(id: string, index: number) {
    const c = this.connectorsMap.get(id)
    if (!c?.waypoints) return
    this.setWaypoints(id, c.waypoints.filter((_, i) => i !== index))
  }

  // ---- camera ---------------------------------------------------------------

  setViewportSize(w: number, h: number) {
    this.viewport = { w, h }
    this.bumpCamera()
  }

  pageToScreen(p: Vec): Vec {
    return { x: p.x * this.camera.z + this.camera.x, y: p.y * this.camera.z + this.camera.y }
  }

  screenToPage(p: Vec): Vec {
    return { x: (p.x - this.camera.x) / this.camera.z, y: (p.y - this.camera.y) / this.camera.z }
  }

  viewportPageBounds(): Box {
    const a = this.screenToPage({ x: 0, y: 0 })
    return { x: a.x, y: a.y, w: this.viewport.w / this.camera.z, h: this.viewport.h / this.camera.z }
  }

  setCamera(c: Camera) {
    this.stopAnimation()
    this.camera = { x: c.x, y: c.y, z: Math.min(MAX_Z, Math.max(MIN_Z, c.z)) }
    this.bumpCamera()
  }

  panBy(dx: number, dy: number) {
    this.setCamera({ ...this.camera, x: this.camera.x + dx, y: this.camera.y + dy })
  }

  zoomAt(screen: Vec, z: number) {
    const nz = Math.min(MAX_Z, Math.max(MIN_Z, z))
    const p = this.screenToPage(screen)
    this.setCamera({ x: screen.x - p.x * nz, y: screen.y - p.y * nz, z: nz })
  }

  private get screenCenter(): Vec {
    return { x: this.viewport.w / 2, y: this.viewport.h / 2 }
  }

  zoomIn() {
    const z = ZOOM_STEPS.find((s) => s > this.camera.z + 0.001) ?? MAX_Z
    this.animateTo(this.cameraForZoom(z))
  }

  zoomOut() {
    const z = [...ZOOM_STEPS].reverse().find((s) => s < this.camera.z - 0.001) ?? MIN_Z
    this.animateTo(this.cameraForZoom(z))
  }

  resetZoom() {
    this.animateTo(this.cameraForZoom(1))
  }

  private cameraForZoom(z: number): Camera {
    const p = this.screenToPage(this.screenCenter)
    return { x: this.screenCenter.x - p.x * z, y: this.screenCenter.y - p.y * z, z }
  }

  zoomToBounds(b: Box, opts: { inset?: number; maxZoom?: number; animate?: boolean } = {}) {
    const inset = opts.inset ?? 96
    const w = Math.max(1, this.viewport.w - inset * 2)
    const h = Math.max(1, this.viewport.h - inset * 2)
    const z = Math.min(opts.maxZoom ?? 1, Math.max(MIN_Z, Math.min(w / Math.max(b.w, 1), h / Math.max(b.h, 1))))
    const c = center(b)
    const cam = { x: this.viewport.w / 2 - c.x * z, y: this.viewport.h / 2 - c.y * z, z }
    if (opts.animate === false) this.setCamera(cam)
    else this.animateTo(cam)
  }

  zoomToFit(animate = true) {
    const b = this.contentBounds()
    if (b) this.zoomToBounds(b, { animate })
    else this.setCamera({ x: this.viewport.w / 2, y: this.viewport.h / 2, z: 1 })
  }

  private anim: number | null = null

  private stopAnimation() {
    if (this.anim !== null) cancelAnimationFrame(this.anim)
    this.anim = null
  }

  animateTo(target: Camera, duration = 260) {
    this.stopAnimation()
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return this.setCamera(target)
    const from = { ...this.camera }
    const t0 = performance.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / duration)
      const k = ease(t)
      // interpolate in page space around the viewport center so the motion feels anchored
      const z = from.z + (target.z - from.z) * k
      this.camera = { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k, z }
      this.bumpCamera()
      this.anim = t < 1 ? requestAnimationFrame(step) : null
    }
    this.anim = requestAnimationFrame(step)
  }

  // ---- tools, selection, editing -------------------------------------------

  setTool(tool: string) {
    this.tool = tool
    if (tool !== 'select') this.stopEditing()
    this.bump()
  }

  select(ids: Iterable<string>) {
    this.selection = new Set(ids)
    this.bump()
  }

  selectNone() {
    if (!this.selection.size) return
    this.selection = new Set()
    this.bump()
  }

  selectAll() {
    this.select(this.blocks().filter((b) => !b.parent || !this.selection.has(b.parent)).map((b) => b.id))
  }

  selectedBlocks(): Block[] {
    return [...this.selection].map((id) => this.blocksMap.get(id)).filter(Boolean) as Block[]
  }

  selectionBounds(): Box | null {
    return union(
      [...this.selection]
        .map((id) => this.visualRect(id))
        .filter(Boolean) as Box[],
    )
  }

  startEditing(id: string) {
    const b = this.blocksMap.get(id)
    const c = this.connectorsMap.get(id)
    if (b && !this.shape(b.kind)?.canEdit) return
    if (!b && !c) return
    this.undoManager.stopCapturing()
    this.editingId = id
    this.selection = new Set([id])
    this.tool = 'select'
    this.bump()
  }

  stopEditing() {
    const id = this.editingId
    if (!id) return
    this.editingId = null
    const b = this.blocksMap.get(id)
    if (b && this.shape(b.kind)?.isEmpty?.(b)) this.deleteIds([id])
    this.undoManager.stopCapturing()
    this.bump()
  }

  // ---- mutations ------------------------------------------------------------

  transact(fn: () => void) {
    this.doc.transact(fn, this.origin)
  }

  private stamp<T extends Block | Connector>(value: T, patch: Partial<T>): T {
    return { ...value, ...patch, editedBy: this.options.author, updatedAt: Date.now() }
  }

  createBlock(draft: BlockDraft): string {
    const id = draft.id ?? randomId()
    const now = Date.now()
    const block: Block = {
      text: '',
      color: 'yellow',
      size: 'm',
      parent: null,
      x: 0,
      y: 0,
      ...draft,
      id,
      author: this.options.author,
      createdAt: now,
      updatedAt: now,
      pending: false,
      changeSet: null,
    }
    this.undoManager.stopCapturing()
    this.transact(() => this.blocksMap.set(id, block))
    return id
  }

  updateBlock(id: string, patch: Partial<Block>) {
    const b = this.blocksMap.get(id)
    if (!b) return
    this.transact(() => this.blocksMap.set(id, this.stamp(b, patch)))
  }

  updateBlocks(patches: { id: string; patch: Partial<Block> }[]) {
    this.undoManager.stopCapturing()
    this.transact(() => {
      for (const { id, patch } of patches) {
        const b = this.blocksMap.get(id)
        if (b) this.blocksMap.set(id, this.stamp(b, patch))
      }
    })
  }

  updateConnector(id: string, patch: Partial<Connector>) {
    const c = this.connectorsMap.get(id)
    if (!c) return
    this.transact(() => this.connectorsMap.set(id, this.stamp(c, patch)))
  }

  createConnector(from: string, to: string, label?: string): string | null {
    if (from === to) return null
    const dup = this.connectors().find((c) => c.from === from && c.to === to)
    if (dup) return dup.id
    return this.addConnector({ from, to, label })
  }

  addConnector(c: Partial<Connector>): string {
    const id = randomId()
    const now = Date.now()
    this.transact(() =>
      this.connectorsMap.set(id, { label: '', ...c, id, author: this.options.author, createdAt: now, updatedAt: now, pending: false, changeSet: null }),
    )
    return id
  }

  setRoute(ids: string[], route: RouteStyle) {
    this.undoManager.stopCapturing()
    this.transact(() => {
      for (const id of ids) {
        const c = this.connectorsMap.get(id)
        if (c) this.connectorsMap.set(id, this.stamp(c, { route }))
      }
    })
  }

  // ---- arrange ---------------------------------------------------------------

  private setPageRect(id: string, x: number, y: number): { id: string; patch: Partial<Block> } {
    const b = this.blocksMap.get(id)!
    const p = b.parent ? this.baseRect(b.parent) : null
    return { id, patch: { x: Math.round(x - (p?.x ?? 0)), y: Math.round(y - (p?.y ?? 0)) } }
  }

  align(mode: AlignMode) {
    const ids = this.movableIds([...this.selection].filter((id) => this.blocksMap.has(id)))
    if (ids.length < 2) return
    const rects = ids.map((id) => this.baseRect(id)!)
    const bb = union(rects)!
    this.updateBlocks(
      ids.map((id, i) => {
        const r = rects[i]
        let { x, y } = r
        if (mode === 'left') x = bb.x
        if (mode === 'center') x = bb.x + bb.w / 2 - r.w / 2
        if (mode === 'right') x = bb.x + bb.w - r.w
        if (mode === 'top') y = bb.y
        if (mode === 'middle') y = bb.y + bb.h / 2 - r.h / 2
        if (mode === 'bottom') y = bb.y + bb.h - r.h
        return this.setPageRect(id, x, y)
      }),
    )
  }

  distribute(axis: 'x' | 'y') {
    const ids = this.movableIds([...this.selection].filter((id) => this.blocksMap.has(id)))
    if (ids.length < 3) return
    const items = ids.map((id) => ({ id, r: this.baseRect(id)! })).sort((a, b) => (axis === 'x' ? a.r.x - b.r.x : a.r.y - b.r.y))
    const first = items[0].r
    const last = items[items.length - 1].r
    const span = axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y
    const total = items.reduce((s, it) => s + (axis === 'x' ? it.r.w : it.r.h), 0)
    const gap = (span - total) / (items.length - 1)
    let cursor = axis === 'x' ? first.x : first.y
    this.updateBlocks(
      items.map((it) => {
        const pos = cursor
        cursor += (axis === 'x' ? it.r.w : it.r.h) + gap
        return this.setPageRect(it.id, axis === 'x' ? pos : it.r.x, axis === 'y' ? pos : it.r.y)
      }),
    )
  }

  bringToFront() {
    const ids = [...this.selection].filter((id) => this.blocksMap.has(id))
    const base = Date.now()
    this.updateBlocks(ids.map((id, i) => ({ id, patch: { index: `z${(base + i).toString(36).padStart(10, '0')}~` } })))
  }

  sendToBack() {
    const ids = [...this.selection].filter((id) => this.blocksMap.has(id))
    const base = 9e12 - Date.now()
    this.updateBlocks(ids.map((id, i) => ({ id, patch: { index: `y${(base - ids.length + i).toString(36).padStart(10, '0')}` } })))
  }

  /** Wrap the selected blocks in a new frame. */
  groupIntoFrame(title = 'Frame') {
    const ids = this.movableIds([...this.selection]).filter((id) => this.blocksMap.get(id)?.kind !== 'frame')
    if (!ids.length) return null
    const rects = ids.map((id) => this.baseRect(id)!)
    const bb = union(rects)!
    const x = snapTo(bb.x - FRAME_PAD, this.grid)
    const y = snapTo(bb.y - FRAME_PAD, this.grid)
    const fid = this.createBlock({ kind: 'frame', x, y, w: snapTo(bb.x + bb.w + FRAME_PAD, this.grid) - x, h: snapTo(bb.y + bb.h + FRAME_PAD, this.grid) - y, title, text: '', color: 'gray', size: 'm' })
    this.transact(() => {
      ids.forEach((id, i) => {
        const b = this.blocksMap.get(id)!
        this.blocksMap.set(id, this.stamp(b, { parent: fid, x: rects[i].x - x, y: rects[i].y - y }))
      })
    })
    this.startEditing(fid)
    return fid
  }


  deleteIds(ids: string[]) {
    if (!ids.length) return
    this.undoManager.stopCapturing()
    this.transact(() => {
      const all = new Set<string>()
      const add = (id: string) => {
        if (all.has(id)) return
        all.add(id)
        for (const child of this.childrenOf(id)) add(child.id)
      }
      ids.forEach(add)
      for (const id of all) {
        if (this.connectorsMap.has(id)) this.connectorsMap.delete(id)
        if (this.blocksMap.has(id)) this.blocksMap.delete(id)
      }
      for (const c of this.connectors()) if ((c.from && all.has(c.from)) || (c.to && all.has(c.to))) this.connectorsMap.delete(c.id)
    })
    for (const id of ids) this.selection.delete(id)
    this.bump()
  }

  deleteSelection() {
    this.deleteIds([...this.selection])
  }

  /** Move the top-level members of the selection; nudges snap to the grid. */
  nudge(dx: number, dy: number) {
    const ids = this.movableIds([...this.selection])
    this.updateBlocks(ids.map((id) => ({ id, patch: { x: this.blocksMap.get(id)!.x + dx, y: this.blocksMap.get(id)!.y + dy } })))
  }

  duplicate() {
    const text = this.serialize([...this.selection])
    if (text) this.pasteSerialized(text, { x: 24, y: 24 })
  }

  undo() {
    this.stopEditing()
    this.undoManager.undo()
  }

  redo() {
    this.undoManager.redo()
  }

  /** Selected ids whose parent frame isn't also selected. */
  movableIds(ids: string[]) {
    const set = new Set(ids)
    return ids.filter((id) => {
      const b = this.blocksMap.get(id)
      return b && !(b.parent && set.has(b.parent))
    })
  }

  // ---- clipboard ---------------------------------------------------------

  serialize(ids: string[]): string | null {
    const set = new Set<string>()
    for (const id of this.movableIds(ids)) {
      if (!this.blocksMap.has(id)) continue
      set.add(id)
      for (const c of this.childrenOf(id)) set.add(c.id)
    }
    if (!set.size) return null
    const blocks = [...set].map((id) => {
      const b = this.blocksMap.get(id)!
      if (b.parent && !set.has(b.parent)) {
        const r = this.baseRect(id)!
        return { ...b, parent: null, x: r.x, y: r.y }
      }
      return b
    })
    const connectors = this.connectors().filter((c) => c.from && c.to && set.has(c.from) && set.has(c.to))
    return `aifig:${JSON.stringify({ blocks, connectors })}`
  }

  copy() {
    this.clipboard = this.serialize([...this.selection])
    return this.clipboard
  }

  /** Paste serialized blocks, either offset from their origin or centered at a page point. */
  pasteSerialized(text: string, place: Vec | { at: Vec }) {
    if (!text.startsWith('aifig:')) return false
    let data: { blocks: Block[]; connectors: Connector[] }
    try {
      data = JSON.parse(text.slice(6))
    } catch {
      return false
    }
    const tops = data.blocks.filter((b) => !b.parent)
    const bounds = union(tops.map((b) => box(b.x, b.y, b.w, b.h)))
    if (!bounds) return false
    const off = 'at' in place ? { x: snapTo(place.at.x - bounds.w / 2 - bounds.x, this.grid), y: snapTo(place.at.y - bounds.h / 2 - bounds.y, this.grid) } : place
    const idMap = new Map(data.blocks.map((b) => [b.id, randomId()]))
    const now = Date.now()
    this.undoManager.stopCapturing()
    this.transact(() => {
      data.blocks.forEach((b, i) => {
        const id = idMap.get(b.id)!
        const top = !b.parent
        this.blocksMap.set(id, {
          ...b,
          id,
          parent: b.parent ? (idMap.get(b.parent) ?? null) : null,
          x: top ? b.x + off.x : b.x,
          y: top ? b.y + off.y : b.y,
          author: this.options.author,
          createdAt: now + i,
          updatedAt: now,
          pending: false,
          changeSet: null,
        })
      })
      for (const c of data.connectors) {
        const id = randomId()
        this.connectorsMap.set(id, { ...c, id, from: idMap.get(c.from!)!, to: idMap.get(c.to!)!, author: this.options.author, createdAt: now, updatedAt: now, pending: false, changeSet: null })
      }
    })
    this.select(tops.map((b) => idMap.get(b.id)!))
    return true
  }

  paste(text: string | null, at?: Vec) {
    const pt = at ?? center(this.viewportPageBounds())
    const t = text ?? this.clipboard
    if (!t) return
    if (this.pasteSerialized(t, text ? { at: pt } : { x: 24, y: 24 })) return
    this.options.onPasteText?.(t, pt)
  }

  // ---- interactions (driven by the input controller) ---------------------

  beginMove(startPage: Vec) {
    const ids = this.movableIds([...this.selection].filter((id) => this.blocksMap.has(id)))
    if (!ids.length) return
    this.interaction = { type: 'move', startPage, ids, dx: 0, dy: 0 }
    this.bump()
  }

  updateMove(page: Vec, snap: boolean) {
    const it = this.interaction
    if (it.type !== 'move') return
    let dx = page.x - it.startPage.x
    let dy = page.y - it.startPage.y
    this.guides = []
    this.spacing = []
    const moving = union(it.ids.map((id) => this.baseVisual(id)!).filter(Boolean))
    if (moving && snap) {
      const moved = { ...moving, x: moving.x + dx, y: moving.y + dy }
      const exclude = new Set(it.ids)
      for (const id of it.ids) for (const c of this.childrenOf(id)) exclude.add(c.id)
      const vp = this.viewportPageBounds()
      const others = this.blocks()
        .filter((b) => !exclude.has(b.id))
        .map((b) => this.baseVisual(b.id)!)
        .filter((r) => r.x < vp.x + vp.w && r.x + r.w > vp.x && r.y < vp.y + vp.h && r.y + r.h > vp.y)
      const tol = SNAP_PX / this.camera.z
      const sx = this.bestSnap([moved.x, moved.x + moved.w / 2, moved.x + moved.w], others.flatMap((r) => [r.x, r.x + r.w / 2, r.x + r.w]), tol)
      const sy = this.bestSnap([moved.y, moved.y + moved.h / 2, moved.y + moved.h], others.flatMap((r) => [r.y, r.y + r.h / 2, r.y + r.h]), tol)
      const gx = sx ? null : this.gapSnap(moved, others, 'x', tol)
      const gy = sy ? null : this.gapSnap(moved, others, 'y', tol)
      if (sx) dx += sx.delta
      else if (gx !== null) dx += gx
      else dx = snapTo(moving.x + dx, this.grid) - moving.x
      if (sy) dy += sy.delta
      else if (gy !== null) dy += gy
      else dy = snapTo(moving.y + dy, this.grid) - moving.y
      const fin = { ...moving, x: moving.x + dx, y: moving.y + dy }
      this.spacing = this.measureSpacing(fin, others, gx !== null, gy !== null)
      if (sx) {
        const related = others.filter((r) => [r.x, r.x + r.w / 2, r.x + r.w].some((v) => Math.abs(v - sx.at) < 0.5))
        const ys = [fin.y, fin.y + fin.h, ...related.flatMap((r) => [r.y, r.y + r.h])]
        this.guides.push({ axis: 'x', at: sx.at, from: Math.min(...ys), to: Math.max(...ys) })
      }
      if (sy) {
        const related = others.filter((r) => [r.y, r.y + r.h / 2, r.y + r.h].some((v) => Math.abs(v - sy.at) < 0.5))
        const xs = [fin.x, fin.x + fin.w, ...related.flatMap((r) => [r.x, r.x + r.w])]
        this.guides.push({ axis: 'y', at: sy.at, from: Math.min(...xs), to: Math.max(...xs) })
      }
    }
    this.interaction = { ...it, dx, dy }
    this.bump()
  }

  /** Nearest neighbors on each side of `m` that overlap it on the cross axis. */
  private neighbors(m: Box, others: Box[]) {
    let left: Box | null = null
    let right: Box | null = null
    let top: Box | null = null
    let bottom: Box | null = null
    for (const r of others) {
      const vOverlap = r.y < m.y + m.h && r.y + r.h > m.y
      const hOverlap = r.x < m.x + m.w && r.x + r.w > m.x
      if (vOverlap && r.x + r.w <= m.x + 0.5 && (!left || r.x + r.w > left.x + left.w)) left = r
      if (vOverlap && r.x >= m.x + m.w - 0.5 && (!right || r.x < right.x)) right = r
      if (hOverlap && r.y + r.h <= m.y + 0.5 && (!top || r.y + r.h > top.y + top.h)) top = r
      if (hOverlap && r.y >= m.y + m.h - 0.5 && (!bottom || r.y < bottom.y)) bottom = r
    }
    return { left, right, top, bottom }
  }

  /** Snap to the 24px spacing token from a neighbor, or to equal gaps between two neighbors. */
  private gapSnap(m: Box, others: Box[], axis: 'x' | 'y', tol: number): number | null {
    const n = this.neighbors(m, others)
    const cands: number[] = []
    if (axis === 'x') {
      if (n.left) cands.push(n.left.x + n.left.w + SPACING_GAP - m.x)
      if (n.right) cands.push(n.right.x - SPACING_GAP - m.w - m.x)
      if (n.left && n.right) cands.push((n.left.x + n.left.w + n.right.x - m.w) / 2 - m.x)
    } else {
      if (n.top) cands.push(n.top.y + n.top.h + SPACING_GAP - m.y)
      if (n.bottom) cands.push(n.bottom.y - SPACING_GAP - m.h - m.y)
      if (n.top && n.bottom) cands.push((n.top.y + n.top.h + n.bottom.y - m.h) / 2 - m.y)
    }
    const best = cands.filter((d) => Math.abs(d) <= tol).sort((a, b) => Math.abs(a) - Math.abs(b))[0]
    return best ?? null
  }

  private measureSpacing(m: Box, others: Box[], snappedX: boolean, snappedY: boolean): Spacing[] {
    const n = this.neighbors(m, others)
    const out: Spacing[] = []
    const maxGap = 320
    const midY = (r: Box) => (Math.max(r.y, m.y) + Math.min(r.y + r.h, m.y + m.h)) / 2
    const midX = (r: Box) => (Math.max(r.x, m.x) + Math.min(r.x + r.w, m.x + m.w)) / 2
    if (n.left && m.x - (n.left.x + n.left.w) <= maxGap) out.push({ axis: 'x', from: n.left.x + n.left.w, to: m.x, at: midY(n.left), snapped: snappedX })
    if (n.right && n.right.x - (m.x + m.w) <= maxGap) out.push({ axis: 'x', from: m.x + m.w, to: n.right.x, at: midY(n.right), snapped: snappedX })
    if (n.top && m.y - (n.top.y + n.top.h) <= maxGap) out.push({ axis: 'y', from: n.top.y + n.top.h, to: m.y, at: midX(n.top), snapped: snappedY })
    if (n.bottom && n.bottom.y - (m.y + m.h) <= maxGap) out.push({ axis: 'y', from: m.y + m.h, to: n.bottom.y, at: midX(n.bottom), snapped: snappedY })
    return out.filter((s) => s.to - s.from >= 1)
  }

  private bestSnap(mine: number[], theirs: number[], tol: number) {
    let best: { delta: number; at: number } | null = null
    for (const m of mine) {
      for (const t of theirs) {
        const d = t - m
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t }
      }
    }
    return best
  }

  endMove() {
    const it = this.interaction
    if (it.type !== 'move') return
    this.interaction = { type: 'idle' }
    this.guides = []
    this.spacing = []
    if (!it.dx && !it.dy) return this.bump()
    const moving = new Set(it.ids)
    const patches: { id: string; patch: Partial<Block> }[] = []
    const touchedFrames = new Set<string>()
    for (const id of it.ids) {
      const b = this.blocksMap.get(id)!
      const r = this.baseRect(id)!
      const page = { x: r.x + it.dx, y: r.y + it.dy }
      if (b.kind === 'frame') {
        patches.push({ id, patch: { x: b.x + it.dx, y: b.y + it.dy } })
        continue
      }
      const frame = this.frameAt(center({ ...r, ...page }), moving)
      const parent = frame?.id ?? null
      if (parent) {
        const fr = this.baseRect(parent)!
        patches.push({ id, patch: { parent, x: page.x - fr.x, y: page.y - fr.y } })
        touchedFrames.add(parent)
      } else patches.push({ id, patch: { parent: null, x: page.x, y: page.y } })
    }
    this.updateBlocks(patches)
    for (const f of touchedFrames) this.growFrame(f)
  }

  /** When a block grows, push the siblings stacked below it down by the same amount (then grow the frame). */
  makeRoomBelow(id: string, prev: { y: number; h: number }) {
    const b = this.blocksMap.get(id)
    if (!b || b.h <= prev.h) return
    const grow = b.h - prev.h
    const patches = this.childrenOf(b.parent ?? null)
      .filter((s) => s.id !== id && s.kind !== 'frame' && s.y >= prev.y + prev.h - 1 && s.x < b.x + b.w && s.x + s.w > b.x)
      .map((s) => ({ id: s.id, patch: { y: snapTo(s.y + grow + this.grid - 1, this.grid) } }))
    if (patches.length) this.transact(() => patches.forEach(({ id: sid, patch }) => this.blocksMap.set(sid, this.stamp(this.blocksMap.get(sid)!, patch))))
    if (b.parent) this.growFrame(b.parent)
  }

  /** Grow a frame so its children fit with padding (never shrinks). */
  growFrame(frameId: string) {
    const f = this.blocksMap.get(frameId)
    if (!f) return
    const kids = this.childrenOf(frameId)
    if (!kids.length) return
    const minX = Math.min(0, ...kids.map((k) => k.x - FRAME_PAD))
    const minY = Math.min(0, ...kids.map((k) => k.y - FRAME_PAD))
    const maxX = Math.max(f.w, ...kids.map((k) => k.x + k.w + FRAME_PAD))
    const maxY = Math.max(f.h, ...kids.map((k) => k.y + k.h + FRAME_PAD))
    if (minX === 0 && minY === 0 && maxX === f.w && maxY === f.h) return
    const sx = snapTo(minX, this.grid)
    const sy = snapTo(minY, this.grid)
    this.transact(() => {
      this.blocksMap.set(frameId, this.stamp(f, { x: f.x + sx, y: f.y + sy, w: snapTo(maxX - sx, this.grid), h: snapTo(maxY - sy, this.grid) }))
      if (sx || sy) for (const k of kids) this.blocksMap.set(k.id, this.stamp(k, { x: k.x - sx, y: k.y - sy }))
    })
  }

  beginResize(id: string, handle: HandleId, startPage: Vec) {
    const r = this.pageRect(id)
    if (!r) return
    this.interaction = { type: 'resize', id, handle, startPage, orig: r, rect: r }
    this.bump()
  }

  updateResize(page: Vec) {
    const it = this.interaction
    if (it.type !== 'resize') return
    const b = this.blocksMap.get(it.id)
    const def = b && this.shape(b.kind)
    if (!b || !def) return
    const rot = b.rotation ?? 0
    if (rot || def.lockAspect) return this.updateResizeLocal(page, b, def, rot)
    const dx = page.x - it.startPage.x
    const dy = page.y - it.startPage.y
    let { x, y, w, h } = it.orig
    const minW = def.minW ?? 48
    const minH = def.minH ?? 32
    const g = this.grid
    if (it.handle.includes('e')) w = Math.max(minW, snapTo(it.orig.x + it.orig.w + dx, g) - x)
    if (it.handle.includes('w')) {
      const nx = Math.min(snapTo(it.orig.x + dx, g), it.orig.x + it.orig.w - minW)
      w = it.orig.x + it.orig.w - nx
      x = nx
    }
    if (def.resize === 'xy') {
      if (it.handle.includes('s')) h = Math.max(minH, snapTo(it.orig.y + it.orig.h + dy, g) - y)
      if (it.handle.includes('n')) {
        const ny = Math.min(snapTo(it.orig.y + dy, g), it.orig.y + it.orig.h - minH)
        h = it.orig.y + it.orig.h - ny
        y = ny
      }
    }
    if (def.fit) {
      const f = def.fit(b, w, h)
      if (it.handle.includes('n')) y += h - f.h
      w = f.w
      h = f.h
    }
    this.interaction = { ...it, rect: { x, y, w, h } }
    this.bump()
  }

  /** Resize in the block's own (rotated) frame, keeping the opposite edge fixed; optional aspect lock. */
  private updateResizeLocal(page: Vec, b: Block, def: ShapeDef, rot: number) {
    const it = this.interaction
    if (it.type !== 'resize') return
    const d = rotatePoint({ x: page.x - it.startPage.x, y: page.y - it.startPage.y }, { x: 0, y: 0 }, -rot)
    const W = it.orig.w
    const H = it.orig.h
    const minW = def.minW ?? 48
    const minH = def.minH ?? 32
    let x0 = 0
    let y0 = 0
    let w = W
    let h = H
    const hd = it.handle
    if (hd.includes('e')) w = Math.max(minW, W + d.x)
    if (hd.includes('w')) {
      w = Math.max(minW, W - d.x)
      x0 = W - w
    }
    if (def.resize === 'xy') {
      if (hd.includes('s')) h = Math.max(minH, H + d.y)
      if (hd.includes('n')) {
        h = Math.max(minH, H - d.y)
        y0 = H - h
      }
    }
    if (def.lockAspect) {
      const aspect = W / H
      if (hd.length === 2) {
        // corners: follow the dominant axis
        if (Math.abs(w - W) / W >= Math.abs(h - H) / H) h = w / aspect
        else w = h * aspect
      } else if (hd === 'e' || hd === 'w') h = w / aspect
      else w = h * aspect
      w = Math.max(minW, w)
      h = Math.max(minH, w / aspect)
      x0 = hd.includes('w') ? W - w : hd === 'n' || hd === 's' ? (W - w) / 2 : 0
      y0 = hd.includes('n') ? H - h : hd === 'e' || hd === 'w' ? (H - h) / 2 : 0
    }
    if (!rot) {
      w = Math.round(w)
      h = Math.round(h)
    }
    if (def.fit && !def.lockAspect) {
      const f = def.fit(b, w, h)
      if (hd.includes('n')) y0 += h - f.h
      w = f.w
      h = f.h
    }
    const shift = rotatePoint({ x: x0 + w / 2 - W / 2, y: y0 + h / 2 - H / 2 }, { x: 0, y: 0 }, rot)
    const c = { x: it.orig.x + W / 2 + shift.x, y: it.orig.y + H / 2 + shift.y }
    this.interaction = { ...it, rect: { x: c.x - w / 2, y: c.y - h / 2, w, h } }
    this.bump()
  }

  endResize() {
    const it = this.interaction
    if (it.type !== 'resize') return
    this.interaction = { type: 'idle' }
    const b = this.blocksMap.get(it.id)
    if (!b) return this.bump()
    const parent = b.parent ? this.baseRect(b.parent) : null
    this.updateBlocks([{ id: it.id, patch: { x: it.rect.x - (parent?.x ?? 0), y: it.rect.y - (parent?.y ?? 0), w: it.rect.w, h: it.rect.h } }])
    if (b.parent) this.growFrame(b.parent)
  }

  beginMarquee(startPage: Vec, additive: boolean) {
    this.interaction = { type: 'marquee', startPage, rect: box(startPage.x, startPage.y, 0, 0), base: additive ? [...this.selection] : [] }
    this.bump()
  }

  updateMarquee(page: Vec) {
    const it = this.interaction
    if (it.type !== 'marquee') return
    const rect = boxFromPoints(it.startPage, page)
    const hits = this.blocks()
      .filter((b) => {
        const r = this.visualRect(b.id)!
        if (b.kind === 'frame') return containsBox(rect, r)
        if (b.parent && containsBox(rect, this.pageRect(b.parent)!)) return false
        return r.x < rect.x + rect.w && r.x + r.w > rect.x && r.y < rect.y + rect.h && r.y + r.h > rect.y
      })
      .map((b) => b.id)
    this.selection = new Set([...it.base, ...hits])
    this.interaction = { ...it, rect }
    this.bump()
  }

  endInteraction() {
    this.interaction = { type: 'idle' }
    this.guides = []
    this.spacing = []
    this.bump()
  }

  beginConnect(from: string | null, point: Vec) {
    this.interaction = { type: 'connect', from, start: point, point, target: null }
    this.bump()
  }

  updateConnect(point: Vec) {
    const it = this.interaction
    if (it.type !== 'connect') return
    const target = this.hitTest(point, { exclude: it.from ? new Set([it.from]) : undefined })
    this.interaction = { ...it, point, target: target?.id ?? null }
    this.bump()
  }

  endConnect() {
    const it = this.interaction
    if (it.type !== 'connect') return
    this.interaction = { type: 'idle' }
    this.undoManager.stopCapturing()
    const snapPt = (p: Vec) => ({ x: snapTo(p.x, this.grid), y: snapTo(p.y, this.grid) })
    const far = Math.hypot(it.point.x - it.start.x, it.point.y - it.start.y) > 24 / this.camera.z
    if (!it.from) {
      // connector tool from empty canvas: free start, bound or free end
      if (!far && !it.target) return this.bump()
      const id = this.addConnector({ fromPoint: snapPt(it.start), ...(it.target ? { to: it.target } : { toPoint: snapPt(it.point) }) })
      this.select([id])
      return
    }
    const from = this.blocksMap.get(it.from)
    if (!from) return this.bump()
    if (it.target) {
      const id = this.createConnector(it.from, it.target)
      if (id) this.select([id])
      return
    }
    const fr = this.baseRect(it.from)!
    if (Math.hypot(it.point.x - center(fr).x, it.point.y - center(fr).y) < Math.max(fr.w, fr.h) * 0.7) return this.bump()
    if (this.tool === 'connector') {
      const id = this.addConnector({ from: it.from, toPoint: snapPt(it.point) })
      this.select([id])
      return
    }
    const draft = this.options.createForConnectorDrop?.(from, it.point)
    if (!draft) return this.bump()
    const pid = this.placeDraft(draft, it.point)
    this.addConnector({ from: it.from, to: pid })
    this.startEditing(pid)
  }

  beginEndpoint(id: string, which: 'start' | 'end', point: Vec) {
    const c = this.connectorsMap.get(id)
    if (!c) return
    this.interaction = { type: 'endpoint', id, which, point, target: (which === 'start' ? c.from : c.to) ?? null }
    this.bump()
  }

  updateEndpoint(point: Vec) {
    const it = this.interaction
    if (it.type !== 'endpoint') return
    const c = this.connectorsMap.get(it.id)
    const other = it.which === 'start' ? c?.to : c?.from
    const target = this.hitTest(point, { exclude: other ? new Set([other]) : undefined })
    this.interaction = { ...it, point, target: target?.id ?? null }
    this.bump()
  }

  /** Drop a dragged endpoint: rebind to the block under it, or leave it floating. */
  endEndpoint() {
    const it = this.interaction
    if (it.type !== 'endpoint') return
    this.interaction = { type: 'idle' }
    const c = this.connectorsMap.get(it.id)
    if (!c) return this.bump()
    const pt = { x: snapTo(it.point.x, this.grid), y: snapTo(it.point.y, this.grid) }
    const patch: Partial<Connector> =
      it.which === 'start' ? (it.target ? { from: it.target, fromPoint: null } : { from: null, fromPoint: pt }) : it.target ? { to: it.target, toPoint: null } : { to: null, toPoint: pt }
    this.undoManager.stopCapturing()
    this.transact(() => this.connectorsMap.set(it.id, this.stamp(c, patch)))
    this.bump()
  }

  /** Create a draft centered at a page point, inside the frame under it if any. */
  placeDraft(draft: BlockDraft, at: Vec): string {
    let x = snapTo(at.x - draft.w / 2, this.grid)
    let y = snapTo(at.y - draft.h / 2, this.grid)
    let parent: string | null = null
    if (draft.kind !== 'frame') {
      const frame = this.frameAt(at)
      if (frame) {
        const fr = this.baseRect(frame.id)!
        parent = frame.id
        x -= fr.x
        y -= fr.y
      }
    }
    const id = this.createBlock({ ...draft, x, y, parent })
    if (parent) this.growFrame(parent)
    return id
  }

  createWithTool(tool: string, at: Vec) {
    const draft = this.options.createForTool?.(tool, at)
    if (!draft) return
    const id = this.placeDraft(draft, at)
    this.tool = 'select'
    this.startEditing(id)
  }

  beginFrame(startPage: Vec) {
    this.interaction = { type: 'frame', startPage, rect: box(startPage.x, startPage.y, 0, 0) }
    this.bump()
  }

  updateFrame(page: Vec) {
    const it = this.interaction
    if (it.type !== 'frame') return
    const r = boxFromPoints(it.startPage, page)
    const g = this.grid
    const x = snapTo(r.x, g)
    const y = snapTo(r.y, g)
    this.interaction = { ...it, rect: { x, y, w: snapTo(r.x + r.w, g) - x, h: snapTo(r.y + r.h, g) - y } }
    this.bump()
  }

  endFrame() {
    const it = this.interaction
    if (it.type !== 'frame') return
    this.interaction = { type: 'idle' }
    let rect = it.rect
    if (rect.w < 64 || rect.h < 48) rect = { x: snapTo(it.startPage.x, this.grid), y: snapTo(it.startPage.y, this.grid), w: 480, h: 320 }
    const inside = this.childrenOf(null).filter((b) => b.kind !== 'frame' && containsBox(rect, this.baseRect(b.id)!))
    const id = this.createBlock({ kind: 'frame', x: rect.x, y: rect.y, w: rect.w, h: rect.h, title: 'Frame', text: '', color: 'gray', size: 'm' })
    this.transact(() => {
      for (const b of inside) this.blocksMap.set(b.id, this.stamp(b, { parent: id, x: b.x - rect.x, y: b.y - rect.y }))
    })
    this.tool = 'select'
    this.startEditing(id)
  }
}
