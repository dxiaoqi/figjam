/**
 * Web snippet blocks: an embedded URL or an inline HTML/CSS/JS snippet, shown as a static preview and run
 * only in interactive mode, inside a sandboxed frame on a separate origin.
 */

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

/**
 * Port of the snippet host. Served as `localhost` while the app uses `127.0.0.1`, so snippets are a
 * different *site* (own process under site isolation), not just a different origin.
 */
export const SNIPPET_PORT = Number(env.AIFIG_SNIPPET_PORT ?? (env.AIFIG_CORE_PORT ? Number(env.AIFIG_CORE_PORT) + 1 : 47822))
export const SNIPPET_HOST = 'localhost'
export const snippetOrigin = (port = SNIPPET_PORT) => `http://${SNIPPET_HOST}:${port}`

export const SNIPPET_LIMITS = {
  /** html + css + js */
  sourceBytes: 256 * 1024,
  /** the snippet's own state blob */
  stateBytes: 16 * 1024,
  thumbBytes: 1_500_000,
  /** no heartbeat for this long while running → the snippet is stopped */
  heartbeatMs: 3000,
  /** no input for this long while running → back to the preview */
  idleMs: 90_000,
  heapBytes: 256 * 1024 * 1024,
  domNodes: 50_000,
}

export interface WebSnippet {
  mode: 'url' | 'inline'
  /** mode url: what the user/agent gave; `embedUrl` is what the frame loads. */
  url?: string
  embedUrl?: string
  provider?: string
  /**
   * Inline source as stored: asset ids of the HTML / CSS / JS files in the board's assets folder. `html` /
   * `css` / `js` are the resolved text in API input and output (and in schema 1.x documents).
   */
  src?: { html?: string; css?: string; js?: string }
  html?: string
  css?: string
  js?: string
  title?: string
  /** The snippet's own small state blob, read/written only through the bridge. */
  state?: unknown
  /** Preview image (asset id) and the source hash it was captured for. */
  thumb?: string
  thumbFor?: string
  /** Provider poster image (e.g. a YouTube thumbnail) used until/unless a capture exists. */
  posterUrl?: string
  /** Granted capabilities (always empty in v1; see SNIPPET_PERMISSIONS). */
  grants?: SnippetPermission[]
}

/**
 * Permission hook. v1 grants nothing beyond the snippet's own state; v2 can let the user grant these per
 * block (stored in `grants`) and the host widens the CSP / bridge accordingly.
 */
export const SNIPPET_PERMISSIONS = {
  network: { label: 'Network access', v1: 'denied', note: 'Inline snippets have no network by default (CSP connect-src none).' },
  neighbors: { label: 'Read connected blocks', v1: 'denied', note: 'Reading or writing other blocks is deferred to v2.' },
} as const
export type SnippetPermission = keyof typeof SNIPPET_PERMISSIONS

export function checkSnippetPermission(web: Pick<WebSnippet, 'grants'>, p: string): 'granted' | 'denied' {
  if (!(p in SNIPPET_PERMISSIONS)) return 'denied'
  return web.grants?.includes(p as SnippetPermission) ? 'granted' : 'denied'
}

/** Content-Security-Policy for an inline snippet document. Nothing leaves the frame unless granted (v2). */
export function snippetCsp(web: Pick<WebSnippet, 'grants'> = {}) {
  const network = checkSnippetPermission(web, 'network') === 'granted'
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    `connect-src ${network ? 'https:' : "'none'"}`,
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors http://127.0.0.1:* http://localhost:* file: app:",
    'sandbox allow-scripts',
  ].join('; ')
}

/** Sandbox tokens for URL embeds: they run as their own origin and may open links in a new window, but can never navigate the app. */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups allow-popups-to-escape-sandbox'
export const INLINE_SANDBOX = 'allow-scripts'
export const EMBED_ALLOW = 'fullscreen; picture-in-picture; encrypted-media'

/** Normalize share links to their embeddable form (YouTube, Vimeo, Figma, CodePen, Loom, Google Docs/Slides). */
export function normalizeEmbedUrl(input: string): { embedUrl: string; provider: string; thumbUrl?: string; title: string } | { error: string } {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return { error: 'Not a valid URL' }
  }
  if (u.protocol !== 'https:') return { error: 'Only https:// URLs can be embedded' }
  const host = u.hostname.replace(/^www\./, '')
  const yt = host === 'youtu.be' ? u.pathname.slice(1) : host.endsWith('youtube.com') ? (u.searchParams.get('v') ?? u.pathname.match(/\/(?:embed|shorts)\/([\w-]+)/)?.[1]) : null
  if (yt && /^[\w-]{6,}$/.test(yt)) return { embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`, provider: 'YouTube', thumbUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, title: 'YouTube video' }
  if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return { embedUrl: `https://player.vimeo.com/video${u.pathname.match(/^\/\d+/)![0]}`, provider: 'Vimeo', title: 'Vimeo video' }
  if (host === 'figma.com' || host.endsWith('.figma.com')) {
    if (u.pathname.startsWith('/embed')) return { embedUrl: u.toString(), provider: 'Figma', title: 'Figma' }
    return { embedUrl: `https://www.figma.com/embed?embed_host=aifig&url=${encodeURIComponent(u.toString())}`, provider: 'Figma', title: /\/proto\//.test(u.pathname) ? 'Figma prototype' : 'Figma file' }
  }
  if (host === 'codepen.io') {
    const m = u.pathname.match(/^\/([\w-]+)\/(?:pen|full|details|embed)\/(\w+)/)
    if (m) return { embedUrl: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, provider: 'CodePen', title: 'CodePen' }
  }
  if (host === 'loom.com' && u.pathname.startsWith('/share/')) return { embedUrl: `https://www.loom.com/embed/${u.pathname.slice(7)}`, provider: 'Loom', title: 'Loom video' }
  if (host === 'docs.google.com' && /\/(presentation|document|spreadsheets)\//.test(u.pathname)) return { embedUrl: u.toString().replace(/\/(edit|view)(\?.*)?$/, '/preview'), provider: 'Google Docs', title: 'Google doc' }
  return { embedUrl: u.toString(), provider: host, title: host }
}

/** Stable hash of what a snippet runs, so a thumbnail is re-captured only when the source changes. */
export function snippetHash(web: Pick<WebSnippet, 'mode' | 'embedUrl' | 'html' | 'css' | 'js' | 'src'>) {
  const s =
    web.mode === 'url'
      ? `u:${web.embedUrl}`
      : web.src
        ? `s:${web.src.html ?? ''}\u0000${web.src.css ?? ''}\u0000${web.src.js ?? ''}`
        : `i:${web.html ?? ''}\u0000${web.css ?? ''}\u0000${web.js ?? ''}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function snippetSourceBytes(web: Pick<WebSnippet, 'html' | 'css' | 'js'>) {
  return new TextEncoder().encode(`${web.html ?? ''}${web.css ?? ''}${web.js ?? ''}`).byteLength
}

export function snippetLabel(web?: WebSnippet) {
  if (!web) return 'Web snippet'
  return web.title || (web.mode === 'url' ? (web.provider ?? 'Embed') : 'HTML snippet')
}

/** What a preview was captured for: the source, plus the saved state for inline snippets (it changes what they show). */
export function snippetThumbKey(web: Pick<WebSnippet, 'mode' | 'embedUrl' | 'html' | 'css' | 'js' | 'src' | 'state'>) {
  const base = snippetHash(web)
  if (web.mode !== 'inline' || web.state === undefined) return base
  return `${base}.${snippetHash({ mode: 'inline', js: JSON.stringify(web.state) })}`
}
