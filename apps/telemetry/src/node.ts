// Node entry: `npm start -w @nodboard/telemetry` (SQLite file) or `npm run mock -w @nodboard/telemetry` (in-memory,
// seeded with 90 days of fake data, admin token printed on start).
//   PORT (47910)  HOST (127.0.0.1)  DB_FILE (./data/telemetry.sqlite)  ADMIN_TOKEN  RATE_LIMIT (30/min)
//   TRUST_PROXY=1 → rate-limit on X-Forwarded-For (behind a reverse proxy)
import { randomBytes } from 'node:crypto'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createApp } from './app.ts'
import { seedMock } from './mock.ts'
import { sqliteDb } from './sqlite.ts'
import { createStore } from './store.ts'

const mock = process.argv.includes('--mock') || process.env.MOCK === '1'
const port = Number(process.env.PORT ?? 47910)
const host = process.env.HOST ?? '127.0.0.1'
const db = sqliteDb(mock ? ':memory:' : (process.env.DB_FILE ?? 'data/telemetry.sqlite'))
const store = createStore(db)
await store.migrate()
if (mock) console.log(`mock mode: seeded ${seedMock(db.raw).installs} installs over 90 days (in memory)`)

let adminToken = process.env.ADMIN_TOKEN ?? ''
if (!adminToken && mock) adminToken = 'mock-admin-token'
if (!adminToken) console.warn('ADMIN_TOKEN is not set: the dashboard and /api/stats are off')

const app = createApp({
  store,
  adminToken,
  rateLimit: Number(process.env.RATE_LIMIT ?? 30),
  clientIp: (c) => (process.env.TRUST_PROXY === '1' ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined) ?? getConnInfo(c).remote.address,
})

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`nodboard telemetry on http://${host}:${info.port}  (dashboard: /admin)`)
  if (mock) console.log(`admin token: ${adminToken}`)
  else if (process.env.ADMIN_TOKEN === undefined) console.log(`tip: ADMIN_TOKEN=${randomBytes(24).toString('base64url')}`)
})
