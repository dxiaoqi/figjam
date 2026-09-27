import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { dashboardHtml } from './dashboard.ts'
import { DownloadPing, EventPing } from './schema.ts'
import { dayOf, type Store } from './store.ts'

export interface AppOptions {
  store: Store
  /** Bearer token for /api/stats and the dashboard; empty → the admin API is off. */
  adminToken?: string
  /** requests per minute per client on the write endpoints */
  rateLimit?: number
  /** the client address, used only in memory for rate limiting (never stored) */
  clientIp?: (c: Context) => string | undefined
  now?: () => number
}

const MAX_BODY = 1024

/** Fixed one-minute windows per client, in memory. Keys are the client address; nothing is persisted. */
function limiter(perMinute: number, now: () => number) {
  const hits = new Map<string, { window: number; n: number }>()
  return (key: string) => {
    const window = Math.floor(now() / 60_000)
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.window !== window) hits.delete(k)
    const h = hits.get(key)
    if (!h || h.window !== window) {
      hits.set(key, { window, n: 1 })
      return true
    }
    h.n++
    return h.n <= perMinute
  }
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export function createApp(o: AppOptions) {
  const now = o.now ?? Date.now
  const allow = limiter(o.rateLimit ?? 30, now)
  const app = new Hono()

  // write endpoints are called from the desktop app and the website (navigator.sendBeacon → text/plain)
  app.use('/v1/*', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['content-type'], maxAge: 86400 }))

  async function readPing(c: Context) {
    const key = o.clientIp?.(c) ?? 'unknown'
    if (!allow(key)) return { error: c.json({ ok: false, error: 'Too many requests' }, 429, { 'retry-after': '60' }) }
    const len = Number(c.req.header('content-length') ?? 0)
    if (len > MAX_BODY) return { error: c.json({ ok: false, error: 'Body too large' }, 413) }
    const raw = await c.req.text()
    if (raw.length > MAX_BODY) return { error: c.json({ ok: false, error: 'Body too large' }, 413) }
    try {
      return { body: JSON.parse(raw) as unknown }
    } catch {
      return { error: c.json({ ok: false, error: 'Body must be JSON' }, 400) }
    }
  }

  app.post('/v1/events', async (c) => {
    const r = await readPing(c)
    if (r.error) return r.error
    const p = EventPing.safeParse(r.body)
    if (!p.success) return c.json({ ok: false, error: 'Invalid ping', issues: p.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }, 400)
    const recorded = await o.store.recordEvent({ ...p.data, day: dayOf(now()) })
    return c.json({ ok: true, recorded })
  })

  app.post('/v1/downloads', async (c) => {
    const r = await readPing(c)
    if (r.error) return r.error
    const p = DownloadPing.safeParse(r.body)
    if (!p.success) return c.json({ ok: false, error: 'Invalid ping', issues: p.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }, 400)
    await o.store.recordDownload({ ...p.data, day: dayOf(now()) })
    return c.json({ ok: true })
  })

  app.get('/api/stats', async (c) => {
    if (!o.adminToken) return c.json({ ok: false, error: 'Admin API is off: set ADMIN_TOKEN' }, 503)
    const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token || !safeEqual(token, o.adminToken)) return c.json({ ok: false, error: 'Unauthorized' }, 401, { 'www-authenticate': 'Bearer' })
    const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? 30) || 30))
    return c.json({ ok: true, ...(await o.store.stats(dayOf(now()), days)) }, 200, { 'cache-control': 'no-store' })
  })

  app.get('/admin', (c) => c.html(dashboardHtml, 200, { 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }))
  app.get('/', (c) => c.redirect('/admin'))
  app.get('/health', (c) => c.json({ ok: true }))
  return app
}
