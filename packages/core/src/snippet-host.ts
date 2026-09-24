import http from 'node:http'
import { SNIPPET_LIMITS, SNIPPET_PORT, snippetCsp, type Block } from '@aifig/shared'
import type { BoardRegistry } from './board'

/**
 * Runs inside every inline snippet, before the snippet's own code. The only channel to the canvas:
 * the snippet's own state blob, a heartbeat for the watchdog, Esc-to-exit, and a self-snapshot for the preview.
 */
const BRIDGE = `(() => {
  const P = window.parent
  if (P === window) return
  const pending = new Map()
  const listeners = []
  let seq = 0
  const send = (m) => P.postMessage(Object.assign({ aifig: 1 }, m), '*')
  const call = (type, data) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    send({ type, id, data })
  })
  window.addEventListener('message', (e) => {
    const m = e.data
    if (e.source !== P || !m || m.aifig !== 1) return
    if (m.type === 'reply') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.data)
    } else if (m.type === 'state') {
      for (const f of listeners) try { f(m.data) } catch (err) { console.error(err) }
    } else if (m.type === 'capture') capture()
  })
  Object.defineProperty(window, 'aifig', {
    value: Object.freeze({
      getState: () => call('state:get'),
      setState: (value) => call('state:set', value),
      onState: (f) => { if (typeof f === 'function') listeners.push(f) },
      requestPermission: (name) => call('permission', String(name)),
    }),
  })
  setInterval(() => send({ type: 'heartbeat', mem: (performance.memory && performance.memory.usedJSHeapSize) || 0, nodes: document.getElementsByTagName('*').length }), 500)
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => send({ type: 'activity' }), { capture: true, passive: true })
  addEventListener('keydown', (e) => { if (e.key === 'Escape') send({ type: 'exit' }) }, true)
  addEventListener('error', (e) => send({ type: 'error', message: String(e.message || e).slice(0, 300) }))
  async function capture() {
    try {
      const w = Math.max(1, innerWidth)
      const h = Math.max(1, innerHeight)
      const clone = document.documentElement.cloneNode(true)
      const live = document.querySelectorAll('canvas')
      clone.querySelectorAll('canvas').forEach((c, i) => {
        try {
          const img = document.createElement('img')
          img.src = live[i].toDataURL()
          img.setAttribute('style', c.getAttribute('style') || '')
          img.width = live[i].clientWidth || live[i].width
          img.height = live[i].clientHeight || live[i].height
          c.replaceWith(img)
        } catch {}
      })
      clone.querySelectorAll('input, textarea').forEach((el, i) => {
        const src = document.querySelectorAll('input, textarea')[i]
        if (src && 'value' in src) el.setAttribute('value', src.value)
      })
      clone.querySelectorAll('script').forEach((s) => s.remove())
      const xml = new XMLSerializer().serializeToString(clone)
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject width="100%" height="100%">' + xml + '</foreignObject></svg>'
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      const k = Math.min(2, window.devicePixelRatio || 1)
      const cv = document.createElement('canvas')
      cv.width = Math.round(w * k)
      cv.height = Math.round(h * k)
      const ctx = cv.getContext('2d')
      ctx.scale(k, k)
      const bg = getComputedStyle(document.body).backgroundColor
      ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : getComputedStyle(document.documentElement).backgroundColor || '#fff'
      if (ctx.fillStyle === 'rgba(0, 0, 0, 0)') ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0)
      send({ type: 'thumbnail', data: cv.toDataURL('image/png') })
    } catch (err) {
      send({ type: 'thumbnail', error: String(err && err.message || err) })
    }
  }
  addEventListener('load', () => {
    send({ type: 'ready' })
    if (new URLSearchParams(location.search).has('capture')) setTimeout(capture, 700)
  })
})()`

const BASE_CSS = `html,body{margin:0;height:100%}body{font:14px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1917;background:#fff;overflow:auto}`

/** Close a raw-text element the snippet may have left open, so the bridge and structure stay intact. */
const safeRaw = (s: string, tag: string) => s.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`)

export function snippetDocument(web: NonNullable<Block['web']>) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><style>${BASE_CSS}</style><style>${safeRaw(web.css ?? '', 'style')}</style><script>${BRIDGE}</script></head><body>${web.html ?? ''}<script>${safeRaw(web.js ?? '', 'script')}</script></body></html>`
}

/**
 * The snippet host: a second server on its own port, reached as `localhost` (a different site from the
 * `127.0.0.1` app). It serves one thing: an inline snippet's own document, under a strict CSP.
 */
export async function startSnippetHost(registry: BoardRegistry, port = SNIPPET_PORT) {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`])
  const handler: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const deny = (code: number, msg: string) => {
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(msg)
    }
    if (req.method !== 'GET') return deny(405, 'Method not allowed')
    if (!allowedHosts.has(req.headers.host ?? '')) return deny(403, 'Bad host')
    const m = url.pathname.match(/^\/inline\/([\w-]+)\/([\w-]+)$/)
    if (!m) return deny(404, 'Not found')
    const board = registry.get(m[1])
    const block = board?.blocks.get(m[2])
    const web = block?.kind === 'web' ? block.web : undefined
    if (!web || web.mode !== 'inline') return deny(404, 'No such snippet')
    const body = snippetDocument(web)
    if (Buffer.byteLength(body) > SNIPPET_LIMITS.sourceBytes + 16 * 1024) return deny(413, 'Snippet too large')
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': snippetCsp(web),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
      'cross-origin-opener-policy': 'same-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=(), clipboard-read=(), display-capture=()',
    })
    res.end(body)
  }
  const servers: http.Server[] = []
  const listen = (host: string) =>
    new Promise<void>((resolve) => {
      const s = http.createServer(handler)
      s.on('error', () => resolve())
      s.listen(port, host, () => {
        servers.push(s)
        resolve()
      })
    })
  await listen('127.0.0.1')
  const ok = servers.length > 0
  if (!ok) console.error(`ai-figma: snippet host port ${port} is busy — web snippets will show previews only`)
  await listen('::1')
  return { port, ok, close: () => servers.forEach((s) => s.close()) }
}
