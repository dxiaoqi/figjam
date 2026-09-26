import { t } from '../i18n'
import { Code2, ExternalLink, Globe, Play, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { intersects, type BlockRenderProps, type Editor } from '@aifig/canvas-engine'
import {
  checkSnippetPermission,
  EMBED_ALLOW,
  EMBED_SANDBOX,
  INLINE_SANDBOX,
  SNIPPET_LIMITS,
  snippetHash,
  snippetLabel,
  snippetOrigin,
  snippetThumbKey,
  type Block,
  type WebSnippet,
} from '@aifig/shared'
import { cn } from '@/lib/utils'
import { useBoard } from '../board-context'
import { callCore } from '../lib/core'
import { useAssetUrl } from './shapes'

/** Snippet state writes are the snippet's own; they don't go on the person's undo stack. */
const SNIPPET_ORIGIN = { snippet: true }

// one preview capture at a time, board-wide
let captureBusy = false
function acquireCapture(): boolean {
  if (captureBusy) return false
  captureBusy = true
  return true
}
function releaseCapture() {
  captureBusy = false
}

type BridgeMsg = { aifig: 1; type: string; id?: number; data?: unknown; mem?: number; nodes?: number; message?: string; error?: string }

function reply(frame: HTMLIFrameElement | null, id: number | undefined, data?: unknown, error?: string) {
  frame?.contentWindow?.postMessage({ aifig: 1, type: 'reply', id, data, error }, '*')
}

/** The narrow bridge: the snippet's own state blob, permission checks (all denied in v1), heartbeat, exit, preview. */
function useBridge(
  frame: React.RefObject<HTMLIFrameElement | null>,
  opts: { block: Block; editor: Editor; readOnly?: boolean; onHeartbeat?: (m: BridgeMsg) => void; onActivity?: () => void; onExit?: () => void; onThumb?: (png: string) => void; onReady?: () => void },
) {
  const ref = useRef(opts)
  ref.current = opts
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const f = frame.current
      if (!f || e.source !== f.contentWindow) return
      const m = e.data as BridgeMsg
      if (!m || m.aifig !== 1 || typeof m.type !== 'string') return
      const { editor, block } = ref.current
      const cur = editor.block(block.id)
      const web = cur?.web
      switch (m.type) {
        case 'ready':
          return ref.current.onReady?.()
        case 'heartbeat':
          return ref.current.onHeartbeat?.(m)
        case 'activity':
          return ref.current.onActivity?.()
        case 'exit':
          return ref.current.onExit?.()
        case 'thumbnail':
          if (typeof m.data === 'string') ref.current.onThumb?.(m.data)
          return
        case 'state:get':
          return reply(f, m.id, web?.state ?? null)
        case 'state:set': {
          if (!cur || !web) return reply(f, m.id, undefined, 'Snippet not found')
          let json: string
          try {
            json = JSON.stringify(m.data ?? null)
          } catch {
            return reply(f, m.id, undefined, 'State must be JSON')
          }
          if (new TextEncoder().encode(json).byteLength > SNIPPET_LIMITS.stateBytes) return reply(f, m.id, undefined, `State is limited to ${SNIPPET_LIMITS.stateBytes / 1024} KB`)
          // preview captures run the snippet read-only: same answers, no side effects
          if (ref.current.readOnly) return reply(f, m.id, true)
          editor.doc.transact(() => editor.blocksMap.set(cur.id, { ...cur, web: { ...web, state: JSON.parse(json) } }), SNIPPET_ORIGIN)
          return reply(f, m.id, true)
        }
        case 'permission':
          return reply(f, m.id, { permission: String(m.data), status: web ? checkSnippetPermission(web, String(m.data)) : 'denied' })
        default:
          return reply(f, m.id, undefined, `Unknown request "${m.type}"`)
      }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [frame])
}

function Poster({ web, thumbUrl }: { web: WebSnippet; thumbUrl: string | null }) {
  const img = thumbUrl ?? (web.mode === 'url' ? web.posterUrl : undefined)
  if (img) return <img className="aifig-web-thumb" src={img} alt="" draggable={false} referrerPolicy="no-referrer" />
  const Icon = web.mode === 'url' ? Globe : Code2
  return (
    <div className="aifig-web-poster">
      <Icon className="size-6 opacity-60" strokeWidth={1.5} />
      <div className="aifig-web-title">{snippetLabel(web)}</div>
      <div className="aifig-web-sub">{web.mode === 'url' ? web.url : 'HTML · CSS · JS'}</div>
    </div>
  )
}

