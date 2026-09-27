import { createHash } from 'node:crypto'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { crc32 } from './zip'

/**
 * A strict reader for archives we didn't make ourselves (packs from other people). It refuses anything a
 * well-formed pack never contains instead of trying to make sense of it: paths that escape the destination
 * (zip-slip: `..`, absolute, drive letters, backslashes), symlinks, encryption, ZIP64, duplicate or
 * overlapping entries, compression other than store/deflate, and sizes over the limits — declared sizes are
 * enforced while inflating, so a zip bomb stops at its declared size. Every entry's CRC is checked.
 */

export class ZipError extends Error {}

export interface ZipLimits {
  maxEntries: number
  /** Sum of uncompressed sizes. */
  maxTotal: number
  /** Largest allowed uncompressed size for an entry. */
  maxEntry: (name: string) => number
  /** Deflated entries larger than 1 MB may not expand more than this. */
  maxRatio: number
}

export interface ZipItem {
  name: string
  method: 0 | 8
  crc: number
  compressed: number
  size: number
  dataStart: number
}

/** A relative path with plain segments only, or null. */
export function safeEntryName(name: string): string | null {
  if (!name || name.length > 512) return null
  if (/[\u0000-\u001f\u007f\\:*?"<>|]/.test(name)) return null
  if (name.startsWith('/')) return null
  const parts = name.replace(/\/$/, '').split('/')
  if (parts.some((p) => !p || p === '.' || p === '..' || p.endsWith(' ') || p.endsWith('.'))) return null
  return name
}

function readAt(fd: number, pos: number, len: number) {
  const buf = Buffer.alloc(len)
  const n = fs.readSync(fd, buf, 0, len, pos)
  if (n !== len) throw new ZipError('The archive is truncated')
  return buf
}

/** Read and check the central directory. Directory entries are skipped. */
export function readZipIndex(fd: number, limits: ZipLimits): ZipItem[] {
  const size = fs.fstatSync(fd).size
  if (size < 22) throw new ZipError('Not a zip archive')
  const tailLen = Math.min(size, 22 + 0xffff)
  const tail = readAt(fd, size - tailLen, tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('Not a zip archive (no end of central directory)')
  const disk = tail.readUInt16LE(eocd + 4)
  const cdDisk = tail.readUInt16LE(eocd + 6)
  const count = tail.readUInt16LE(eocd + 10)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOffset = tail.readUInt32LE(eocd + 16)
  if (disk !== 0 || cdDisk !== 0) throw new ZipError('Multi-part archives are not supported')
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipError('ZIP64 archives are not supported')
  if (count > limits.maxEntries) throw new ZipError(`Too many files in the archive (${count}; the limit is ${limits.maxEntries})`)
  if (cdOffset + cdSize > size - tailLen + eocd) throw new ZipError('The archive’s directory is damaged')
  const cd = readAt(fd, cdOffset, cdSize)
  const items: ZipItem[] = []
  const seen = new Set<string>()
  let total = 0
  let p = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new ZipError('The archive’s directory is damaged')
    const madeBy = cd.readUInt16LE(p + 4) >> 8
    const flags = cd.readUInt16LE(p + 8)
    const method = cd.readUInt16LE(p + 10)
    const crc = cd.readUInt32LE(p + 16)
    const compressed = cd.readUInt32LE(p + 20)
    const usize = cd.readUInt32LE(p + 24)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    const attrs = cd.readUInt32LE(p + 38)
    const localOffset = cd.readUInt32LE(p + 42)
    const raw = cd.subarray(p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    const name = flags & 0x0800 ? raw.toString('utf8') : raw.toString('latin1')
    if (flags & 0x0001) throw new ZipError(`“${name}” is encrypted`)
    if (madeBy === 3 && ((attrs >>> 16) & 0o170000) === 0o120000) throw new ZipError(`“${name}” is a symbolic link`)
    if (compressed === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported')
    if (!safeEntryName(name)) throw new ZipError(`Unsafe path in the archive: “${name.slice(0, 120)}”`)
    const key = name.normalize('NFC').toLowerCase()
    if (seen.has(key)) throw new ZipError(`“${name}” appears twice in the archive`)
    seen.add(key)
    if (name.endsWith('/')) continue
    if (method !== 0 && method !== 8) throw new ZipError(`“${name}” uses an unsupported compression method`)
    if (method === 0 && compressed !== usize) throw new ZipError(`“${name}” has inconsistent sizes`)
    if (usize > limits.maxEntry(name)) throw new ZipError(`“${name}” is too large (${usize} bytes)`)
    if (method === 8 && usize > 1024 * 1024 && usize / Math.max(1, compressed) > limits.maxRatio) throw new ZipError(`“${name}” expands suspiciously (${Math.round(usize / Math.max(1, compressed))}×)`)
    total += usize
    if (total > limits.maxTotal) throw new ZipError(`The archive unpacks to more than ${Math.round(limits.maxTotal / 1024 / 1024)} MB`)
    const lh = readAt(fd, localOffset, 30)
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new ZipError(`“${name}” is damaged (bad local header)`)
    const lNameLen = lh.readUInt16LE(26)
    const lExtraLen = lh.readUInt16LE(28)
    if (!readAt(fd, localOffset + 30, lNameLen).equals(raw)) throw new ZipError(`“${name}” has a mismatched local header`)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    if (dataStart + compressed > cdOffset) throw new ZipError(`“${name}” runs past the end of the data`)
    items.push({ name, method: method as 0 | 8, crc, compressed, size: usize, dataStart })
  }
  const sorted = [...items].sort((a, b) => a.dataStart - b.dataStart)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].dataStart < sorted[i - 1].dataStart + sorted[i - 1].compressed) throw new ZipError('Entries in the archive overlap')
  }
  return items
}

/**
 * Extract one entry, checking its CRC (and returning its SHA-256). With `dest` the bytes go to that file
 * (stored entries are copied in chunks, so large videos never sit in memory); without it they're returned.
 */
export function extractEntry(fd: number, item: ZipItem, dest?: string): { sha256: string; data?: Buffer } {
  const sha = createHash('sha256')
  if (item.method === 8) {
    let out: Buffer
    try {
      out = zlib.inflateRawSync(readAt(fd, item.dataStart, item.compressed), { maxOutputLength: Math.max(1, item.size) })
    } catch (e) {
      throw new ZipError(`“${item.name}” can’t be decompressed (${(e as Error).message})`)
    }
    if (out.length !== item.size) throw new ZipError(`“${item.name}” is not the size it claims`)
    if (crc32(out) !== item.crc) throw new ZipError(`“${item.name}” is damaged (CRC mismatch)`)
    sha.update(out)
    if (dest) fs.writeFileSync(dest, out)
    return { sha256: sha.digest('hex'), ...(dest ? {} : { data: out }) }
  }
  const chunks: Buffer[] = []
  const outFd = dest ? fs.openSync(dest, 'w', 0o644) : null
  let crc = 0
  try {
    for (let pos = 0; pos < item.size; ) {
      const n = Math.min(1 << 20, item.size - pos)
      const buf = readAt(fd, item.dataStart + pos, n)
      crc = crc32(buf, crc)
      sha.update(buf)
      if (outFd !== null) fs.writeSync(outFd, buf)
      else chunks.push(buf)
      pos += n
    }
  } finally {
    if (outFd !== null) fs.closeSync(outFd)
  }
  if (crc !== item.crc) {
    if (dest) fs.rmSync(dest, { force: true })
    throw new ZipError(`“${item.name}” is damaged (CRC mismatch)`)
  }
  return { sha256: sha.digest('hex'), ...(dest ? {} : { data: Buffer.concat(chunks) }) }
}
