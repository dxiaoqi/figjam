import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  StateNode,
  T,
  atom,
  createShapeId,
  stopEventPropagation,
  useEditor,
  useValue,
  type Editor,
  type TLShape,
  type TLShapeId,
} from 'tldraw'
import { measureCard, measureText, stickyFontSize } from '@/shared/text'
import { COLOR_TOKENS, FONT_SIZES, RADII, SPACING, STICKY_SIZES, snap, type ColorToken, type SizeToken } from '@/shared/tokens'

export const STICKY = 'aifig-sticky'
export const CARD = 'aifig-card'
export const TEXT = 'aifig-text'

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [STICKY]: { w: number; h: number; text: string; color: string; size: string }
    [CARD]: { w: number; h: number; title: string; text: string; color: string; size: string }
    [TEXT]: { w: number; h: number; text: string; color: string; size: string }
  }
}

export type StickyShape = TLShape<typeof STICKY>
export type CardShape = TLShape<typeof CARD>
export type TextShape = TLShape<typeof TEXT>
export type AifigShape = StickyShape | CardShape | TextShape

export interface AifigMeta {
  pending?: boolean
  agentColor?: string
  agentName?: string
  entering?: boolean
  enterDelay?: number
  accepted?: boolean
}

/** Color used for the next block a person creates. */
export const nextColor = atom<ColorToken>('next color', 'yellow')

export function isAifigShape(s: TLShape | undefined): s is AifigShape {
  return !!s && (s.type === STICKY || s.type === CARD || s.type === TEXT)
}

function useIsEditing(id: TLShapeId) {
  const editor = useEditor()
  return useValue('editing', () => editor.getEditingShapeId() === id, [editor, id])
}

function blockClass(shape: AifigShape) {
  const meta = shape.meta as AifigMeta
  return [
    'aifig-block',
    `aifig-c-${shape.props.color}`,
    meta.pending ? 'is-pending' : '',
    meta.entering ? 'is-entering' : '',
    meta.accepted ? 'is-accepted' : '',
  ].join(' ')
}

function blockStyle(shape: AifigShape, radius: number): CSSProperties {
  const meta = shape.meta as AifigMeta
  return {
    ['--agent' as string]: meta.agentColor ?? '#6E56CF',
    ['--enter-delay' as string]: `${meta.enterDelay ?? 0}ms`,
    ['--r' as string]: `${radius}px`,
  }
}

function roundedPath(w: number, h: number, r: number) {
  const p = new Path2D()
  p.roundRect(0, 0, w, h, r)
  return p
}

function AutoFocusArea(props: { value: string; placeholder: string; onChange: (v: string) => void; className?: string; style?: CSSProperties; autoFocus?: boolean; onTab?: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (props.autoFocus === false) return
    // tldraw moves focus back to the canvas while the creating pointer event settles
    const focus = () => {
      const el = ref.current
      if (!el || document.activeElement === el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    focus()
    const raf = requestAnimationFrame(focus)
    const t = setTimeout(focus, 60)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [props.autoFocus])
  return (
    <textarea
      ref={ref}
      className={props.className}
      style={props.style}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      onPointerDown={stopEventPropagation}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && props.onTab && !e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          props.onTab()
          return
        }
        if (e.key !== 'Escape') e.stopPropagation()
      }}
      spellCheck={false}
    />
  )
}

/** Tab while writing a sticky: start the next one to the right, same color and size. */
function continueSticky(editor: Editor, shape: StickyShape) {
  const id = createShapeId()
  editor.markHistoryStoppingPoint('continue sticky')
  editor.createShape<StickyShape>({ id, type: STICKY, parentId: shape.parentId, x: shape.x + shape.props.w + SPACING.gap, y: shape.y, props: { ...shape.props, text: '' } })
  editor.select(id)
  editor.setEditingShape(id)
  editor.setCurrentTool('select.editing_shape', { target: 'shape', shape: editor.getShape(id) })
}

// ---- sticky ------------------------------------------------------------