export function WebBlock({ block, editing, editor }: BlockRenderProps) {
  const { boardId, health } = useBoard()
  const web = block.web
  const origin = health?.snippetOrigin ?? snippetOrigin()
  const hash = web ? snippetHash(web) : ''
  const thumbKey = web ? snippetThumbKey(web) : ''
  const [lastThumb, setLastThumb] = useState<string | undefined>()
  const fresh = web?.thumb && web.thumbFor === thumbKey ? web.thumb : undefined
  useEffect(() => {
    if (fresh) setLastThumb(fresh)
  }, [fresh])
  const thumbUrl = useAssetUrl(editor, fresh ?? (web?.thumbFor?.startsWith(hash) ? (web.thumb ?? lastThumb) : undefined))
  const [stopped, setStopped] = useState<string | null>(null)
  const [captureSlot, setCaptureSlot] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const capture = useRef<HTMLIFrameElement>(null)
  const beat = useRef({ at: 0, ready: false, activity: 0, startedAt: 0 })
  const lastState = useRef<string>('')

  const running = editing && !!web
  const src = web?.mode === 'url' ? web.embedUrl : `${origin}/inline/${boardId}/${block.id}?v=${hash}`

  const stop = (reason: string) => {
    setStopped(reason)
    if (editor.editingId === block.id) editor.stopEditing()
    toast.warning(t('snippet.stopped'), { description: reason })
  }

  // running: watchdog (heartbeat, memory), idle and offscreen → back to the preview
  useEffect(() => {
    if (!running || !web) return
    setStopped(null)
    beat.current = { at: 0, ready: false, activity: Date.now(), startedAt: Date.now() }
    const timer = setInterval(() => {
      const now = Date.now()
      const r = editor.visualRect(block.id)
      if (!r || !intersects(r, editor.viewportPageBounds())) return editor.stopEditing()
      if (web.mode === 'inline') {
        const since = beat.current.at || beat.current.startedAt
        if (now - since > SNIPPET_LIMITS.heartbeatMs + (beat.current.ready ? 0 : 4000)) return stop(t('snippet.stopHang'))
      } else if (document.activeElement === frame.current) beat.current.activity = now
      if (now - beat.current.activity > SNIPPET_LIMITS.idleMs) editor.stopEditing()
    }, 500)
    return () => clearInterval(timer)
  }, [running, web?.mode, block.id, editor])

  useBridge(frame, {
    block,
    editor,
    onReady: () => {
      beat.current.ready = true
      beat.current.at = Date.now()
    },
    onHeartbeat: (m) => {
      beat.current.at = Date.now()
      if ((m.mem ?? 0) > SNIPPET_LIMITS.heapBytes) stop(t('snippet.stopMemory'))
      else if ((m.nodes ?? 0) > SNIPPET_LIMITS.domNodes) stop(t('snippet.stopNodes'))
    },
    onActivity: () => (beat.current.activity = Date.now()),
    onExit: () => editor.stopEditing(),
  })

  // push state changes made elsewhere (another person, an agent) into the running snippet
  useEffect(() => {
    if (!running) return
    const json = JSON.stringify(web?.state ?? null)
    if (json === lastState.current) return
    lastState.current = json
    frame.current?.contentWindow?.postMessage({ aifig: 1, type: 'state', data: web?.state ?? null }, '*')
  }, [running, web?.state])

  // preview capture: run the snippet briefly (sandboxed, offscreen) and let it snapshot itself
  const needCapture = !!web && web.mode === 'inline' && web.thumbFor !== thumbKey && !running && !stopped
  useEffect(() => {
    if (!needCapture) return
    let held = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tryAcquire = () => {
      const r = editor.visualRect(block.id)
      if (!r || !intersects(r, editor.viewportPageBounds())) return
      if (acquireCapture()) {
        held = true
        setCaptureSlot(true)
        timer = setTimeout(() => {
          setCaptureSlot(false)
          if (held) releaseCapture()
          held = false
        }, 6000)
      }
    }
    tryAcquire()
    const poll = setInterval(() => !held && tryAcquire(), 700)
    return () => {
      clearInterval(poll)
      clearTimeout(timer)
      if (held) releaseCapture()
      setCaptureSlot(false)
    }
  }, [needCapture, thumbKey, block.id, editor])

  useBridge(capture, {
    block,
    editor,
    readOnly: true,
    onThumb: async (png) => {
      setCaptureSlot(false)
      releaseCapture()
      if (!png.startsWith('data:image/png;base64,') || png.length > SNIPPET_LIMITS.thumbBytes * 1.4) return
      try {
        await callCore('report_snippet_thumb', { board: boardId, id: block.id, hash: thumbKey, png })
      } catch {
        // stale or too big: keep the poster
      }
    },
  })

  if (!web) return <div className="aifig-web" />
  return (
    <div className={cn('aifig-web', running && 'is-running')} data-web-mode={web.mode}>
      {!running && <Poster web={web} thumbUrl={thumbUrl} />}
      {running && (
        <iframe
          ref={frame}
          key={hash}
          src={src}
          title={snippetLabel(web)}
          sandbox={web.mode === 'url' ? EMBED_SANDBOX : INLINE_SANDBOX}
          allow={web.mode === 'url' ? EMBED_ALLOW : ''}
          referrerPolicy="no-referrer"
          className="aifig-web-frame"
          data-web-frame
          {...({ credentialless: true } as Record<string, boolean>)}
        />
      )}
      {captureSlot && needCapture && (
        <iframe
          ref={capture}
          src={`${src}&capture=1`}
          title="preview"
          sandbox={INLINE_SANDBOX}
          referrerPolicy="no-referrer"
          aria-hidden
          tabIndex={-1}
          className="aifig-web-capture"
          data-web-capture
          {...({ credentialless: true } as Record<string, boolean>)}
        />
      )}
      <div className="aifig-web-badge">
        {web.mode === 'url' ? <Play className="size-3" fill="currentColor" /> : <Code2 className="size-3" />}
        <span className="truncate">{running ? t('snippet.escStop', { label: snippetLabel(web) }) : snippetLabel(web)}</span>
      </div>
      {web.mode === 'url' && web.url && (
        <a
          data-ui
          data-watch-link
          className={cn('aifig-web-watch', running && 'is-running')}
          href={web.url}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          title={t('snippet.open', { url: web.url })}
        >
          {t(running ? 'snippet.notPlaying' : 'snippet.watchOn', { site: web.provider ?? t('snippet.theSite') })}
          <ExternalLink className="size-3" />
        </a>
      )}
      {!running && !stopped && <div className="aifig-web-hint">{t(web.mode === 'url' ? 'snippet.hintOpen' : 'snippet.hintRun')}</div>}
      {stopped && !running && (
        <div className="aifig-web-stopped" data-web-stopped>
          <TriangleAlert className="size-4 shrink-0" />
          <span>{t('snippet.tryAgain', { reason: stopped })}</span>
        </div>
      )}
    </div>
  )
}
