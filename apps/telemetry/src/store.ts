// Storage for the counter: two tables, plain SQL that runs on SQLite (node:sqlite) and Cloudflare D1.
// Rows hold only the validated ping fields and a UTC day — no IP addresses, user agents or timestamps.

export interface Db {
  run(sql: string, params?: unknown[]): Promise<void>
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  install_id  TEXT NOT NULL,
  event       TEXT NOT NULL,
  day         TEXT NOT NULL,
  app_version TEXT NOT NULL,
  os          TEXT NOT NULL,
  arch        TEXT NOT NULL,
  locale      TEXT NOT NULL,
  PRIMARY KEY (install_id, event, day)
);
CREATE INDEX IF NOT EXISTS events_day ON events (day, event);
CREATE TABLE IF NOT EXISTS downloads (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  day      TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch     TEXT NOT NULL,
  kind     TEXT NOT NULL,
  version  TEXT NOT NULL,
  source   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS downloads_day ON downloads (day);
`

export interface EventRow {
  installId: string
  event: 'install' | 'active'
  day: string
  appVersion: string
  os: string
  arch: string
  locale: string
}

export interface DownloadRow {
  day: string
  platform: string
  arch: string
  kind: string
  version: string
  source: string
}

type Count = { k: string; n: number }

export const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10)
export const daysBefore = (day: string, n: number) => dayOf(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000)

export function createStore(db: Db) {
  return {
    migrate: () => db.exec(SCHEMA),

    /** `install` is kept once per install ID ever; `active` once per install ID per day. */
    async recordEvent(e: EventRow): Promise<boolean> {
      const before = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE install_id = ? AND event = ? AND (event = ? OR day = ?)', [e.installId, e.event, 'install', e.day])
      if (Number(before[0]?.n ?? 0) > 0) return false
      await db.run('INSERT OR IGNORE INTO events (install_id, event, day, app_version, os, arch, locale) VALUES (?, ?, ?, ?, ?, ?, ?)', [e.installId, e.event, e.day, e.appVersion, e.os, e.arch, e.locale])
      return true
    },

    async recordDownload(d: DownloadRow) {
      await db.run('INSERT INTO downloads (day, platform, arch, kind, version, source) VALUES (?, ?, ?, ?, ?, ?)', [d.day, d.platform, d.arch, d.kind, d.version, d.source])
    },

    /** Everything the dashboard shows, for the `days` ending `today` (inclusive). */
    async stats(today: string, days: number) {
      const since = daysBefore(today, days - 1)
      const num = async (sql: string, params: unknown[] = []) => Number((await db.all<{ n: number }>(sql, params))[0]?.n ?? 0)
      const series = (sql: string, params: unknown[]) => db.all<{ day: string; n: number }>(sql, params)
      const breakdown = (sql: string, params: unknown[] = []) => db.all<Count>(sql, params)
      const [installs, installsInRange, downloads, downloadsInRange, dauToday, active7, active30] = await Promise.all([
        num("SELECT COUNT(*) AS n FROM events WHERE event = 'install'"),
        num("SELECT COUNT(*) AS n FROM events WHERE event = 'install' AND day >= ?", [since]),
        num('SELECT COUNT(*) AS n FROM downloads'),
        num('SELECT COUNT(*) AS n FROM downloads WHERE day >= ?', [since]),
        num('SELECT COUNT(DISTINCT install_id) AS n FROM events WHERE day = ?', [today]),
        num('SELECT COUNT(DISTINCT install_id) AS n FROM events WHERE day >= ?', [daysBefore(today, 6)]),
        num('SELECT COUNT(DISTINCT install_id) AS n FROM events WHERE day >= ?', [daysBefore(today, 29)]),
      ])
      const [installsByDay, dauByDay, downloadsByDay] = await Promise.all([
        series("SELECT day, COUNT(*) AS n FROM events WHERE event = 'install' AND day >= ? GROUP BY day ORDER BY day", [since]),
        series('SELECT day, COUNT(DISTINCT install_id) AS n FROM events WHERE day >= ? GROUP BY day ORDER BY day', [since]),
        series('SELECT day, COUNT(*) AS n FROM downloads WHERE day >= ? GROUP BY day ORDER BY day', [since]),
      ])
      const by = (col: string) => breakdown(`SELECT ${col} AS k, COUNT(*) AS n FROM events WHERE event = 'install' AND day >= ? GROUP BY ${col} ORDER BY n DESC LIMIT 12`, [since])
      const [os, version, arch, locale, activeByVersion, downloadsByPlatform] = await Promise.all([
        by('os'),
        by('app_version'),
        by('arch'),
        by('locale'),
        breakdown('SELECT app_version AS k, COUNT(DISTINCT install_id) AS n FROM events WHERE day >= ? GROUP BY app_version ORDER BY n DESC LIMIT 12', [daysBefore(today, 6)]),
        breakdown("SELECT platform || ' · ' || kind AS k, COUNT(*) AS n FROM downloads WHERE day >= ? GROUP BY platform, kind ORDER BY n DESC LIMIT 12", [since]),
      ])
      const fill = (rows: { day: string; n: number }[]) => {
        const m = new Map(rows.map((r) => [r.day, Number(r.n)]))
        return Array.from({ length: days }, (_, i) => {
          const day = daysBefore(today, days - 1 - i)
          return { day, n: m.get(day) ?? 0 }
        })
      }
      const nums = (rows: Count[]) => rows.map((r) => ({ k: String(r.k), n: Number(r.n) }))
      return {
        range: { since, until: today, days },
        totals: { installs, installsInRange, downloads, downloadsInRange, dauToday, active7, active30 },
        installsByDay: fill(installsByDay),
        dauByDay: fill(dauByDay),
        downloadsByDay: fill(downloadsByDay),
        installsByOs: nums(os),
        installsByVersion: nums(version),
        installsByArch: nums(arch),
        installsByLocale: nums(locale),
        activeByVersion: nums(activeByVersion),
        downloadsByPlatform: nums(downloadsByPlatform),
      }
    },
  }
}

export type Store = ReturnType<typeof createStore>
export type Stats = Awaited<ReturnType<Store['stats']>>
