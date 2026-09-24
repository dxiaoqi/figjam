import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import type { BlockDraft, BlockRenderProps, Editor, ShapeDef } from '@aifig/canvas-engine'
import {
  CARD_ACCENT,
  CARD_BODY_SIZE,
  CARD_TITLE_SIZE,
  FONT_SIZES,
  RADII,
  SPACING,
  STICKY_SIZES,
  measureCard,
  measureSticky,
  measureText,
  snapUp,
  stickyFontSize,
  textBlockHeight,
  type Block,
  type ColorToken,
  type SizeToken,
} from '@aifig/shared'

// ---- next color (shared by the toolbar and creation tools) --------------------

let nextColorValue: ColorToken = 'yellow'
const colorListeners = new Set<() => void>()
export const nextColor = {
  get: () => nextColorValue,
  set: (c: ColorToken) => {
    nextColorValue = c
    colorListeners.forEach((l) => l())
  },
}
export function useNextColor() {
  return useSyncExternalStore(
    (fn) => {
      colorListeners.add(fn)
      return () => colorListeners.delete(fn)
    },
    nextColor.get,
  )
}

// ---- editing helpers ------------------------------------------------------------

function useFocusOnMount<T extends HTMLInputElement | HTMLTextAreaElement>(enabled = true) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    if (!enabled) return
    const focus = () => {
      const el = ref.current
      if (!el || document.activeElement === el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    focus()
    const raf = requestAnimationFrame(focus)
    return () => cancelAnimationFrame(raf)
  }, [enabled])
  return ref
}

function EditArea(props: { value: string; placeholder: string; onChange: (v: string) => void; className?: string; style?: CSSProperties; autoFocus?: boolean; onTab?: () => void }) {
  const ref = useFocusOnMount<HTMLTextAreaElement>(props.autoFocus !== false)
  return (
    <textarea
      ref={ref}
      className={props.className}
      style={props.style}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && props.onTab && !e.shiftKey) {
          e.preventDefault()
          props.onTab()
        }
      }}
      spellCheck={false}
    />
  )
}

/** Tab while writing a sticky: start the next one to the right, same color and size. */
function continueSticky(editor: Editor, b: Block) {
  editor.stopEditing()
  const id = editor.createBlock({ kind: 'sticky', parent: b.parent ?? null, x: b.x + b.w + SPACING.gap, y: b.y, w: b.w, h: b.h, color: b.color, size: b.size, text: '' })
  if (b.parent) editor.growFrame(b.parent)
  editor.startEditing(id)
}

export function cardHeight(title: string, body: string, w: number) {
  const inner = w - SPACING.blockPadding * 2
  let h = SPACING.blockPadding + CARD_ACCENT
  if (title) h += textBlockHeight(title, inner, CARD_TITLE_SIZE, true)
  if (title && body) h += 6
  if (body) h += textBlockHeight(body, inner, CARD_BODY_SIZE)
  h += SPACING.blockPadding
  return Math.max(snapUp(h), 88)
}

function textHeight(text: string, size: SizeToken, w: number) {
  const bold = size === 'l' || size === 'xl'
  return snapUp(textBlockHeight(text || ' ', w - 8, FONT_SIZES[size], bold))
}

// ---- renderers ----------------------------------------------------------------

function Sticky({ block, editing, editor }: BlockRenderProps) {
  const fs = stickyFontSize(block.text, block.w)
  return (
    <div className="aifig-sticky" style={{ fontSize: fs }}>
      {editing ? (
        <EditArea value={block.text} placeholder="Write an idea…" onChange={(text) => editor.updateBlock(block.id, { text })} onTab={() => continueSticky(editor, block)} />
      ) : block.text ? (
        <div style={{ whiteSpace: 'pre-wrap' }}>{block.text}</div>
      ) : (
        <div className="aifig-placeholder">Double-click to write</div>
      )}
    </div>
  )
}

