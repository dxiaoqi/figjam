// SQLite through Node's built-in node:sqlite (Node 22.13+): no native module to compile.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Db } from './store.ts'

export function sqliteDb(file: string): Db & { close(): void; raw: DatabaseSync } {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  const p = (params: unknown[] = []) => params as SQLInputValue[]
  return {
    raw: db,
    async run(sql, params) {
      db.prepare(sql).run(...p(params))
    },
    async all<T>(sql: string, params?: unknown[]) {
      return db.prepare(sql).all(...p(params)) as T[]
    },
    async exec(sql) {
      db.exec(sql)
    },
    close: () => db.close(),
  }
}
