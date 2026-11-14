import fs from 'node:fs'
import path from 'node:path'
import { ASSET_FILE_RE } from '@nodboard/shared'
import { AssetStore } from './assets'
import { writeFileAtomic } from './atomic'
import { dataSafetyConfig } from './config'
import { decodeContainer, isContainer, readHeader, sha256 } from './fileformat'
import { readHeaderFromFile } from './versions'

export function backupRoot() {
  return dataSafetyConfig().backups.dir
}

const slug = (s: string) => s.replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'board'

function stamp(at: number) {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Backup folders of a board (one per title it has had): `<title>--<id>`. */
function boardDirs(boardId: string): string[] {
  const root = backupRoot()
  try {
    return fs
      .readdirSync(root)
      .filter((n) => n.endsWith(`--${boardId}`))
      .map((n) => path.join(root, n))
  } catch {
    return []
  }
}

export function boardBackupDir(boardId: string, title: string) {
  return boardDirs(boardId)[0] ?? path.join(backupRoot(), `${slug(title)}--${boardId}`)
}

export interface BackupEntry {
  file: string
  savedAt: number
  sha256: string | null
  /** Asset files it needs (schema 2.0+), kept in the folder's `assets/` pool. */
  assets: string[]
}

/**
 * Each board's backup folder keeps one `assets/` pool shared by all its backups: a file is stored there once
 * (hard-linked from the board when on the same volume) however many backups use it, and stays until no
 * backup in the folder names it. Backups don't depend on the board's own folder, which they exist to replace.
 */
export const POOL = 'assets'

export function backupPools(boardId: string) {
  return boardDirs(boardId).map((d) => path.join(d, POOL))
}

/** Backups of a board, newest first. */
export function listBackups(boardId: string): BackupEntry[] {
  const out: BackupEntry[] = []
  for (const dir of boardDirs(boardId)) {
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith('.nodboard') && !n.endsWith('.aifig')) continue
      const file = path.join(dir, n)
      try {
        const { header } = readHeaderFromFile(file)
        out.push({ file, savedAt: header.savedAt, sha256: header.payload.sha256, assets: header.assets ?? [] })
      } catch {
        out.push({ file, savedAt: fs.statSync(file).mtimeMs, sha256: null, assets: [] })
      }
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

/**
 * Copy a board file into the rolling backups unless the newest backup already has the same content, with the
 * asset files its header lists (from `store`, the board's assets folder) linked into the folder's pool.
 * Returns the new backup path, or null when nothing changed.
 */
export function backupFile(boardId: string, title: string, data: Uint8Array, label = '', store?: AssetStore) {
  const payloadSha = isContainer(data) ? decodeContainer(data).header!.payload.sha256 : sha256(data)
  const existing = listBackups(boardId)
  if (existing[0]?.sha256 === payloadSha && !label) return null
  const dir = boardBackupDir(boardId, title)
  const pool = new AssetStore(path.join(dir, POOL))
  const needs = isContainer(data) ? (readHeader(data).header.assets ?? []) : []
  for (const name of needs) {
    const m = name.match(ASSET_FILE_RE)
    if (!m || pool.has(m[1], m[2])) continue
    try {
      if (!store?.copyTo(pool, m[1], m[2])) console.error(`[core] backup of ${boardId}: ${name} is missing from the assets folder`)
    } catch (e) {
      console.error(`[core] backup of ${boardId}: could not keep ${name}:`, e)
    }
  }
  const file = path.join(dir, `${stamp(Date.now())}${label ? `-${label}` : ''}.nodboard`)
  writeFileAtomic(file, data)
  pruneBackups(boardId)
  return file
}

/** Keep the newest `keep` rolling backups per board; labelled ones (pre-migration) are kept too. */
export function pruneBackups(boardId: string) {
  const keep = dataSafetyConfig().backups.keep
  const rolling = listBackups(boardId).filter((b) => /_\d{6}\.(nodboard|aifig)$/.test(b.file))
  for (const b of rolling.slice(keep)) fs.rmSync(b.file, { force: true })
  collectBackupPools(boardId)
}

/** Remove pool files no backup in the folder names any more (never when a backup's header can't be read). */
export function collectBackupPools(boardId: string, graceMs = 10 * 60_000) {
  const freed: string[] = []
  for (const dir of boardDirs(boardId)) {
    const pool = new AssetStore(path.join(dir, POOL))
    const files = pool.list()
    if (!files.length) continue
    const needed = new Set<string>()
    let unreadable = false
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith('.nodboard') && !n.endsWith('.aifig')) continue
      try {
        for (const f of readHeaderFromFile(path.join(dir, n)).header.assets ?? []) needed.add(f)
      } catch {
        unreadable = true
      }
    }
    if (unreadable) continue
    for (const f of files) {
      if (needed.has(f.name) || Date.now() - f.mtimeMs < graceMs) continue
      pool.remove(f.hash, f.ext)
      freed.push(f.name)
    }
  }
  return freed
}

/** Where damaged files are moved so they are never overwritten, and never retried as boards. */
export function quarantine(file: string, boardId: string) {
  const dir = path.join(backupRoot(), 'damaged')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${boardId}-${stamp(Date.now())}${path.extname(file) || '.nodboard'}`)
  try {
    fs.renameSync(file, dest)
  } catch {
    fs.copyFileSync(file, dest)
    fs.rmSync(file, { force: true })
  }
  return dest
}
