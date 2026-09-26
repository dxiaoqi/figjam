import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function aifigHome() {
  return process.env.AIFIG_HOME ?? path.join(os.homedir(), '.aifig')
}

export interface RetentionPolicy {
  /** Newest automatic versions that are always kept. */
  keepRecent: number
  /** After that, one per hour for this many hours… */
  hourlyForHours: number
  /** …then one per day for this many days. Older automatic versions are removed. */
  dailyForDays: number
}

export interface DataSafetyConfig {
  backups: {
    /** Absolute path; defaults to <AIFIG_HOME>/backups. `~` expands to the home folder. */
    dir: string
    /** Rolling backups kept per board. */
    keep: number
    /** Minimum minutes between two backups of a changed board. */
    intervalMinutes: number
  }
  versions: RetentionPolicy & {
    /** Take an automatic version at most this often while a board changes. */
    intervalMinutes: number
    /** Blocks or connectors added/removed since the last version that count as a significant change. */
    significantChanges: number
  }
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepRecent: 20, hourlyForHours: 48, dailyForDays: 30 }

const expand = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)

/**
 * Data-safety settings from <AIFIG_HOME>/config.json (`{ "backups": { "dir": "~/Dropbox/aifig", "keep": 20 } }`),
 * with AIFIG_BACKUP_DIR taking precedence for the backup folder. Read on every use, so edits apply without a restart.
 */
export function dataSafetyConfig(): DataSafetyConfig {
  let file: Partial<{ backups: Partial<DataSafetyConfig['backups']>; versions: Partial<DataSafetyConfig['versions']> }> = {}
  try {
    file = JSON.parse(fs.readFileSync(path.join(aifigHome(), 'config.json'), 'utf8'))
  } catch {
    // no config file: defaults
  }
  const num = (v: unknown, d: number, min = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : d)
  const b = file.backups ?? {}
  const v = file.versions ?? {}
  const dir = process.env.AIFIG_BACKUP_DIR || (typeof b.dir === 'string' && b.dir ? b.dir : path.join(aifigHome(), 'backups'))
  return {
    backups: { dir: path.resolve(expand(dir)), keep: num(b.keep, 10, 1), intervalMinutes: num(b.intervalMinutes, 60) },
    versions: {
      keepRecent: num(v.keepRecent, DEFAULT_RETENTION.keepRecent, 1),
      hourlyForHours: num(v.hourlyForHours, DEFAULT_RETENTION.hourlyForHours),
      dailyForDays: num(v.dailyForDays, DEFAULT_RETENTION.dailyForDays),
      intervalMinutes: num(v.intervalMinutes, 10),
      significantChanges: num(v.significantChanges, 25, 1),
    },
  }
}
