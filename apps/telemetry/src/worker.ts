// Cloudflare Workers entry: `npx wrangler deploy` (see wrangler.toml). Storage is a D1 database bound as DB;
// set the admin token with `npx wrangler secret put ADMIN_TOKEN`.
import type { D1Database } from '@cloudflare/workers-types'
import { createApp } from './app.ts'
import { createStore, type Db } from './store.ts'

interface Env {
  DB: D1Database
  ADMIN_TOKEN?: string
  RATE_LIMIT?: string
}

function d1Db(d1: D1Database): Db {
  return {
    async run(sql, params = []) {
      await d1.prepare(sql).bind(...params).run()
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return ((await d1.prepare(sql).bind(...params).all()).results ?? []) as T[]
    },
    async exec(sql) {
      // D1's exec() takes one statement per line
      await d1.exec(sql.replace(/\s*\n\s*/g, ' ').replace(/;\s*/g, ';\n'))
    },
  }
}

let app: ReturnType<typeof createApp> | null = null
let migrated: Promise<void> | null = null

export default {
  async fetch(req: Request, env: Env, ctx: unknown) {
    const store = createStore(d1Db(env.DB))
    migrated ??= store.migrate()
    await migrated
    app ??= createApp({ store, adminToken: env.ADMIN_TOKEN, rateLimit: Number(env.RATE_LIMIT ?? 30), clientIp: (c) => c.req.header('cf-connecting-ip') })
    return app.fetch(req, env, ctx as never)
  },
}
