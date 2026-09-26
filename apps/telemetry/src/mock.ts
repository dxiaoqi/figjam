// Plausible fake history for local development and screenshots: `npm run mock -w @aifig/telemetry`.
import type { DatabaseSync } from 'node:sqlite'
import { dayOf, daysBefore } from './store.ts'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const pick = <T>(r: () => number, weighted: [T, number][]) => {
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let x = r() * total
  for (const [v, w] of weighted) if ((x -= w) <= 0) return v
  return weighted[0][0]
}

const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('')
const uuid = (r: () => number) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-${pick(r, [['8', 1], ['9', 1], ['a', 1], ['b', 1]])}${hex(r, 3)}-${hex(r, 12)}`

export function seedMock(db: DatabaseSync, now = Date.now(), days = 90) {
  const r = rng(42)
  const today = dayOf(now)
  const insertEvent = db.prepare('INSERT OR IGNORE INTO events (install_id, event, day, app_version, os, arch, locale) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insertDownload = db.prepare('INSERT INTO downloads (day, platform, arch, kind, version, source) VALUES (?, ?, ?, ?, ?, ?)')
  const installs: { id: string; os: string; arch: string; locale: string; version: string; stickiness: number; until: number }[] = []
  db.exec('BEGIN')
  for (let i = days - 1; i >= 0; i--) {
    const day = daysBefore(today, i)
    const age = days - i
    const version = age < 30 ? '0.1.0' : age < 65 ? '0.2.0' : '0.3.0'
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    const weekend = weekday === 0 || weekday === 6 ? 0.6 : 1
    const launchBump = age === 31 || age === 66 ? 2.4 : 1
    const newInstalls = Math.round((4 + age * 0.55 + r() * 6) * weekend * launchBump)
    const downloads = Math.round(newInstalls * (1.5 + r() * 0.4))
    for (let d = 0; d < downloads; d++) {
      const platform = pick(r, [['macos', 55], ['windows', 27], ['linux', 18]])
      const kind = platform === 'macos' ? pick(r, [['dmg', 9], ['zip', 1]]) : platform === 'windows' ? 'exe' : pick(r, [['appimage', 6], ['deb', 4]])
      const arch = platform === 'macos' ? pick(r, [['arm64', 78], ['x64', 22]]) : pick(r, [['x64', 92], ['arm64', 8]])
      insertDownload.run(day, platform, arch, kind, version, 'website')
    }
    for (let n = 0; n < newInstalls; n++) {
      const os = pick(r, [['macos', 58], ['windows', 25], ['linux', 17]])
      const inst = {
        id: uuid(r),
        os,
        arch: os === 'macos' ? pick(r, [['arm64', 80], ['x64', 20]]) : pick(r, [['x64', 93], ['arm64', 7]]),
        locale: pick(r, [['en-US', 34], ['zh-CN', 30], ['en-GB', 7], ['de-DE', 6], ['ja-JP', 6], ['fr-FR', 5], ['zh-TW', 4], ['ko-KR', 4], ['es-ES', 4]]),
        version,
        stickiness: r() < 0.35 ? 0.03 : 0.25 + r() * 0.6,
        // about half stop using it within a few weeks
        until: r() < 0.5 ? age + Math.floor(r() * 30) : Infinity,
      }
      installs.push(inst)
      insertEvent.run(inst.id, 'install', day, inst.version, inst.os, inst.arch, inst.locale)
    }
    for (const inst of installs) {
      if (age > inst.until || r() > inst.stickiness * weekend) continue
      if (inst.version < version && r() < 0.15) inst.version = version
      insertEvent.run(inst.id, 'active', day, inst.version, inst.os, inst.arch, inst.locale)
    }
  }
  db.exec('COMMIT')
  return { installs: installs.length }
}
