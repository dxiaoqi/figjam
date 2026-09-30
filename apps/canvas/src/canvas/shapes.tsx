import { ChevronDown, ChevronUp, FileWarning, Film, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react'
import { intersects, snapTo, type BlockDraft, type BlockRenderProps, type Editor, type ShapeDef, type Vec } from '@aifig/canvas-engine'
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
  normalizeEmbedUrl,
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
import { assetUrl, blobToDataUrl, capturePoster, uploadAsset } from '../lib/assets'
import { callCore } from '../lib/core'
import { RichEditor, RichText } from './rich-editor'
import { WebBlock as WebBlockLazy } from './web-block'
import { t } from '../i18n'
import { applyPrefix, filterDimClass, TypeFooter, TypeHeader, useTypeFilter } from './types-ui'

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
      {t(expanded ? 'block.showMore' : 'block.showLess')}
      {expanded ? <ChevronDown className="size-3" strokeWidth={2.25} /> : <ChevronUp className="size-3" strokeWidth={2.25} />}
    </button>
  )
  return collapsed ? <div className="aifig-fade">{btn(true)}</div> : <div className="aifig-less">{btn(false)}</div>
}

// ---- renderers ----------------------------------------------------------------

/** Typed-block state shared by stickies and cards: filter dimming, prefix auto-typing when editing ends. */
function useTypeState(block: Block, editing: boolean, editor: Editor) {
  const filter = useTypeFilter()
  const wasEditing = useRef(editing)
  useEffect(() => {
    if (wasEditing.current && !editing) applyPrefix(editor, block.id)
    wasEditing.current = editing
  }, [editing, editor, block.id])
  const done = block.type === 'todo' && !!block.typeData?.todo?.done
  return cn(block.type && `is-typed type-${block.type}`, done && 'is-done', filterDimClass(block, filter))
}

function Sticky({ block, editing, editor }: BlockRenderProps) {
  const fs = stickyFontSize(block.text, block.w)
  const innerRef = useRef<HTMLDivElement>(null)
  useContentFit(block, editing, editor, innerRef)
  const typeCls = useTypeState(block, editing, editor)
  const slashOpen = useRef(false)
  const onChange = (text: string) => {
    editor.updateBlock(block.id, { text })
    const slash = !block.type && /^\/[a-z]*$/i.test(text.trim())
    if (slash) window.dispatchEvent(new CustomEvent('aifig:type-palette', { detail: { ids: [block.id], query: text.trim().slice(1), slash: true } }))
    else if (slashOpen.current) window.dispatchEvent(new Event('aifig:type-palette-close'))
    slashOpen.current = slash
  }
  return (
    <div className={cn('aifig-sticky', editing && 'is-editing', typeCls)} style={{ fontSize: fs }} data-scroll={editing || undefined}>
      <div ref={innerRef} className="aifig-sticky-inner">
        <TypeHeader block={block} />
        {editing ? (
          <RichEditor engine={editor} value={block.text} placeholder={t(block.type ? 'block.writeTyped' : 'block.writeIdea')} onChange={onChange} onTab={() => continueSticky(editor, block)} />
        ) : (
          <RichText value={block.text} placeholder={t('block.dblclickWrite')} />
        )}
        <TypeFooter block={block} editor={editor} />
      </div>
      <MoreToggle block={block} editing={editing} />
    </div>
  )
}

