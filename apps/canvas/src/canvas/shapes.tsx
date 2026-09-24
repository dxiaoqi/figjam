import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react'
import { randomId, snapTo, type BlockDraft, type BlockRenderProps, type Editor, type ShapeDef, type Vec } from '@aifig/canvas-engine'
import {
  cardContentHeight,
  fitHeight,
  FONT_SIZES,
  maxBlockHeight,
  RADII,
  SPACING,
  STICKY_SIZES,
  measureCard,
  measureSticky,
  measureText,
  richTextHeight,
  snapUp,
  stickyFontSize,
  type Asset,
  type Block,
  type ColorToken,
  type SizeToken,
} from '@aifig/shared'
import { cn } from '@/lib/utils'
import { useBoard } from '../board-context'
import { reportLayout } from '../lib/layout-report'
import { RichEditor, RichText } from './rich-editor'

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

/** Tab while writing a sticky: start the next one to the right, same color and size. */
function continueSticky(editor: Editor, b: Block) {
  editor.stopEditing()
  const id = editor.createBlock({ kind: 'sticky', parent: b.parent ?? null, x: b.x + b.w + SPACING.gap, y: b.y, w: b.w, h: b.h, color: b.color, size: b.size, text: '' })
  if (b.parent) editor.growFrame(b.parent)
  editor.startEditing(id)
}

export function cardHeight(title: string, body: string, w: number, expanded?: boolean) {
  return fitHeight('card', w, cardContentHeight(title, body, w), expanded)
}

function textHeight(text: string, size: SizeToken, w: number) {
  const bold = size === 'l' || size === 'xl'
  return snapUp(richTextHeight(text || ' ', w - 8, FONT_SIZES[size], bold))
}

// ---- long content ---------------------------------------------------------------

/**
 * Measure what the block really renders and fit its height to it (up to the kind's max, then it collapses).
 * While editing the local editor applies it; otherwise it's reported to the core, which also makes room below.
 */
function useContentFit(block: Block, editing: boolean, editor: Editor, ref: RefObject<HTMLElement | null>, chrome = 0) {
  const { boardId, provider } = useBoard()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let retry: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      const cur = editor.block(block.id)
      if (!cur) return
      if (!editing && editor.interaction.type !== 'idle') {
        retry = setTimeout(measure, 300)
        return
      }
      const contentH = Math.ceil(el.offsetHeight) + chrome
      const h = fitHeight(cur.kind, cur.w, contentH, cur.expanded)
      const stale = cur.contentH == null || Math.abs(contentH - cur.contentH) > 2
      if (h === cur.h && !stale) return
      if (editing) {
        const prev = { y: cur.y, h: cur.h }
        editor.updateBlock(cur.id, { h, contentH })
        if (h > prev.h) editor.makeRoomBelow(cur.id, prev)
      } else if (provider.synced) reportLayout(boardId, { id: cur.id, content_h: contentH })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      clearTimeout(retry)
    }
  }, [editing, block.id, block.w, block.h, block.expanded, block.contentH, editor, boardId, provider, ref, chrome])
}

function isCollapsed(block: Block, editing: boolean) {
  return !editing && block.contentH != null && block.contentH > block.h + 4
}

/** Fade over the last lines + "Show more"; "Show less" once expanded past the max height. */
function MoreToggle({ block, editing }: { block: Block; editing: boolean }) {
  const { boardId } = useBoard()
  const collapsed = isCollapsed(block, editing)
  const canCollapse = !editing && !!block.expanded && (block.contentH ?? 0) > maxBlockHeight(block.kind, block.w) + 4
  if (!collapsed && !canCollapse) return null
  const toggle = (expanded: boolean) => reportLayout(boardId, { id: block.id, expanded }, true)
  const btn = (expanded: boolean) => (
    <button
      data-ui
      data-more-toggle={expanded ? 'more' : 'less'}
      className="aifig-more-btn"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        toggle(expanded)
      }}
    >
      {expanded ? 'Show more' : 'Show less'}
      {expanded ? <ChevronDown className="size-3" strokeWidth={2.25} /> : <ChevronUp className="size-3" strokeWidth={2.25} />}
    </button>
  )
  return collapsed ? <div className="aifig-fade">{btn(true)}</div> : <div className="aifig-less">{btn(false)}</div>
}

// ---- renderers ----------------------------------------------------------------

function Sticky({ block, editing, editor }: BlockRenderProps) {
  const fs = stickyFontSize(block.text, block.w)
  const innerRef = useRef<HTMLDivElement>(null)
  useContentFit(block, editing, editor, innerRef)
  return (
    <div className={cn('aifig-sticky', editing && 'is-editing')} style={{ fontSize: fs }} data-scroll={editing || undefined}>
      <div ref={innerRef} className="aifig-sticky-inner">
        {editing ? (
          <RichEditor engine={editor} value={block.text} placeholder="Write an idea…" onChange={(text) => editor.updateBlock(block.id, { text })} onTab={() => continueSticky(editor, block)} />
        ) : (
          <RichText value={block.text} placeholder="Double-click to write" />
        )}
      </div>
      <MoreToggle block={block} editing={editing} />
    </div>
  )
}