function StickyComponent({ shape }: { shape: StickyShape }) {
  const editor = useEditor()
  const editing = useIsEditing(shape.id)
  const fs = stickyFontSize(shape.props.text, shape.props.w)
  return (
    <HTMLContainer style={{ pointerEvents: editing ? 'all' : 'none' }}>
      <div className={blockClass(shape)} style={blockStyle(shape, RADII.sticky)}>
      <div className="aifig-sticky" style={{ fontSize: fs }}>
        {editing ? (
          <AutoFocusArea
            value={shape.props.text}
            placeholder="Write an idea…"
            onChange={(text) => editor.updateShape<StickyShape>({ id: shape.id, type: STICKY, props: { text } })}
            onTab={() => continueSticky(editor, shape)}
          />
        ) : shape.props.text ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{shape.props.text}</div>
        ) : (
          <div className="aifig-placeholder">Double-click to write</div>
        )}
      </div>
      </div>
    </HTMLContainer>
  )
}

export class StickyShapeUtil extends BaseBoxShapeUtil<StickyShape> {
  static override type = STICKY
  static override props = { w: T.number, h: T.number, text: T.string, color: T.string, size: T.string }
  override canEdit = () => true
  override canResize = () => false
  override hideSelectionBoundsFg = () => true

  override onEditEnd(shape: StickyShape) {
    if (!shape.props.text.trim()) this.editor.deleteShapes([shape.id])
  }
  getDefaultProps(): StickyShape['props'] {
    return { w: 200, h: 200, text: '', color: 'yellow', size: 'm' }
  }
  component(shape: StickyShape) {
    return <StickyComponent shape={shape} />
  }
  override getIndicatorPath(shape: StickyShape) {
    return roundedPath(shape.props.w, shape.props.h, RADII.sticky)
  }
}

// ---- card ----------------------------------------------------------------

function CardComponent({ shape }: { shape: CardShape }) {
  const editor = useEditor()
  const editing = useIsEditing(shape.id)
  const titleRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (!editing) return
    const focus = () => titleRef.current && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement !== titleRef.current && titleRef.current.focus()
    focus()
    const raf = requestAnimationFrame(focus)
    const t = setTimeout(focus, 60)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [editing])
  const update = (patch: Partial<CardShape['props']>) => {
    const next = { ...shape.props, ...patch }
    const m = measureCard(next.title, next.text, next.size as SizeToken)
    editor.updateShape<CardShape>({ id: shape.id, type: CARD, props: { ...patch, h: Math.max(m.h, 88) } })
  }
  return (
    <HTMLContainer style={{ pointerEvents: editing ? 'all' : 'none' }}>
      <div className={blockClass(shape)} style={blockStyle(shape, RADII.card)}>
      <div className="aifig-card">
        {editing ? (
          <>
            <input
              ref={titleRef}
              className="title"
              value={shape.props.title}
              placeholder="Title"
              onChange={(e) => update({ title: e.target.value })}
              onPointerDown={stopEventPropagation}
              onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
            />
            <AutoFocusArea className="body" autoFocus={false} value={shape.props.text} placeholder="Details…" onChange={(text) => update({ text })} />
          </>
        ) : (
          <>
            <div className={`title ${shape.props.title ? '' : 'aifig-placeholder'}`}>{shape.props.title || 'Untitled card'}</div>
            {shape.props.text && <div className="body">{shape.props.text}</div>}
          </>
        )}
      </div>
      </div>
    </HTMLContainer>
  )
}

export class CardShapeUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = CARD
  static override props = { w: T.number, h: T.number, title: T.string, text: T.string, color: T.string, size: T.string }
  override canEdit = () => true

  override onEditEnd(shape: CardShape) {
    if (!shape.props.text.trim() && !shape.props.title.trim()) this.editor.deleteShapes([shape.id])
  }
  getDefaultProps(): CardShape['props'] {
    return { w: 280, h: 96, title: '', text: '', color: 'blue', size: 'm' }
  }
  component(shape: CardShape) {
    return <CardComponent shape={shape} />
  }
  override getIndicatorPath(shape: CardShape) {
    return roundedPath(shape.props.w, shape.props.h, RADII.card)
  }
}