function Card({ block, editing, editor }: BlockRenderProps) {
  const titleRef = useFocusOnMount<HTMLInputElement>(editing)
  const innerRef = useRef<HTMLDivElement>(null)
  useContentFit(block, editing, editor, innerRef, 2)
  const typeCls = useTypeState(block, editing, editor)
  return (
    <div className={cn('aifig-card', editing && 'is-editing', typeCls)} data-scroll={editing || undefined}>
      <div ref={innerRef} className="aifig-card-inner">
        <TypeHeader block={block} />
        {editing ? (
          <>
            <input
              ref={titleRef}
              className="title"
              value={block.title ?? ''}
              placeholder={t('block.title')}
              onChange={(e) => editor.updateBlock(block.id, { title: e.target.value })}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                  e.preventDefault()
                  e.currentTarget.closest('.ae-block')?.querySelector('.aifig-rich-host')?.dispatchEvent(new Event('aifig-focus-end'))
                }
              }}
            />
            <RichEditor engine={editor} className="body" autoFocus={false} value={block.text} placeholder={t('block.details')} onChange={(text) => editor.updateBlock(block.id, { text })} />
          </>
        ) : (
          <>
            <div className={`title ${block.title ? '' : 'aifig-placeholder'}`}>{block.title || t('block.untitledCard')}</div>
            {block.text && <RichText className="body" value={block.text} />}
          </>
        )}
        <TypeFooter block={block} editor={editor} />
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
  // Column titles and axis labels are plain text. They are not filter matches, so they dim with everything else that isn't.
  const dim = filterDimClass(block, useTypeFilter())
  return (
    <div className={cn('aifig-text', dim)} style={style} ref={ref}>
      {editing ? (
        <RichEditor
          engine={editor}
          value={block.text}
          placeholder={t('block.heading')}
          onChange={(text) => {
            const m = measureText(text, size)
            const w = Math.max(m.w, block.w)
            editor.updateBlock(block.id, { text, w })
          }}
        />
      ) : (
        <RichText value={block.text} placeholder={t('block.heading')} />
      )}
    </div>
  )
}

function Frame() {
  return <div className="aifig-frame" />
}

// ---- images and videos ----------------------------------------------------------

function useAsset(editor: Editor, id: string | undefined): Asset | undefined {
  const assets = editor.doc.getMap<Asset>('assets')
  const [, bump] = useState(0)
  const a = id ? assets.get(id) : undefined
  useEffect(() => {
    if (!id || a) return
    const check = () => assets.get(id) && bump((n) => n + 1)
    assets.observe(check)
    return () => assets.unobserve(check)
  }, [assets, id, a])
  return a?.hash ? a : undefined
}

/** URL of an asset file served by the core (null until the board has the entry). */
export function useAssetUrl(editor: Editor, id: string | undefined) {
  const { boardId } = useBoard()
  const a = useAsset(editor, id)
  return a ? assetUrl(boardId, a) : null
}

function MissingFile({ label }: { label: string }) {
  return (
    <div className="aifig-image-loading aifig-missing" data-missing-asset>
      <FileWarning className="size-4 opacity-60" strokeWidth={1.75} />
      <span>{label}</span>
    </div>
  )
}

function ImageBlock({ block, editor }: BlockRenderProps) {
  const url = useAssetUrl(editor, block.asset)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = !!url && failedUrl === url
  return (
    <div className="aifig-image">
      {url && !failed ? (
        <img src={url} alt={block.text || t('block.image')} draggable={false} onError={() => setFailedUrl(url)} />
      ) : failed ? (
        <MissingFile label={t('storage.missingFile')} />
      ) : (
        <div className="aifig-image-loading">{t('block.loadingImage')}</div>
      )}
    </div>
  )
}

// one poster capture at a time
let posterBusy = false