function Card({ block, editing, editor }: BlockRenderProps) {
  const titleRef = useFocusOnMount<HTMLInputElement>(editing)
  const innerRef = useRef<HTMLDivElement>(null)
  useContentFit(block, editing, editor, innerRef, 2)
  return (
    <div className={cn('aifig-card', editing && 'is-editing')} data-scroll={editing || undefined}>
      <div ref={innerRef} className="aifig-card-inner">
        {editing ? (
          <>
            <input
              ref={titleRef}
              className="title"
              value={block.title ?? ''}
              placeholder="Title"
              onChange={(e) => editor.updateBlock(block.id, { title: e.target.value })}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                  e.preventDefault()
                  e.currentTarget.closest('.ae-block')?.querySelector('.aifig-rich-host')?.dispatchEvent(new Event('aifig-focus-end'))
                }
              }}
            />
            <RichEditor engine={editor} className="body" autoFocus={false} value={block.text} placeholder="Details…" onChange={(text) => editor.updateBlock(block.id, { text })} />
          </>
        ) : (
          <>
            <div className={`title ${block.title ? '' : 'aifig-placeholder'}`}>{block.title || 'Untitled card'}</div>
            {block.text && <RichText className="body" value={block.text} />}
          </>
        )}
      </div>
      <MoreToggle block={block} editing={editing} />
    </div>
  )
}

function Text({ block, editing, editor }: BlockRenderProps) {
  const size = block.size
  const bold = size === 'l' || size === 'xl'
  const style: CSSProperties = { fontSize: FONT_SIZES[size], fontWeight: bold ? 650 : 400, letterSpacing: bold ? '-0.01em' : undefined }
  const ref = useRef<HTMLDivElement>(null)
  useContentFit(block, editing, editor, ref)
  return (
    <div className="aifig-text" style={style} ref={ref}>
      {editing ? (
        <RichEditor
          engine={editor}
          value={block.text}
          placeholder="Heading"
          onChange={(text) => {
            const m = measureText(text, size)
            const w = Math.max(m.w, block.w)
            editor.updateBlock(block.id, { text, w })
          }}
        />
      ) : (
        <RichText value={block.text} placeholder="Heading" />
      )}
    </div>
  )
}

function Frame() {
  return <div className="aifig-frame" />
}

// ---- images --------------------------------------------------------------------

const assetUrls = new Map<string, string>()

function assetUrl(editor: Editor, id: string | undefined) {
  if (!id) return null
  const cached = assetUrls.get(id)
  if (cached) return cached
  const a = editor.doc.getMap<Asset>('assets').get(id)
  if (!a) return null
  const url = URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime }))
  assetUrls.set(id, url)
  return url
}

function useAssetUrl(editor: Editor, id: string | undefined) {
  const [url, setUrl] = useState(() => assetUrl(editor, id))
  useEffect(() => {
    if (url) return
    const assets = editor.doc.getMap<Asset>('assets')
    const check = () => {
      const u = assetUrl(editor, id)
      if (u) setUrl(u)
    }
    assets.observe(check)
    check()
    return () => assets.unobserve(check)
  }, [editor, id, url])
  return url
}

function ImageBlock({ block, editor }: BlockRenderProps) {
  const url = useAssetUrl(editor, block.asset)
  return (
    <div className="aifig-image">
      {url ? <img src={url} alt={block.text || 'Image'} draggable={false} /> : <div className="aifig-image-loading">Loading image…</div>}
    </div>
  )
}

const MAX_SIDE = 2048

/** Import image files into the board: downscale large ones, store bytes in the board's asset map, place blocks. */
export async function importImages(editor: Editor, files: File[], at: Vec) {
  const placed: string[] = []
  let x = at.x
  for (const file of files) {
    let bytes = new Uint8Array(await file.arrayBuffer())
    let mime = file.type || 'image/png'
    const bmp = await createImageBitmap(file)
    let w = bmp.width
    let h = bmp.height
    if (mime !== 'image/gif' && (w > MAX_SIDE || h > MAX_SIDE || bytes.byteLength > 1_500_000)) {
      const k = Math.min(1, MAX_SIDE / Math.max(w, h))
      w = Math.round(w * k)
      h = Math.round(h * k)
      const canvas = new OffscreenCanvas(w, h)
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
      bytes = new Uint8Array(await blob.arrayBuffer())
      mime = 'image/webp'
    }
    bmp.close()
    const asset = `a${randomId()}`
    editor.doc.getMap<Asset>('assets').set(asset, { id: asset, mime, w, h, bytes, name: file.name, createdAt: Date.now() })
    const dw = snapTo(Math.min(480, w), 8)
    const dh = Math.round((dw * h) / w)
    const id = editor.placeDraft({ kind: 'image', w: dw, h: dh, asset, text: '', color: 'gray', size: 'm' }, { x: x + dw / 2, y: at.y })
    placed.push(id)
    x += dw + SPACING.gap
  }
  if (placed.length) editor.select(placed)
  return placed
}

export const shapeDefs: ShapeDef[] = [
  { kind: 'sticky', resize: 'none', canEdit: true, rotatable: true, radius: RADII.sticky, render: Sticky, isEmpty: (b) => !b.text.trim() },
  {
    kind: 'card',
    resize: 'x',
    canEdit: true,
    rotatable: true,
    radius: RADII.card,
    minW: 200,
    render: Card,
    fit: (b, w) => ({ w, h: cardHeight(b.title ?? '', b.text, w, b.expanded) }),
    isEmpty: (b) => !b.text.trim() && !(b.title ?? '').trim(),
  },
  { kind: 'text', resize: 'x', canEdit: true, rotatable: true, radius: 4, minW: 48, render: Text, fit: (b, w) => ({ w, h: textHeight(b.text, b.size, w) }), isEmpty: (b) => !b.text.trim() },
  { kind: 'frame', resize: 'xy', canEdit: true, container: true, radius: RADII.frame, minW: 160, minH: 120, render: Frame },
  { kind: 'image', resize: 'xy', canEdit: false, rotatable: true, lockAspect: true, radius: 6, minW: 48, minH: 32, render: ImageBlock },
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
