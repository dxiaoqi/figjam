import fs from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import type { VersionInfo, VersionKind } from '@aifig/shared'
import { writeFileAtomic } from './atomic'
import { aifigHome, type RetentionPolicy } from './config'
import { CorruptFileError, decodeContainer, encodeContainer, readHeader, type ContainerHeader } from './fileformat'

/** Kinds that retention never removes on its own. */
const PROTECTED: VersionKind[] = ['checkpoint', 'recovered']

export function historyDir(boardId: string) {
  return path.join(aifigHome(), 'history', boardId)
}

const idOk = (id: string) => /^v[0-9a-z]+$/.test(id)

function newVersionId(at: number) {
  return `v${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Read just enough of a file to parse its header. */
export function readHeaderFromFile(file: string): { header: ContainerHeader; size: number } {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    let want = Math.min(size, 16 * 1024)
    for (;;) {
      const buf = Buffer.alloc(want)
      fs.readSync(fd, buf, 0, want, 0)
      try {
        return { header: readHeader(buf, file).header, size }
      } catch (e) {
        if (want >= size || !(e instanceof CorruptFileError) || !e.reason.includes('truncated')) throw e
        want = Math.min(size, want * 4)
      }
    }
  } finally {
    fs.closeSync(fd)
  }
}

function infoFrom(boardId: string, header: ContainerHeader, size: number): VersionInfo | null {
  const v = header.version as Partial<VersionInfo> | undefined
  if (!v?.id || !v.kind) return null
  return {
    id: v.id,
    boardId,
    kind: v.kind,
    name: v.name ?? '',
    createdAt: v.createdAt ?? header.savedAt,
    blockCount: v.blockCount ?? 0,
    connectorCount: v.connectorCount ?? 0,
    size,
    ...(v.by ? { by: v.by } : {}),
  }
}

export interface VersionSource {
  id: string
  title: string
  doc: Y.Doc
  schemaLabel: string
}

/** Snapshot a board document into its history. */
export function writeVersion(board: VersionSource, kind: VersionKind, name: string, by?: string, payload?: Uint8Array, at = Date.now()): VersionInfo {
  const id = newVersionId(at)
  const doc = payload ? docFrom(payload) : board.doc
  const info: Omit<VersionInfo, 'size'> = {
    id,
    boardId: board.id,
    kind,
    name,
    createdAt: at,
    blockCount: doc.getMap('blocks').size,
    connectorCount: doc.getMap('connectors').size,
    ...(by ? { by } : {}),
  }
  const bytes = encodeContainer(payload ?? Y.encodeStateAsUpdate(board.doc), { savedAt: at, board: board.id, title: board.title, schema: board.schemaLabel, version: { ...info } })
  writeFileAtomic(path.join(historyDir(board.id), `${id}.aifig`), bytes)
  return { ...info, size: bytes.byteLength }
}

function docFrom(payload: Uint8Array) {
  const d = new Y.Doc()
  Y.applyUpdate(d, payload)
  return d
}

/** Versions of a board, newest first. Files with unreadable headers are skipped. */
export function listVersions(boardId: string): VersionInfo[] {
  const dir = historyDir(boardId)
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.aifig'))
  } catch {
    return []
  }
  const out: VersionInfo[] = []
  for (const n of names) {
    try {
      const { header, size } = readHeaderFromFile(path.join(dir, n))
      const info = infoFrom(boardId, header, size)
      if (info) out.push(info)
    } catch {
      // damaged version files don't hide the rest
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export function versionFile(boardId: string, id: string) {
  if (!idOk(id)) throw new CorruptFileError(`"${id}" is not a version id`)
  return path.join(historyDir(boardId), `${id}.aifig`)
}

/** Read and verify one version. Throws CorruptFileError / FutureVersionError, or ENOENT. */
export function readVersion(boardId: string, id: string) {
  const file = versionFile(boardId, id)
  const data = fs.readFileSync(file)
  const decoded = decodeContainer(data, file)
  const info = infoFrom(boardId, decoded.header!, data.byteLength)
  if (!info) throw new CorruptFileError('not a version snapshot', file)
  return { info, ...decoded, file }
}

export function deleteVersion(boardId: string, id: string) {
  fs.rmSync(versionFile(boardId, id), { force: true })
}

export function deleteHistory(boardId: string) {
  fs.rmSync(historyDir(boardId), { recursive: true, force: true })
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * Which automatic versions a retention policy removes: the newest `keepRecent` stay, then the newest per
 * hour for `hourlyForHours`, then the newest per day for `dailyForDays`; anything older goes. Named
 * checkpoints and recovery snapshots are never selected.
 */
export function selectPrunable(versions: Pick<VersionInfo, 'id' | 'kind' | 'createdAt'>[], policy: RetentionPolicy, now = Date.now()): string[] {
  const auto = versions.filter((v) => !PROTECTED.includes(v.kind)).sort((a, b) => b.createdAt - a.createdAt)
  const keep = new Set(auto.slice(0, policy.keepRecent).map((v) => v.id))
  const hours = new Set<number>()
  const days = new Set<number>()
  for (const v of auto.slice(policy.keepRecent)) {
    const age = now - v.createdAt
    if (age <= policy.hourlyForHours * HOUR) {
      const k = Math.floor(v.createdAt / HOUR)
      if (!hours.has(k)) {
        hours.add(k)
        keep.add(v.id)
      }
    } else if (age <= policy.dailyForDays * DAY) {
      const k = Math.floor(v.createdAt / DAY)
      if (!days.has(k)) {
        days.add(k)
        keep.add(v.id)
      }
    }
  }
  return auto.filter((v) => !keep.has(v.id)).map((v) => v.id)
}

export function pruneVersions(boardId: string, policy: RetentionPolicy, now = Date.now()) {
  const doomed = selectPrunable(listVersions(boardId), policy, now)
  for (const id of doomed) deleteVersion(boardId, id)
  return doomed
}