function Card({ block, editing, editor }: BlockRenderProps) {
  const titleRef = useFocusOnMount<HTMLInputElement>(editing)
  const update = (patch: Partial<Block>) => {
    const next = { ...block, ...patch }
    editor.updateBlock(block.id, { ...patch, h: cardHeight(next.title ?? '', next.text, block.w) })
  }
  return (
    <div className="aifig-card">
      {editing ? (
        <>
          <input ref={titleRef} className="title" value={block.title ?? ''} placeholder="Title" onChange={(e) => update({ title: e.target.value })} />
          <EditArea className="body" autoFocus={false} value={block.text} placeholder="Details…" onChange={(text) => update({ text })} />
        </>
      ) : (
        <>
          <div className={`title ${block.title ? '' : 'aifig-placeholder'}`}>{block.title || 'Untitled card'}</div>
          {block.text && <div className="body">{block.text}</div>}
        </>
      )}
    </div>
  )
}

function Text({ block, editing, editor }: BlockRenderProps) {
  const size = block.size
  const bold = size === 'l' || size === 'xl'
  const style: CSSProperties = { fontSize: FONT_SIZES[size], fontWeight: bold ? 650 : 400, letterSpacing: bold ? '-0.01em' : undefined }
  return (
    <div className="aifig-text" style={style}>
      {editing ? (
        <EditArea
          value={block.text}
          placeholder="Heading"
          onChange={(text) => {
            const m = measureText(text, size)
            const w = Math.max(m.w, block.w)
            editor.updateBlock(block.id, { text, w, h: textHeight(text, size, w) })
          }}
        />
      ) : (
        block.text || <span className="aifig-placeholder">Heading</span>
      )}
    </div>
  )
}

function Frame() {
  return <div className="aifig-frame" />
}

export const shapeDefs: ShapeDef[] = [
  { kind: 'sticky', resize: 'none', canEdit: true, radius: RADII.sticky, render: Sticky, isEmpty: (b) => !b.text.trim() },
  {
    kind: 'card',
    resize: 'x',
    canEdit: true,
    radius: RADII.card,
    minW: 200,
    render: Card,
    fit: (b, w) => ({ w, h: cardHeight(b.title ?? '', b.text, w) }),
    isEmpty: (b) => !b.text.trim() && !(b.title ?? '').trim(),
  },
  { kind: 'text', resize: 'x', canEdit: true, radius: 4, minW: 48, render: Text, fit: (b, w) => ({ w, h: textHeight(b.text, b.size, w) }), isEmpty: (b) => !b.text.trim() },
  { kind: 'frame', resize: 'xy', canEdit: true, container: true, radius: RADII.frame, minW: 160, minH: 120, render: Frame },
]

export function draftForTool(tool: string): BlockDraft | null {
  const c = nextColor.get()
  if (tool === 'sticky') return { kind: 'sticky', w: STICKY_SIZES.m, h: STICKY_SIZES.m, size: 'm', color: c, text: '' }
  if (tool === 'card') return { kind: 'card', w: 280, h: 96, size: 'm', color: c === 'yellow' ? 'blue' : c, title: '', text: '' }
  if (tool === 'text') return { kind: 'text', w: 160, h: 40, size: 'l', color: 'gray', text: '' }
  return null
}

export function draftForPastedText(text: string): BlockDraft {
  const clean = text.trim()
  if (clean.length > 120 || clean.includes('\n')) {
    const [first, ...rest] = clean.split('\n')
    const title = first.slice(0, 80)
    const body = rest.join('\n').trim() || (first.length > 80 ? first : '')
    const m = measureCard(title, body, 'm')
    return { kind: 'card', ...m, title, text: body, color: 'blue', size: 'm' }
  }
  const m = measureSticky(clean, 'm')
  return { kind: 'sticky', w: m.w, h: m.h, size: m.size, text: clean, color: nextColor.get() }
}
