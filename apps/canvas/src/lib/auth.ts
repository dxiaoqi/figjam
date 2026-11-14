import { WS_PROTOCOL, WS_TOKEN_PREFIX } from '@nodboard/shared'
import { desktop } from './desktop'

/**
 * The core's per-install access token. The desktop shell hands it over through the preload; in a browser it
 * arrives once in the link from `nodboard open` (`#token=…`, a fragment, so it never reaches a server log) and is
 * kept in this origin's localStorage.
 */

const KEY = 'nodboard:token'
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

function captureFromUrl() {
  const m = location.hash.match(/(?:^#|&)token=([^&]+)/)
  if (!m) return
  const t = decodeURIComponent(m[1])
  if (TOKEN_RE.test(t)) localStorage.setItem(KEY, t)
  const rest = location.hash.replace(/(^#|&)token=[^&]+/, '$1').replace(/^#&?$/, '')
  history.replaceState(null, '', `${location.pathname}${location.search}${rest}`)
}
captureFromUrl()

export function getToken(): string | null {
  return desktop?.token ?? localStorage.getItem(KEY)
}

export function setToken(t: string) {
  localStorage.setItem(KEY, t.trim())
}

export const isValidToken = (t: string) => TOKEN_RE.test(t.trim())

export function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export const UNAUTHORIZED = 'nodboard:unauthorized'

/** fetch() for the core's `/api`: adds the token and announces a rejected one so the app can ask for it. */
export async function apiFetch(input: string, init: RequestInit = {}) {
  const r = await fetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), ...authHeaders() } })
  if (r.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED))
  return r
}

/** WebSocket subprotocols carrying the token (browsers can't set headers on a WebSocket). */
export function wsProtocols(): string[] {
  const t = getToken()
  return t ? [WS_PROTOCOL, `${WS_TOKEN_PREFIX}${t}`] : [WS_PROTOCOL]
}
