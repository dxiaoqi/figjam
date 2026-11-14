import { Check, Code2, ExternalLink, Film, Globe, MousePointerClick, Play, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { intersects, type BlockRenderProps, type ShapeDef } from '@nodboard/canvas-engine'
import { EMBED_ALLOW, EMBED_SANDBOX, fieldSummary, FONT_SIZES, INLINE_SANDBOX, RADII, snippetLabel, stickyFontSize, templateRows, typeDef, typeFields, typeText, type Block, type BlockTypeDef, type TypeRegistry, type WebExportData } from '@nodboard/shared'
import { cn } from '@/lib/utils'
import { renderMarkdown } from '../canvas/markdown'
import { typeIcon } from '../canvas/type-registry'
import { getLocale, t, type MessageKey } from '../i18n'
import { en as LABEL_KEYS } from '../i18n/en'

/** The exported board and the viewer's toggles, shared by every block. */
export interface ViewerState {
  data: WebExportData
  fields: boolean
  /** The web snippet the reader is interacting with (others ignore the pointer, so the canvas pans over them). */
  active: string | null
}

let state: ViewerState
const listeners = new Set<() => void>()
export const viewer = {
  init(s: ViewerState) {
    state = s
  },
  get: () => state,
  set(patch: Partial<ViewerState>) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
export const useViewer = () => useSyncExternalStore(viewer.subscribe, viewer.get)

const builtin = (d: BlockTypeDef) => !d.skill
const typeLabel = (d: BlockTypeDef) => (builtin(d) ? t(`type.${d.id}.label` as MessageKey) : typeText(d, getLocale()).label)

function RichText({ value, className }: { value: string; className?: string }) {
  if (!value) return null
  return <div className={cn('nodboard-rich', className)}>{renderMarkdown(value)}</div>
}

function TypeHeader({ block, reg }: { block: Block; reg: TypeRegistry }) {
  if (!block.type) return null
  const def = typeDef(block.type, reg)
  const Icon = typeIcon(block.type, reg)
  return (
    <div className="nodboard-type-header" title={def.skill ? `${typeLabel(def)} · ${def.skill}` : typeLabel(def)}>
      <Icon className="size-3.5" strokeWidth={2.25} />
      {typeLabel(def)}
    </div>
  )
}

const optionLabel = (d: BlockTypeDef, o: string) => (builtin(d) && `option.${o}` in LABEL_KEYS ? t(`option.${o}` as MessageKey) : typeText(d, getLocale()).option(o))
const STATUS_DOT: Record<string, string> = { unverified: 'bg-stone-400', supported: 'bg-emerald-500', refuted: 'bg-red-500' }

/** Typed fields, read-only, laid out like the canvas: status dots, quote sources, todo state, template rows. */
function TypeFields({ block, reg }: { block: Block; reg: TypeRegistry }) {
  const { fields } = useViewer()
  if (!fields || !block.type) return null
  const def = typeDef(block.type, reg)
  if (!def.fields.length) return null
  const f = typeFields(block, reg)
  let body: ReactNode = null
  if (block.type === 'todo') {
    body = (
      <span className="flex items-center gap-1.5">
        <span className={cn('flex size-3.5 items-center justify-center rounded-[4px] border border-current/40', f.done && 'border-transparent bg-current/80')}>{f.done ? <Check className="size-2.5 text-white" strokeWidth={3} /> : null}</span>
        {f.owner ? <span className="truncate">@{String(f.owner)}</span> : null}
      </span>
    )
  } else if (block.type === 'hypothesis') {
    body = (
      <span className="flex items-center gap-1.5">
        <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[String(f.status)] ?? 'bg-stone-400')} />
        <span className="capitalize">{optionLabel(def, String(f.status ?? 'unverified'))}</span>
        {f.confidence ? <span className="opacity-60">· {optionLabel(def, String(f.confidence))}</span> : null}
      </span>
    )
  } else if (block.type === 'quote') {
    const parts = [f.interviewee, f.source].filter(Boolean)
    if (!parts.length) return null
    body = <span className="truncate">— {parts.join(', ')}</span>
  } else {
    const rows = templateRows(block, reg, getLocale()).filter((r) => r.value)
    const sum = fieldSummary(block, reg, getLocale())
    if (!rows.length && !sum) return null
    return (
      <div data-viewer-fields>
        {rows.length > 0 && (
          <div className="nodboard-type-rows">
            {rows.map((r) => (
              <div key={r.key} className="nodboard-type-row">
                <span className="nodboard-type-row-label">{r.label}</span>
                <span className="nodboard-type-row-value">{r.value}</span>
              </div>
            ))}
          </div>
        )}
        {sum && (
          <div className="nodboard-type-footer">
            <span className="truncate">{sum}</span>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="nodboard-type-footer" data-viewer-fields>
      {body}
    </div>
  )
}

const typeCls = (b: Block) => cn(b.type && `is-typed type-${b.type}`, b.type === 'todo' && b.typeData?.todo?.done && 'is-done')

function Sticky({ block }: BlockRenderProps) {
  const { data } = useViewer()
  return (
    <div className={cn('nodboard-sticky', typeCls(block))} style={{ fontSize: stickyFontSize(block.text, block.w) }}>
      <div className="nodboard-sticky-inner">
        <TypeHeader block={block} reg={data.types} />
        <RichText value={block.text} />
        <TypeFields block={block} reg={data.types} />
      </div>
    </div>
  )
}

function Card({ block }: BlockRenderProps) {
  const { data } = useViewer()
  return (
    <div className={cn('nodboard-card', typeCls(block))}>
      <div className="nodboard-card-inner">
        <TypeHeader block={block} reg={data.types} />
        <div className="title">{block.title}</div>
        {block.text && <RichText className="body" value={block.text} />}
        <TypeFields block={block} reg={data.types} />
      </div>
    </div>
  )
}

function Text({ block }: BlockRenderProps) {
  const bold = block.size === 'l' || block.size === 'xl'
  return (
    <div className="nodboard-text" style={{ fontSize: FONT_SIZES[block.size], fontWeight: bold ? 650 : 400, letterSpacing: bold ? '-0.01em' : undefined }}>
      <RichText value={block.text} />
    </div>
  )
}

function Frame() {
  return <div className="nodboard-frame" />
}

function ImageBlock({ block }: BlockRenderProps) {
  const { data } = useViewer()
  const a = block.asset ? data.assets[block.asset] : undefined
  return <div className="nodboard-image">{a ? <img src={a.src} alt={block.text || a.name || ''} draggable={false} loading="lazy" /> : null}</div>
}

function VideoBlock({ block, editor }: BlockRenderProps) {
  const { data } = useViewer()
  const a = block.asset ? data.assets[block.asset] : undefined
  const poster = block.poster ? data.assets[block.poster]?.src : undefined
  const [playing, setPlaying] = useState(false)
  const el = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const r = editor.visualRect(block.id)
      if (r && !intersects(r, editor.viewportPageBounds())) el.current?.pause()
    }, 600)
    return () => clearInterval(timer)
  }, [playing, editor, block.id])
  const label = block.text || a?.name || t('block.video')
  return (
    <div className={cn('nodboard-video', playing && 'is-playing')} data-video-block={block.id}>
      {playing && a ? (
        <video ref={el} data-ui src={a.src} poster={poster} controls autoPlay playsInline />
      ) : (
        <>
          {poster ? <img className="nodboard-video-poster" src={poster} alt="" draggable={false} /> : <div className="nodboard-video-poster nodboard-video-blank" />}
          {a && (
            <button type="button" data-ui data-video-play className="nodboard-video-play" aria-label={t('video.play', { name: label })} onClick={() => setPlaying(true)}>
              <Play className="size-5" fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </>
      )}
      <div className="nodboard-video-badge">
        <Film className="size-3" />
        <span className="truncate">{label}</span>
      </div>
      {playing && (
        <button type="button" data-ui className="nodboard-video-close" aria-label={t('video.stop')} onClick={() => setPlaying(false)}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Web snippets. Inline ones run right away in a sandboxed frame (opaque origin, a CSP with no network inside
 * the document); a click hands them the pointer until you click elsewhere or press Esc, so the canvas still
 * pans over them. URL embeds load their site only when asked.
 */
function WebBlock({ block }: BlockRenderProps) {
  const { data, active } = useViewer()
  const web = block.web
  const [loaded, setLoaded] = useState(false)
  if (!web) return <div className="nodboard-web" />
  const isActive = active === block.id
  const thumb = web.thumb ? data.assets[web.thumb]?.src : undefined
  if (web.mode === 'inline') {
    const doc = data.snippets[block.id]
    return (
      <div className={cn('nodboard-web', isActive && 'is-running')} data-web-mode="inline" data-viewer-snippet={block.id}>
        {doc ? (
          <iframe
            className="nodboard-web-frame"
            title={snippetLabel(web)}
            sandbox={INLINE_SANDBOX}
            referrerPolicy="no-referrer"
            loading="lazy"
            {...(doc.srcdoc !== undefined ? { srcDoc: doc.srcdoc } : { src: doc.src })}
            style={{ pointerEvents: isActive ? 'auto' : 'none' }}
            data-ui={isActive || undefined}
          />
        ) : null}
        {!isActive && (
          <button type="button" data-ui data-wheel-canvas data-snippet-activate className="nodboard-viewer-activate" aria-label={t('viewer.interact', { label: snippetLabel(web) })} onClick={() => viewer.set({ active: block.id })}>
            <span className="nodboard-viewer-activate-hint">
              <MousePointerClick className="size-3" /> {t('viewer.clickToInteract')}
            </span>
          </button>
        )}
        <div className="nodboard-web-badge">
          <Code2 className="size-3" />
          <span className="truncate">{isActive ? t('viewer.escToLeave', { label: snippetLabel(web) }) : snippetLabel(web)}</span>
        </div>
      </div>
    )
  }
  return (
    <div className={cn('nodboard-web', loaded && 'is-running')} data-web-mode="url">
      {loaded ? (
        <iframe className="nodboard-web-frame" title={snippetLabel(web)} src={web.embedUrl} sandbox={EMBED_SANDBOX} allow={EMBED_ALLOW} referrerPolicy="no-referrer" data-ui />
      ) : (
        <>
          {thumb ? (
            <img className="nodboard-web-thumb" src={thumb} alt="" draggable={false} />
          ) : (
            <div className="nodboard-web-poster">
              <Globe className="size-6 opacity-60" strokeWidth={1.5} />
              <div className="nodboard-web-title">{snippetLabel(web)}</div>
              <div className="nodboard-web-sub">{web.url}</div>
            </div>
          )}
          <button type="button" data-ui data-embed-load className="nodboard-video-play" aria-label={t('viewer.loadEmbed', { site: web.provider ?? '' })} onClick={() => setLoaded(true)}>
            <Play className="size-5" fill="currentColor" strokeWidth={0} />
          </button>
        </>
      )}
      <div className="nodboard-web-badge">
        <Play className="size-3" fill="currentColor" />
        <span className="truncate">{snippetLabel(web)}</span>
      </div>
      {web.url && (
        <a data-ui className="nodboard-web-watch" href={web.url} target="_blank" rel="noopener noreferrer">
          {t('snippet.watchOn', { site: web.provider ?? t('snippet.theSite') })}
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}

export const viewerShapes: ShapeDef[] = [
  { kind: 'sticky', resize: 'none', canEdit: false, rotatable: true, radius: RADII.sticky, render: Sticky },
  { kind: 'card', resize: 'x', canEdit: false, rotatable: true, radius: RADII.card, render: Card },
  { kind: 'text', resize: 'x', canEdit: false, rotatable: true, radius: 4, render: Text },
  { kind: 'frame', resize: 'xy', canEdit: false, container: true, radius: RADII.frame, render: Frame },
  { kind: 'image', resize: 'xy', canEdit: false, rotatable: true, radius: 6, render: ImageBlock },
  { kind: 'video', resize: 'xy', canEdit: false, radius: 8, render: VideoBlock },
  { kind: 'web', resize: 'xy', canEdit: false, radius: 8, render: WebBlock },
]

