import {
  getArrowBindings,
  renderPlaintextFromRichText,
  toRichText,
  type Editor,
  type TLArrowShape,
  type TLRecord,
  type TLShape,
  type TLShapeId,
  type TLStoreEventInfo,
} from 'tldraw'
import * as Y from 'yjs'
import type { Author, Block, Connector } from '@/shared/model'
import { toColorToken, toSizeToken } from '@/shared/tokens'
import { CARD, STICKY, TEXT, type AifigMeta } from './shapes'

const sid = (id: string) => `shape:${id}` as TLShapeId
const bid = (id: string) => id.replace(/^shape:/, '')

const KIND_TO_TYPE: Record<Block['kind'], string> = { sticky: STICKY, card: CARD, text: TEXT, frame: 'frame' }
const TYPE_TO_KIND: Record<string, Block['kind']> = { [STICKY]: 'sticky', [CARD]: 'card', [TEXT]: 'text', frame: 'frame' }

const round = (v: number) => Math.round(v * 100) / 100

/**
 * Two-way adapter between the board's Yjs document (source of truth, owned by the core)
 * and tldraw's store (a view projection used for rendering and direct manipulation).
 */
export class BoardBinding {
  private blocks: Y.Map<Block>
  private conns: Y.Map<Connector>
  private disposers: (() => void)[] = []
  private timers = new Set<number>()

  constructor(
    private editor: Editor,
    private doc: Y.Doc,
    private me: Author,
  ) {
    this.blocks = doc.getMap<Block>('blocks')
    this.conns = doc.getMap<Connector>('connectors')
  }

  start() {
    this.remote(() => {
      this.syncBlocks([...this.blocks.keys()], false)
      this.syncConnectors([...this.conns.keys()])
    })
    const onTx = (tr: Y.Transaction) => {
      if (tr.origin === this) return
      const bKeys = tr.changed.get(this.blocks as any)
      const cKeys = tr.changed.get(this.conns as any)
      if (!bKeys && !cKeys) return
      this.remote(() => {
        if (bKeys) this.syncBlocks([...bKeys].filter(Boolean) as string[], true)
        if (cKeys) this.syncConnectors([...cKeys].filter(Boolean) as string[])
      })
    }
    this.doc.on('afterTransaction', onTx)
    this.disposers.push(() => this.doc.off('afterTransaction', onTx))
    this.disposers.push(this.editor.store.listen(this.onStore, { source: 'user', scope: 'document' }))
  }

  dispose() {
    this.disposers.forEach((d) => d())
    this.timers.forEach((t) => clearTimeout(t))
  }

  private remote(fn: () => void) {
    this.editor.store.mergeRemoteChanges(() => {
      this.editor.run(fn, { history: 'ignore', ignoreShapeLock: true })
    })
  }

  private later(ms: number, fn: () => void) {
    const t = window.setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }

  // ---- Yjs → tldraw ---------------------------------------------------------

  private metaFor(b: Block | Connector): AifigMeta {
    const meta: AifigMeta = { pending: !!b.pending }
    if (b.author?.kind === 'agent') {
      if (b.author.color) meta.agentColor = b.author.color
      meta.agentName = b.author.name
    }
    return meta
  }

  private shapePartial(b: Block) {
    const parentId = b.parent && this.editor.getShape(sid(b.parent)) ? sid(b.parent) : this.editor.getCurrentPageId()
    const type = KIND_TO_TYPE[b.kind]
    let props: Record<string, unknown>
    if (b.kind === 'frame') props = { w: b.w, h: b.h, name: b.title ?? '' }
    else if (b.kind === 'card') props = { w: b.w, h: b.h, title: b.title ?? '', text: b.text ?? '', color: b.color, size: b.size }
    else props = { w: b.w, h: b.h, text: b.text ?? '', color: b.color, size: b.size }
    return { id: sid(b.id), type, x: b.x, y: b.y, parentId, props, meta: this.metaFor(b) }
  }

