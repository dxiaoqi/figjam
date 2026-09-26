import fs from 'node:fs'
import type { VersionInfo, VersionKind } from '@aifig/shared'
import { backupFile, listBackups } from './backups'
import type { Board, ChangeCounts } from './board'
import { dataSafetyConfig } from './config'
import { decodeContainer } from './fileformat'
import type { NoticeStore } from './notices'
import { deleteHistory, listVersions, pruneVersions, writeVersion } from './versions'

interface Track {
  lastVersionAt: number
  lastBackupAt: number
}

/** Rows of blocks that make an edit "large": the state from just before it is kept as a version. */
export function isSignificant(p: ChangeCounts, threshold: number) {
  return p.removed >= 5 || p.added + p.removed + p.updated >= threshold
}

function describeLarge(p: ChangeCounts) {
  if (p.removed >= 5) return `Before ${p.removed} items were removed`
  if (p.added >= p.updated) return `Before ${p.added} items were added`
  return `Before ${p.updated} items were changed`
}

/**
 * Version history and backups around every save: a version from just before large edits, one every few
 * minutes while a board changes, one when a board is opened with unversioned edits, rolling file backups,
 * and a notice when saving fails.
 */
export class DataSafety {
  private track = new WeakMap<Board, Track>()

  constructor(private notices: NoticeStore) {}

  private state(b: Board): Track {
    let t = this.track.get(b)
    if (!t) {
      t = { lastVersionAt: listVersions(b.id)[0]?.createdAt ?? 0, lastBackupAt: listBackups(b.id)[0]?.savedAt ?? 0 }
      this.track.set(b, t)
    }
    return t
  }

  attach(b: Board) {
    this.state(b)
    b.beforeWrite = (board, pending) => this.beforeWrite(board, pending)
    b.onSaved = (board) => this.afterSave(board)
    b.onSaveError = (board, e) =>
      this.notices.add({
        id: `save-failed:${board.id}`,
        kind: 'save-failed',
        level: 'error',
        boardId: board.id,
        boardTitle: board.title,
        title: `Can’t save “${board.title}”`,
        detail: `${(e as NodeJS.ErrnoException).code ?? 'Error'}: ${e.message}. Your edits are kept in memory and saving is retried every few seconds — don’t quit until this clears.`,
      })
  }

  /** A board loaded cleanly: back up the file, and version it if it has edits no version has seen. */
  onLoaded(b: Board, data: Uint8Array) {
    const t = this.state(b)
    try {
      const file = backupFile(b.id, b.title, data)
      if (file) t.lastBackupAt = Date.now()
      if (b.lastSavedAt > t.lastVersionAt + 1000) this.snapshot(b, 'opened', 'Opened')
    } catch (e) {
      console.error(`[core] could not back up ${b.id}:`, e)
    }
  }

  onRecovered(b: Board, from: string) {
    this.snapshot(b, 'recovered', `Restored from ${from}`)
  }

  snapshot(b: Board, kind: VersionKind, name: string, by?: string, payload?: Uint8Array, at?: number): VersionInfo {
    const info = writeVersion(b, kind, name, by, payload, at)
    const t = this.state(b)
    t.lastVersionAt = Math.max(t.lastVersionAt, info.createdAt)
    if (kind !== 'checkpoint') pruneVersions(b.id, dataSafetyConfig().versions)
    return info
  }

  private beforeWrite(b: Board, pending: ChangeCounts) {
    if (!isSignificant(pending, dataSafetyConfig().versions.significantChanges)) return
    let old: Buffer
    try {
      old = fs.readFileSync(b.file)
    } catch {
      return
    }
    const { payload, header } = decodeContainer(old, b.file)
    // dated when that state was saved, so it sorts before anything made since
    this.snapshot(b, 'auto', describeLarge(pending), undefined, payload, header?.savedAt)
  }

  private afterSave(b: Board) {
    if (this.notices.has(`save-failed:${b.id}`)) this.notices.dismiss(`save-failed:${b.id}`)
    const cfg = dataSafetyConfig()
    const t = this.state(b)
    const now = Date.now()
    try {
      if (now - t.lastVersionAt >= cfg.versions.intervalMinutes * 60_000) this.snapshot(b, 'auto', 'Autosave')
      if (now - t.lastBackupAt >= cfg.backups.intervalMinutes * 60_000) {
        backupFile(b.id, b.title, fs.readFileSync(b.file))
        t.lastBackupAt = now
      }
    } catch (e) {
      console.error(`[core] history/backup for ${b.id} failed:`, e)
    }
  }

  /** Deleting a board keeps a last backup of it; its in-app history goes. */
  beforeDelete(b: Board) {
    try {
      b.saveNow()
      backupFile(b.id, b.title, fs.readFileSync(b.file), 'deleted')
    } catch (e) {
      console.error(`[core] final backup of ${b.id} failed:`, e)
    }
    deleteHistory(b.id)
  }
}

let installed = false

/**
 * Write unsaved edits on the way out: Ctrl-C, SIGTERM (the desktop app quitting), SIGHUP (terminal closed),
 * crashes and process.exit(). kill -9 can't be caught; atomic writes and the save deadline bound what it loses.
 */
export function installFlushOnExit(flush: () => void) {
  if (installed) return
  installed = true
  let done = false
  const run = () => {
    if (done) return
    done = true
    try {
      flush()
    } catch (e) {
      console.error('[core] flush on exit failed:', e)
    }
  }
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  if (process.platform === 'win32') signals.push('SIGBREAK')
  for (const sig of signals) {
    process.on(sig, () => {
      run()
      process.exit(0)
    })
  }
  process.on('exit', run)
  process.on('uncaughtException', (e) => {
    console.error('[core] crashed:', e)
    run()
    process.exit(1)
  })
  process.on('unhandledRejection', (e) => {
    console.error('[core] crashed (unhandled rejection):', e)
    run()
    process.exit(1)
  })
}