// ---- text ------------------------------------------------------------------

function TextComponent({ shape }: { shape: TextShape }) {
  const editor = useEditor()
  const editing = useIsEditing(shape.id)
  const size = shape.props.size as SizeToken
  const bold = size === 'l' || size === 'xl'
  const style: CSSProperties = { fontSize: FONT_SIZES[size], fontWeight: bold ? 650 : 400, letterSpacing: bold ? '-0.01em' : undefined }
  return (
    <HTMLContainer style={{ pointerEvents: editing ? 'all' : 'none' }}>
      <div className={blockClass(shape)} style={blockStyle(shape, 4)}>
      <div className="aifig-text" style={style}>
        {editing ? (
          <AutoFocusArea
            value={shape.props.text}
            placeholder="Heading"
            onChange={(text) => {
              const m = measureText(text, size)
              editor.updateShape<TextShape>({ id: shape.id, type: TEXT, props: { text, w: m.w, h: m.h } })
            }}
          />
        ) : (
          shape.props.text || <span className="aifig-placeholder">Heading</span>
        )}
      </div>
      </div>
    </HTMLContainer>
  )
}

export class TextShapeUtil extends BaseBoxShapeUtil<TextShape> {
  static override type = TEXT
  static override props = { w: T.number, h: T.number, text: T.string, color: T.string, size: T.string }
  override canEdit = () => true

  override onEditEnd(shape: TextShape) {
    if (!shape.props.text.trim()) this.editor.deleteShapes([shape.id])
  }
  getDefaultProps(): TextShape['props'] {
    return { w: 160, h: 32, text: '', color: 'gray', size: 'l' }
  }
  component(shape: TextShape) {
    return <TextComponent shape={shape} />
  }
  override getIndicatorPath(shape: TextShape) {
    return roundedPath(shape.props.w, shape.props.h, 2)
  }
}

export const shapeUtils = [StickyShapeUtil, CardShapeUtil, TextShapeUtil]

// ---- tools -------------------------------------------------------------------

export function createAndEdit(editor: Editor, type: AifigShape['type'], props: Record<string, unknown>, w: number, h: number) {
  const p = editor.inputs.getCurrentPagePoint()
  const id = createShapeId()
  let x = snap(p.x - w / 2)
  let y = snap(p.y - h / 2)
  let parentId: TLShapeId | undefined
  const frame = editor.getShapeAtPoint(p, { filter: (s) => s.type === 'frame', hitInside: true })
  if (frame) {
    parentId = frame.id
    x = snap(x - frame.x)
    y = snap(y - frame.y)
  }
  editor.markHistoryStoppingPoint(`create ${type}`)
  editor.createShape({ id, type, x, y, parentId, props: { w, h, ...props } } as any)
  editor.select(id)
  editor.setEditingShape(id)
  editor.setCurrentTool('select.editing_shape', { target: 'shape', shape: editor.getShape(id) })
}

export function createStickyHere(editor: Editor) {
  const s = STICKY_SIZES.m
  createAndEdit(editor, STICKY, { color: nextColor.get(), text: '', size: 'm' }, s, s)
}

export class StickyTool extends StateNode {
  static override id = STICKY
  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }
  override onPointerDown() {
    createStickyHere(this.editor)
  }
}

export class CardTool extends StateNode {
  static override id = CARD
  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }
  override onPointerDown() {
    const c = nextColor.get()
    createAndEdit(this.editor, CARD, { color: c === 'yellow' ? 'blue' : c, title: '', text: '', size: 'm' }, 280, 96)
  }
}

export class TextTool extends StateNode {
  static override id = TEXT
  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }
  override onPointerDown() {
    createAndEdit(this.editor, TEXT, { color: 'gray', text: '', size: 'l' }, 160, 40)
  }
}

export const customTools = [StickyTool, CardTool, TextTool]
export { COLOR_TOKENS }
