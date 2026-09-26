import fs from 'node:fs'
import path from 'node:path'

let counter = 0

const TMP_RE = /^\..+\.\d+\.\d+\.tmp$|\.tmp$/

/**
 * Crash-safe write: the data goes to a temp file in the same directory, is fsynced, then renamed over
 * the target (atomic on POSIX and NTFS) and the directory entry is fsynced. A reader — or a crash at any
 * point, including kill -9 — sees either the old file or the new one, never a torn write.
 */
export function writeFileAtomic(file: string, data: Uint8Array | string) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${++counter}.tmp`)
  const fd = fs.openSync(tmp, 'w', 0o644)
  try {
    const buf = typeof data === 'string' ? Buffer.from(data) : data
    let off = 0
    while (off < buf.byteLength) off += fs.writeSync(fd, buf, off, buf.byteLength - off)
    fs.fsyncSync(fd)
  } catch (e) {
    fs.closeSync(fd)
    fs.rmSync(tmp, { force: true })
    throw e
  }
  fs.closeSync(fd)
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
  fsyncDir(dir)
}

function fsyncDir(dir: string) {
  let fd: number | null = null
  try {
    fd = fs.openSync(dir, 'r')
    fs.fsyncSync(fd)
  } catch {
    // directories can't be opened or fsynced on Windows; the rename is still atomic there
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/** Remove temp files left behind by a crash mid-write (older than `minAgeMs`). */
export function cleanStaleTemps(dir: string, minAgeMs = 10_000) {
  let removed = 0
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of names) {
    if (!TMP_RE.test(name)) continue
    const f = path.join(dir, name)
    try {
      if (Date.now() - fs.statSync(f).mtimeMs < minAgeMs) continue
      fs.rmSync(f, { force: true })
      removed++
    } catch {
      // raced with another cleanup
    }
  }
  return removed
}