  private syncBlocks(keys: string[], animate: boolean) {
    const editor = this.editor
    const present = keys.map((k) => this.blocks.get(k)).filter(Boolean) as Block[]
    present.sort((a, b) => (a.kind === 'frame' ? 0 : 1) - (b.kind === 'frame' ? 0 : 1))
    let enterIndex = 0
    const entering: TLShapeId[] = []
    const settled: TLShapeId[] = []
    for (const b of present) {
      const partial = this.shapePartial(b) as any
      const existing = editor.getShape(partial.id)
      if (!existing) {
        if (animate && b.author?.kind === 'agent' && b.kind !== 'frame') {
          partial.meta = { ...partial.meta, entering: true, enterDelay: Math.min(enterIndex++, 30) * 40 }
          entering.push(partial.id)
        }
        if (b.index) partial.index = b.index
        try {
          editor.createShape(partial)
        } catch {
          delete partial.index
          editor.createShape(partial)
        }
        continue
      }
      if (existing.type !== partial.type) {
        editor.deleteShapes([existing.id])
        editor.createShape(partial)
        continue
      }
      const prevMeta = existing.meta as AifigMeta
      if (prevMeta.pending && !partial.meta.pending) {
        partial.meta = { ...partial.meta, accepted: true }
        settled.push(partial.id)
      }
      if (existing.parentId !== partial.parentId) editor.reparentShapes([existing.id], partial.parentId)
      editor.updateShape(partial)
    }
    const removed = keys.filter((k) => !this.blocks.get(k)).map(sid).filter((id) => editor.getShape(id))
    if (removed.length) editor.deleteShapes(removed)

    if (entering.length) this.later(1600 + enterIndex * 40, () => this.clearMeta(entering, 'entering'))
    if (settled.length) this.later(500, () => this.clearMeta(settled, 'accepted'))
  }

  private clearMeta(ids: TLShapeId[], key: keyof AifigMeta) {
    this.remote(() => {
      for (const id of ids) {
        const s = this.editor.getShape(id)
        if (!s) continue
        const meta = { ...(s.meta as AifigMeta) }
        delete meta[key]
        this.editor.updateShape({ id, type: s.type, meta } as any)
      }
    })
  }

  private endPoint(blockId: string | null | undefined, point: { x: number; y: number } | null | undefined) {
    if (blockId) {
      const b = this.editor.getShapePageBounds(sid(blockId))
      if (b) return { x: b.midX, y: b.midY, bound: true }
    }
    return point ? { ...point, bound: false } : null
  }

  private syncConnectors(keys: string[]) {
    const editor = this.editor
    for (const key of keys) {
      const c = this.conns.get(key)
      const id = sid(key)
      const existing = editor.getShape<TLArrowShape>(id)
      if (!c) {
        if (existing) editor.deleteShapes([id])
        continue
      }
      const start = this.endPoint(c.from, c.fromPoint)
      const end = this.endPoint(c.to, c.toPoint)
      if (!start || !end) continue
      const style = { dash: c.pending ? 'dashed' : 'solid', richText: toRichText(c.label ?? '') }
      if (existing) {
        const b = getArrowBindings(editor, existing)
        const same = (b.start ? bid(b.start.toId) : null) === (c.from ?? null) && (b.end ? bid(b.end.toId) : null) === (c.to ?? null)
        if (same) {
          editor.updateShape({ id, type: 'arrow', props: style, meta: this.metaFor(c) } as any)
          continue
        }
        editor.deleteShapes([id])
      }
      editor.createShape({
        id,
        type: 'arrow',
        x: start.x,
        y: start.y,
        meta: this.metaFor(c),
        props: {
          ...style,
          start: { x: 0, y: 0 },
          end: { x: end.x - start.x, y: end.y - start.y },
          color: 'grey',
          size: 's',
          font: 'sans',
          arrowheadEnd: 'arrow',
          arrowheadStart: 'none',
          bend: 0,
        },
      } as any)
      const bindings: any[] = []
      for (const [terminal, blockId, p] of [
        ['start', c.from, start],
        ['end', c.to, end],
      ] as const) {
        if (blockId && p.bound) {
          bindings.push({
            type: 'arrow',
            fromId: id,
            toId: sid(blockId),
            props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' },
          })
        }
      }
      if (bindings.length) editor.createBindings(bindings)
    }
  }

  // ---- tldraw → Yjs ---------------------------------------------------------

