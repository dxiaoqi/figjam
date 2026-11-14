import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../src/app.ts'
import { sqliteDb } from '../src/sqlite.ts'
import { createStore } from '../src/store.ts'

const ID = '3f1c2a64-8d0e-4b7a-9c21-5e6f7a8b9c0d'
const ping = (over: Record<string, unknown> = {}) => ({ v: 1, event: 'install', installId: ID, appVersion: '0.2.0', os: 'macos', arch: 'arm64', locale: 'en-US', ...over })

async function setup(o: { rateLimit?: number } = {}) {
  const db = sqliteDb(':memory:')
  const store = createStore(db)
  await store.migrate()
  let now = Date.parse('2026-09-26T12:00:00Z')
  let ip = '203.0.113.7'
  const app = createApp({ store, adminToken: 'secret-token', rateLimit: o.rateLimit ?? 1000, clientIp: () => ip, now: () => now })
  const post = (path: string, body: unknown, type = 'application/json') => app.request(path, { method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const stats = (token = 'secret-token', days = 30) => app.request(`/api/stats?days=${days}`, { headers: { authorization: `Bearer ${token}` } })
  return { app, db, post, stats, advance: (ms: number) => (now += ms), setIp: (v: string) => (ip = v) }
}

test('accepts a valid ping and counts the install once', async () => {
  const s = await setup()
  const r = await s.post('/v1/events', ping())
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ok: true, recorded: true })
  assert.deepEqual(await (await s.post('/v1/events', ping())).json(), { ok: true, recorded: false })
  s.advance(86_400_000)
  assert.deepEqual(await (await s.post('/v1/events', ping())).json(), { ok: true, recorded: false }, 'install is once per ID, ever')
  const body = await (await s.stats()).json()
  assert.equal(body.totals.installs, 1)
})

test('rejects unknown fields (no room for PII), bad values and non-JSON', async () => {
  const s = await setup()
  for (const bad of [ping({ hostname: 'my-mac' }), ping({ email: 'a@b.c' }), ping({ installId: 'user@example.com' }), ping({ os: 'Darwin 25.0 (Johns-MacBook)' }), ping({ locale: 'en-US; C:\\Users\\john' }), ping({ v: 2 }), { event: 'install' }]) {
    const r = await s.post('/v1/events', bad)
    assert.equal(r.status, 400, JSON.stringify(bad))
  }
  assert.equal((await s.post('/v1/events', 'not json')).status, 400)
  assert.equal((await s.post('/v1/events', JSON.stringify(ping()) + ' '.repeat(2000))).status, 413)
  const rows = await s.db.all('SELECT COUNT(*) AS n FROM events')
  assert.equal(Number((rows[0] as { n: number }).n), 0)
})

test('stores only the ping fields and a UTC day — no IP, no timestamp', async () => {
  const s = await setup()
  await s.post('/v1/events', ping())
  const cols = (await s.db.all<{ name: string }>('PRAGMA table_info(events)')).map((c) => c.name)
  assert.deepEqual(cols.sort(), ['app_version', 'arch', 'day', 'event', 'install_id', 'locale', 'os'])
  const row = JSON.stringify(await s.db.all('SELECT * FROM events'))
  assert.ok(!row.includes('203.0.113.7'))
  assert.ok(row.includes('"day":"2026-09-26"'))
})

test('sendBeacon-style text/plain bodies work (website downloads)', async () => {
  const s = await setup()
  const r = await s.post('/v1/downloads', { v: 1, platform: 'windows', arch: 'x64', kind: 'exe', version: '0.2.0' }, 'text/plain;charset=UTF-8')
  assert.equal(r.status, 200)
  assert.equal((await s.post('/v1/downloads', { v: 1, platform: 'windows', arch: 'x64', kind: 'exe', version: '0.2.0', referrer: 'x' })).status, 400)
  const body = await (await s.stats()).json()
  assert.equal(body.totals.downloads, 1)
  assert.deepEqual(body.downloadsByPlatform, [{ k: 'windows · exe', n: 1 }])
})

test('CORS preflight is allowed for the write endpoints', async () => {
  const s = await setup()
  const r = await s.app.request('/v1/downloads', { method: 'OPTIONS', headers: { origin: 'https://nodboard.dev', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } })
  assert.ok(r.status === 204 || r.status === 200)
  assert.equal(r.headers.get('access-control-allow-origin'), '*')
})

test('rate limits per client, per minute', async () => {
  const s = await setup({ rateLimit: 3 })
  const codes: number[] = []
  for (let i = 0; i < 5; i++) codes.push((await s.post('/v1/events', ping({ installId: `3f1c2a64-8d0e-4b7a-9c21-5e6f7a8b9c0${i}` }))).status)
  assert.deepEqual(codes, [200, 200, 200, 429, 429])
  s.setIp('198.51.100.2')
  assert.equal((await s.post('/v1/events', ping({ installId: '3f1c2a64-8d0e-4b7a-9c21-5e6f7a8b9caa' }))).status, 200, 'other clients are unaffected')
  s.setIp('203.0.113.7')
  s.advance(61_000)
  assert.equal((await s.post('/v1/events', ping({ installId: '3f1c2a64-8d0e-4b7a-9c21-5e6f7a8b9cbb' }))).status, 200, 'next window')
})

test('stats need the admin token; DAU counts distinct installs per day', async () => {
  const s = await setup()
  assert.equal((await s.stats('wrong')).status, 401)
  assert.equal((await s.app.request('/api/stats')).status, 401)
  await s.post('/v1/events', ping())
  await s.post('/v1/events', ping({ installId: 'a1c2a64f-8d0e-4b7a-9c21-5e6f7a8b9c0d', os: 'windows', arch: 'x64' }))
  s.advance(86_400_000)
  await s.post('/v1/events', ping({ event: 'active' }))
  await s.post('/v1/events', ping({ event: 'active' }))
  const b = await (await s.stats('secret-token', 7)).json()
  assert.equal(b.totals.installs, 2)
  assert.equal(b.totals.dauToday, 1)
  assert.equal(b.totals.active7, 2)
  assert.equal(b.installsByDay.length, 7)
  assert.deepEqual(b.dauByDay.slice(-2).map((d: { n: number }) => d.n), [2, 1])
  assert.deepEqual(b.installsByOs.map((r: { k: string }) => r.k).sort(), ['macos', 'windows'])
})

test('the dashboard page is served and never embeds data', async () => {
  const s = await setup()
  const r = await s.app.request('/admin')
  assert.equal(r.status, 200)
  const html = await r.text()
  assert.ok(html.includes('Admin sign-in'))
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
})

test('admin API is off without a token', async () => {
  const db = sqliteDb(':memory:')
  const store = createStore(db)
  await store.migrate()
  const app = createApp({ store })
  assert.equal((await app.request('/api/stats', { headers: { authorization: 'Bearer ' } })).status, 503)
})
