import fs from 'node:fs'
import path from 'node:path'
import { assetFileName, blockAssetRefs, type Asset, type Block, type ChangeEntry } from '@aifig/shared'
import { siblingAssetsDir } from './assets'
import { backupPools, boardBackupDir, collectBackupPools, listBackups } from './backups'
import type { Board } from './board'
import { historyAssetFiles, historyDir, listVersions } from './versions'

/**
 * What a board keeps on disk and which of its asset files can go. A file is only ever deleted when nothing
 * names it: not the board, not a pending or accepted change (so review and undo keep working), not any
 * version in its history. Backups keep their own pool (backups.ts), collected against the backups alone.
 */

export interface GcReport {
  deleted: { name: string; size: number }[]
  freed: number
  /** Files the board no longer uses that version history still needs. */
  keptForHistory: number
  /** Why nothing was deleted, when that happened. */
  skipped?: string
}

/** Asset ids the document refers to: blocks, plus blocks inside change sets (pending review or undoable). */
export function referencedAssetIds(board: Board): Set<string> {
  const ids = new Set<string>()
  const add = (b: Partial<Block> | undefined) => {
    if (b) for (const id of blockAssetRefs(b)) ids.add(id)
  }
  for (const b of board.blocks.values()) add(b)
  const fromEntries = (entries?: ChangeEntry[]) => entries?.forEach((e) => e.op !== 'create' && e.target === 'block' && add(e.before as Block))
  for (const cs of board.changeSets.values()) {
    fromEntries(cs.entries)
    fromEntries(cs.accepted)
  }
  return ids
}

/** Entries in the `assets` map that no block or change refers to. */
export function unusedEntries(board: Board): Asset[] {
  const used = referencedAssetIds(board)
  return [...board.assets.values()].filter((a) => a?.hash && !used.has(a.id))
}

function dirSize(dir: string): number {
  let n = 0
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) n += dirSize(p)
      else if (e.isFile()) n += fs.statSync(p).size
    }
  } catch {
    // missing
  }
  return n
}

const fileSize = (f: string | null) => {
  try {
    return f ? fs.statSync(f).size : 0
  } catch {
    return 0
  }
}

/**
 * Delete asset files of a board that nothing names. `graceMs` spares files younger than that (something may
 * be about to refer to them). Nothing is deleted while any version file can't be read.
 */
export function collectBoardAssets(board: Board, opts: { dryRun?: boolean; graceMs?: number; live?: Set<string> } = {}): GcReport {
  const grace = opts.graceMs ?? 10 * 60_000
  const live = opts.live ?? new Set(board.assetFiles())
  const history = historyAssetFiles(board.id)
  const report: GcReport = { deleted: [], freed: 0, keptForHistory: 0 }
  if (history.unreadable) {
    report.skipped = `${history.unreadable} version file${history.unreadable === 1 ? '' : 's'} in the history can’t be read, so no file was deleted.`
    return report
  }
  for (const f of board.store.list()) {
    if (live.has(f.name)) continue
    if (history.files.has(f.name)) {
      report.keptForHistory++
      continue
    }
    if (Date.now() - f.mtimeMs < grace) continue
    if (!opts.dryRun) board.store.remove(f.hash, f.ext)
    report.deleted.push({ name: f.name, size: f.size })
    report.freed += f.size
  }
  const ext = board.externalStore
  if (ext) {
    for (const f of ext.list()) {
      if (live.has(f.name) || Date.now() - f.mtimeMs < grace) continue
      if (!opts.dryRun) ext.remove(f.hash, f.ext)
      report.deleted.push({ name: f.name, size: f.size })
      report.freed += f.size
    }
  }
  return report
}

/**
 * "Clean up unused": drop asset entries nothing refers to, save, then delete the files nothing names any
 * more (history keeps what it needs). `dryRun` reports what would happen.
 */