  private onStore = ({ changes }: TLStoreEventInfo) => {
    const blockWrites = new Map<string, Block>()
    const blockDeletes = new Set<string>()
    const arrows = new Set<TLShapeId>()
    const connDeletes = new Set<string>()

    const touch = (rec: TLRecord) => {
      if (rec.typeName === 'shape') {
        if (TYPE_TO_KIND[rec.type]) {
          const b = this.blockFromShape(rec)
          if (b) blockWrites.set(b.id, b)
        } else if (rec.type === 'arrow') arrows.add(rec.id)
      } else if (rec.typeName === 'binding' && rec.type === 'arrow') {
        arrows.add(rec.fromId)
      }
    }
    for (const rec of Object.values(changes.added)) touch(rec)
    for (const [, rec] of Object.values(changes.updated)) touch(rec)
    for (const rec of Object.values(changes.removed)) {
      if (rec.typeName === 'shape') {
        if (TYPE_TO_KIND[rec.type]) blockDeletes.add(bid(rec.id))
        else if (rec.type === 'arrow') connDeletes.add(bid(rec.id))
      } else if (rec.typeName === 'binding' && rec.type === 'arrow') arrows.add(rec.fromId)
    }
    const connWrites: Connector[] = []
    for (const id of arrows) {
      const arrow = this.editor.getShape<TLArrowShape>(id)
      if (!arrow) continue
      const c = this.connectorFromArrow(arrow)
      if (c) connWrites.push(c)
    }
    if (!blockWrites.size && !blockDeletes.size && !connWrites.length && !connDeletes.size) return
    this.doc.transact(() => {
      for (const b of blockWrites.values()) this.blocks.set(b.id, b)
      for (const id of blockDeletes) this.blocks.delete(id)
      for (const c of connWrites) this.conns.set(c.id, c)
      for (const id of connDeletes) this.conns.delete(id)
    }, this)
  }

  private blockFromShape(s: TLShape): Block | null {
    const kind = TYPE_TO_KIND[s.type]
    const id = bid(s.id)
    const existing = this.blocks.get(id)
    const props = s.props as any
    const now = Date.now()
    const next: Block = {
      ...(existing ?? { createdAt: now, author: this.me, color: 'yellow', size: 'm', text: '' }),
      id,
      kind,
      x: round(s.x),
      y: round(s.y),
      w: round(props.w),
      h: round(props.h),
      parent: s.parentId.startsWith('shape:') ? bid(s.parentId) : null,
      index: s.index,
      updatedAt: now,
    } as Block
    if (kind === 'frame') next.title = props.name
    else {
      next.text = props.text ?? ''
      next.color = toColorToken(props.color)
      next.size = toSizeToken(props.size)
      if (kind === 'card') next.title = props.title
    }
    if (existing) {
      const keys: (keyof Block)[] = ['x', 'y', 'w', 'h', 'parent', 'index', 'text', 'title', 'color', 'size', 'kind']
      if (keys.every((k) => (existing[k] ?? null) === (next[k] ?? null))) return null
    }
    return next
  }

  private connectorFromArrow(arrow: TLArrowShape): Connector | null {
    const b = getArrowBindings(this.editor, arrow)
    const mapped = (toId?: TLShapeId) => {
      if (!toId) return null
      const target = this.editor.getShape(toId)
      return target && TYPE_TO_KIND[target.type] ? bid(toId) : null
    }
    const from = mapped(b.start?.toId)
    const to = mapped(b.end?.toId)
    const tf = this.editor.getShapePageTransform(arrow)
    const sp = tf.applyToPoint(arrow.props.start)
    const ep = tf.applyToPoint(arrow.props.end)
    const id = bid(arrow.id)
    const existing = this.conns.get(id)
    const label = renderPlaintextFromRichText(this.editor, arrow.props.richText)
    const now = Date.now()
    const next: Connector = {
      ...(existing ?? { createdAt: now, author: this.me }),
      id,
      from,
      to,
      fromPoint: from ? null : { x: round(sp.x), y: round(sp.y) },
      toPoint: to ? null : { x: round(ep.x), y: round(ep.y) },
      label,
      updatedAt: now,
    } as Connector
    if (existing) {
      const same =
        existing.from === next.from &&
        existing.to === next.to &&
        (existing.label ?? '') === label &&
        JSON.stringify(existing.fromPoint ?? null) === JSON.stringify(next.fromPoint) &&
        JSON.stringify(existing.toPoint ?? null) === JSON.stringify(next.toPoint)
      if (same) return null
    }
    return next
  }
}