function VideoBlock({ block, editor }: BlockRenderProps) {
  const { boardId } = useBoard()
  const video = useAsset(editor, block.asset)
  const posterUrl = useAssetUrl(editor, block.poster)
  const url = video ? assetUrl(boardId, video) : null
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const el = useRef<HTMLVideoElement>(null)
  const root = useRef<HTMLDivElement>(null)

  // pause when the video scrolls out of view
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const r = editor.visualRect(block.id)
      if (r && !intersects(r, editor.viewportPageBounds())) el.current?.pause()
    }, 600)
    return () => clearInterval(timer)
  }, [playing, editor, block.id])

  // an agent added it without a poster: grab a frame once it is on screen
  useEffect(() => {
    if (block.poster || !url || failed) return
    let cancelled = false
    const tryCapture = async () => {
      const r = editor.visualRect(block.id)
      if (posterBusy || !r || !intersects(r, editor.viewportPageBounds())) return
      posterBusy = true
      try {
        const p = await capturePoster(url)
        if (!cancelled) await callCore('report_video_poster', { board: boardId, id: block.id, png: await blobToDataUrl(p.blob), w: p.w, h: p.h, duration: p.duration })
      } catch {
        // keep the dark placeholder
      } finally {
        posterBusy = false
      }
    }
    const poll = setInterval(tryCapture, 900)
    tryCapture()
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [block.poster, url, failed, boardId, block.id, editor])

  const label = block.text || video?.name || t('block.video')
  return (
    <div ref={root} className={cn('aifig-video', playing && 'is-playing')} data-video-block>
      {playing && url ? (
        <video
          ref={el}
          data-ui
          src={url}
          poster={posterUrl ?? undefined}
          controls
          autoPlay
          playsInline
          onError={() => {
            setFailed(true)
            setPlaying(false)
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          {posterUrl ? <img className="aifig-video-poster" src={posterUrl} alt="" draggable={false} /> : <div className="aifig-video-poster aifig-video-blank" />}
          {failed || (!video && block.asset) ? (
            <MissingFile label={t('storage.missingFile')} />
          ) : (
            <button
              type="button"
              data-ui
              data-video-play
              className="aifig-video-play"
              aria-label={t('video.play', { name: label })}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => url && setPlaying(true)}
            >
              <Play className="size-5" fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </>
      )}
      <div className="aifig-video-badge">
        <Film className="size-3" />
        <span className="truncate">{label}</span>
        {video?.duration ? <span className="tabular-nums opacity-70">{formatDuration(video.duration)}</span> : null}
      </div>
      {playing && (
        <button type="button" data-ui className="aifig-video-close" aria-label={t('video.stop')} onPointerDown={(e) => e.stopPropagation()} onClick={() => setPlaying(false)}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

const MAX_SIDE = 2048

/** Import image files into the board: downscale large ones, upload them to the board's assets folder, place blocks. */
export async function importImages(editor: Editor, boardId: string, files: File[], at: Vec) {
  const placed: string[] = []
  let x = at.x
  for (const file of files) {
    let blob: Blob = file
    const bmp = await createImageBitmap(file)
    let w = bmp.width
    let h = bmp.height
    if (file.type !== 'image/gif' && (w > MAX_SIDE || h > MAX_SIDE || file.size > 1_500_000)) {
      const k = Math.min(1, MAX_SIDE / Math.max(w, h))
      w = Math.round(w * k)
      h = Math.round(h * k)
      const canvas = new OffscreenCanvas(w, h)
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
      blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
    }
    bmp.close()
    const asset = await uploadAsset(boardId, blob, 'image', file.name)
    const dw = snapTo(Math.min(480, w), 8)
    const dh = Math.round((dw * h) / w)
    const id = editor.placeDraft({ kind: 'image', w: dw, h: dh, asset: asset.id, text: '', color: 'gray', size: 'm' }, { x: x + dw / 2, y: at.y })
    placed.push(id)
    x += dw + SPACING.gap
  }
  if (placed.length) editor.select(placed)
  return placed
}

/** Import MP4 / WebM files: upload with progress, capture a poster frame, place video blocks. */
export async function importVideos(editor: Editor, boardId: string, files: File[], at: Vec) {
  const placed: string[] = []
  let x = at.x
  for (const file of files) {
    const local = URL.createObjectURL(file)
    const toastId = toast.loading(t('video.uploading', { name: file.name, pct: 0 }))
    try {
      const posterP = capturePoster(local).catch(() => null)
      const asset = await uploadAsset(boardId, file, 'video', file.name, (p) => toast.loading(t('video.uploading', { name: file.name, pct: Math.round(p * 100) }), { id: toastId }))
      const shot = await posterP
      const poster = shot ? await uploadAsset(boardId, shot.blob, 'poster', `${file.name.replace(/\.\w+$/, '')}-poster.webp`).catch(() => null) : null
      const vw = asset.w ?? shot?.w ?? 16
      const vh = asset.h ?? shot?.h ?? 9
      const dw = snapTo(Math.min(640, Math.max(240, vw)), 8)
      const dh = snapTo((dw * vh) / vw, 8)
      const id = editor.placeDraft({ kind: 'video', w: dw, h: dh, asset: asset.id, ...(poster ? { poster: poster.id } : {}), text: '', color: 'gray', size: 'm' }, { x: x + dw / 2, y: at.y })
      placed.push(id)
      x += dw + SPACING.gap
      toast.success(t('video.added', { name: file.name }), { id: toastId })
    } catch (e) {
      toast.error(t('video.error', { name: file.name }), { id: toastId, description: (e as Error).message })
    } finally {
      URL.revokeObjectURL(local)
    }
  }
  if (placed.length) editor.select(placed)
  return placed
}

/** Dropped / pasted files: images and videos (other files are ignored). */
export async function importFiles(editor: Editor, boardId: string, files: File[], at: Vec) {
  const images = files.filter((f) => f.type.startsWith('image/'))
  const videos = files.filter((f) => f.type === 'video/mp4' || f.type === 'video/webm' || /\.(mp4|webm|m4v)$/i.test(f.name))
  const placed = [...(images.length ? await importImages(editor, boardId, images, at) : [])]
  if (videos.length) placed.push(...(await importVideos(editor, boardId, videos, { x: at.x, y: at.y + (placed.length ? 360 : 0) })))
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
  { kind: 'video', resize: 'xy', canEdit: false, rotatable: false, lockAspect: true, radius: 8, minW: 160, minH: 90, render: VideoBlock },
  { kind: 'web', resize: 'xy', canEdit: true, rotatable: false, radius: 8, minW: 160, minH: 120, render: (p) => <WebBlockLazy {...p} /> },
]

export function draftForTool(tool: string): BlockDraft | null {
  const c = nextColor.get()
  if (tool === 'sticky') return { kind: 'sticky', w: STICKY_SIZES.m, h: STICKY_SIZES.m, size: 'm', color: c, text: '' }
  if (tool === 'card') return { kind: 'card', w: 280, h: 96, size: 'm', color: c === 'yellow' ? 'blue' : c, title: '', text: '' }
  if (tool === 'text') return { kind: 'text', w: 160, h: 40, size: 'l', color: 'gray', text: '' }
  return null
}

/**
 * Empty sibling created when a connector is dropped on empty canvas.
 * Stickies, cards and headings (text) match the source kind, size, color and type.
 * Frames / images / videos / snippets fall back to a sticky — they need an asset
 * or a container role, and dropping from a video should not invent another video.
 */
export function draftForConnectorDrop(from: Block): BlockDraft {
  if (from.kind === 'sticky') {
    const side = STICKY_SIZES[from.size] ?? STICKY_SIZES.m
    return { kind: 'sticky', w: side, h: side, size: from.size, color: from.color, text: '', ...(from.type ? { type: from.type } : {}) }
  }
  if (from.kind === 'card') {
    const m = measureCard('', '', from.size)
    return { kind: 'card', w: m.w, h: m.h, size: from.size, color: from.color, title: '', text: '', ...(from.type ? { type: from.type } : {}) }
  }
  if (from.kind === 'text') {
    const m = measureText('', from.size)
    return { kind: 'text', w: m.w, h: m.h, size: from.size, color: from.color, text: '' }
  }
  return draftForTool('sticky')!
}

export function draftForPastedText(text: string): BlockDraft {
  const clean = text.trim()
  if (/^https:\/\/\S+$/.test(clean)) {
    const n = normalizeEmbedUrl(clean)
    if (!('error' in n) && n.provider !== new URL(clean).hostname.replace(/^www\./, '')) {
      const video = /YouTube|Vimeo|Loom/.test(n.provider)
      return { kind: 'web', w: 480, h: video ? 272 : 320, color: 'gray', size: 'm', text: n.title, web: { mode: 'url', url: clean, embedUrl: n.embedUrl, provider: n.provider, posterUrl: n.thumbUrl, title: n.title } }
    }
  }
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
