import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './atomic'
import { dataSafetyConfig } from './config'
import { decodeContainer, isContainer, sha256 } from './fileformat'
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
}

/** Backups of a board, newest first. */
export function listBackups(boardId: string): BackupEntry[] {
  const out: BackupEntry[] = []
  for (const dir of boardDirs(boardId)) {
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith('.aifig')) continue
      const file = path.join(dir, n)
      try {
        const { header } = readHeaderFromFile(file)
        out.push({ file, savedAt: header.savedAt, sha256: header.payload.sha256 })
      } catch {
        out.push({ file, savedAt: fs.statSync(file).mtimeMs, sha256: null })
      }
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

/**
 * Copy a board file into the rolling backups unless the newest backup already has the same content.
 * Returns the new backup path, or null when nothing changed.
 */
export function backupFile(boardId: string, title: string, data: Uint8Array, label = '') {
  const payloadSha = isContainer(data) ? decodeContainer(data).header!.payload.sha256 : sha256(data)
  const existing = listBackups(boardId)
  if (existing[0]?.sha256 === payloadSha && !label) return null
  const dir = boardBackupDir(boardId, title)
  const file = path.join(dir, `${stamp(Date.now())}${label ? `-${label}` : ''}.aifig`)
  writeFileAtomic(file, data)
  pruneBackups(boardId)
  return file
}

/** Keep the newest `keep` rolling backups per board; labelled ones (pre-migration) are kept too. */
export function pruneBackups(boardId: string) {
  const keep = dataSafetyConfig().backups.keep
  const rolling = listBackups(boardId).filter((b) => /_\d{6}\.aifig$/.test(b.file))
  for (const b of rolling.slice(keep)) fs.rmSync(b.file, { force: true })
}

/** Where damaged files are moved so they are never overwritten, and never retried as boards. */
export function quarantine(file: string, boardId: string) {
  const dir = path.join(backupRoot(), 'damaged')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${boardId}-${stamp(Date.now())}${path.extname(file) || '.aifig'}`)
  try {
    fs.renameSync(file, dest)
  } catch {
    fs.copyFileSync(file, dest)
    fs.rmSync(file, { force: true })
  }
  return dest
}