export function cleanUpAssets(board: Board, opts: { dryRun?: boolean } = {}) {
  const unused = unusedEntries(board)
  if (!opts.dryRun && unused.length) {
    board.doc.transact(() => {
      for (const a of unused) board.assets.delete(a.id)
    }, 'api')
    board.saveNow(true)
  }
  const gone = new Set(unused.map((a) => a.id))
  const live = new Set([...board.assets.values()].filter((a) => a?.hash && !gone.has(a.id)).map(assetFileName))
  const gc = collectBoardAssets(board, { dryRun: opts.dryRun, graceMs: 60_000, live })
  if (!opts.dryRun) collectBackupPools(board.id)
  return { removedEntries: unused.map((a) => ({ id: a.id, name: a.name ?? assetFileName(a), size: a.size })), ...gc }
}

export type AssetStatus = 'used' | 'unused' | 'missing'

/** Everything the storage panel shows. */
export function storageInfo(board: Board) {
  const used = new Map<string, { id: string; kind: Block['kind']; label: string }[]>()
  const posters = new Map<string, string>()
  for (const b of board.blocks.values()) {
    if (b.kind === 'video' && b.asset && b.poster && !posters.has(b.asset)) posters.set(b.asset, b.poster)
    for (const id of blockAssetRefs(b)) {
      const label = (b.kind === 'web' ? b.web?.title : b.title) || b.text || ''
      const list = used.get(id) ?? []
      if (!list.some((x) => x.id === b.id)) list.push({ id: b.id, kind: b.kind, label: label.replace(/\s+/g, ' ').trim().slice(0, 60) })
      used.set(id, list)
    }
  }
  const referenced = referencedAssetIds(board)
  const assets = [...board.assets.values()]
    .filter((a) => a?.hash)
    .map((a) => {
      const file = board.assetPath(a)
      const status: AssetStatus = !file ? 'missing' : referenced.has(a.id) ? 'used' : 'unused'
      return { ...a, file: file ?? board.store.file(a.hash, a.ext), status, usedBy: used.get(a.id) ?? [], pendingOnly: !used.has(a.id) && referenced.has(a.id), ...(posters.has(a.id) ? { poster: posters.get(a.id) } : {}) }
    })
    .sort((p, q) => q.size - p.size)
  const live = new Set(board.assetFiles())
  const history = historyAssetFiles(board.id)
  const stored = board.store.list()
  const historyOnly = stored.filter((f) => !live.has(f.name) && history.files.has(f.name))
  const orphans = stored.filter((f) => !live.has(f.name) && !history.files.has(f.name))
  const unused = assets.filter((a) => a.status === 'unused')
  const versions = listVersions(board.id)
  const backups = listBackups(board.id)
  const backupDir = boardBackupDir(board.id, board.title)
  const assetBytes = stored.reduce((n, f) => n + f.size, 0)
  const boardBytes = fileSize(board.file)
  return {
    board: {
      id: board.id,
      title: board.title,
      file: board.file,
      assetsDir: board.assetsDir,
      externalPath: board.externalPath,
      externalAssetsDir: board.externalPath ? siblingAssetsDir(board.externalPath) : null,
      schema: board.schemaLabel,
    },
    totals: {
      boardFile: boardBytes,
      assetFiles: stored.length,
      assetBytes,
      total: boardBytes + assetBytes,
      snippetWorkingCopies: dirSize(path.join(board.assetsDir, 'snippets')),
    },
    assets,
    cleanup: {
      entries: unused.length,
      /** bytes a clean-up would free now (files kept for history don't count) */
      bytes: unused.filter((a) => !history.files.has(assetFileName(a))).reduce((n, a) => n + a.size, 0) + orphans.reduce((n, f) => n + f.size, 0),
      orphanFiles: orphans.length,
      historyOnlyFiles: historyOnly.length,
      historyOnlyBytes: historyOnly.reduce((n, f) => n + f.size, 0),
    },
    history: { dir: historyDir(board.id), versions: versions.length, bytes: dirSize(historyDir(board.id)), unreadable: history.unreadable },
    backups: {
      dir: backupDir,
      count: backups.length,
      bytes: dirSize(backupDir),
      poolBytes: backupPools(board.id).reduce((n, d) => n + dirSize(d), 0),
    },
  }
}

export type StorageInfo = ReturnType<typeof storageInfo>
