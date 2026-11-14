import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ASSET_FILE_RE } from '@nodboard/shared'
import { writeFileAtomic } from './atomic'

/**
 * A content-addressed folder of asset files: `<sha256>.<ext>`, written once (atomically) and then left
 * read-only, so identical files are stored once and every board version, backup or copy that names a hash
 * can rely on its bytes never changing. Editable working copies (snippet source) live elsewhere
 * (`snippets/`, see snippet-files.ts) and are ingested back as new files.
 */

export const sha256Hex = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')

/** SHA-256 of a file, read in chunks (videos can be large). */
export function hashFile(file: string): { hash: string; size: number } {
  const h = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.allocUnsafe(1 << 20)
  let size = 0
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null)
      if (!n) break
      h.update(buf.subarray(0, n))
      size += n
    }
  } finally {
    fs.closeSync(fd)
  }
  return { hash: h.digest('hex'), size }
}

function makeReadOnly(file: string) {
  try {
    fs.chmodSync(file, 0o444)
  } catch {
    // not fatal: the store never rewrites a file whose name matches its hash
  }
}

/**
 * Put `src` at `dest` via a temp file. Between asset folders (whose files never change) a hard link when both
 * are on one volume; a file from outside is always copied (a copy-on-write clone where the file system can),
 * so the person's own file is never tied to — or made read-only with — the stored one.
 */
export function linkOrCopy(src: string, dest: string, opts: { link?: boolean } = {}) {
  const dir = path.dirname(dest)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(dest)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    if (!opts.link) throw new Error('copy')
    fs.linkSync(src, tmp)
  } catch {
    fs.copyFileSync(src, tmp, fs.constants.COPYFILE_FICLONE)
    fs.chmodSync(tmp, 0o644)
    const fd = fs.openSync(tmp, 'r+')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }
  try {
    fs.renameSync(tmp, dest)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
  makeReadOnly(dest)
}

export interface StoredFile {
  hash: string
  ext: string
  name: string
  file: string
  size: number
  mtimeMs: number
}

export class AssetStore {
  constructor(readonly dir: string) {}

  file(hash: string, ext: string) {
    if (!/^[0-9a-f]{64}$/.test(hash) || !/^[a-z0-9]{1,8}$/.test(ext)) throw new Error(`Not an asset file name: ${hash}.${ext}`)
    return path.join(this.dir, `${hash}.${ext}`)
  }

  has(hash: string, ext: string) {
    try {
      return fs.statSync(this.file(hash, ext)).isFile()
    } catch {
      return false
    }
  }

  /** Store bytes under their hash. An existing file with that name is kept as is. */
  put(bytes: Uint8Array, ext: string): { hash: string; file: string; size: number; added: boolean } {
    const hash = sha256Hex(bytes)
    const file = this.file(hash, ext)
    if (this.has(hash, ext)) return { hash, file, size: bytes.byteLength, added: false }
    writeFileAtomic(file, bytes)
    makeReadOnly(file)
    return { hash, file, size: bytes.byteLength, added: true }
  }

  /**
   * Store a file from disk (hashed in chunks, then copied). `expect` rejects a file whose hash differs; `link`
   * (only for another assets folder, whose files never change) hard-links when it can.
   */
  importFile(src: string, ext: string, expect?: string, opts: { link?: boolean } = {}): { hash: string; file: string; size: number; added: boolean } {
    const { hash, size } = hashFile(src)
    if (expect && hash !== expect) throw new Error(`${path.basename(src)} doesn't match its checksum`)
    const file = this.file(hash, ext)
    if (this.has(hash, ext)) return { hash, file, size, added: false }
    linkOrCopy(src, file, opts)
    return { hash, file, size, added: true }
  }

  /** Move a fully written temp file (in this folder, already hashed) into place. */
  adopt(tmp: string, hash: string, ext: string) {
    const file = this.file(hash, ext)
    if (this.has(hash, ext)) fs.rmSync(tmp, { force: true })
    else {
      fs.renameSync(tmp, file)
      makeReadOnly(file)
    }
    return file
  }

  /** Make a stored file available in another store (hard link, else copy). False if it isn't here. */
  copyTo(other: AssetStore, hash: string, ext: string) {
    if (other.has(hash, ext)) return true
    if (!this.has(hash, ext)) return false
    linkOrCopy(this.file(hash, ext), other.file(hash, ext), { link: true })
    return true
  }

  read(hash: string, ext: string) {
    return fs.readFileSync(this.file(hash, ext))
  }

  /** Re-hash a file; false when it is missing or its content no longer matches its name. */
  verify(hash: string, ext: string) {
    try {
      return hashFile(this.file(hash, ext)).hash === hash
    } catch {
      return false
    }
  }

  list(): StoredFile[] {
    let names: string[]
    try {
      names = fs.readdirSync(this.dir)
    } catch {
      return []
    }
    const out: StoredFile[] = []
    for (const name of names) {
      const m = name.match(ASSET_FILE_RE)
      if (!m) continue
      try {
        const st = fs.statSync(path.join(this.dir, name))
        if (st.isFile()) out.push({ hash: m[1], ext: m[2], name, file: path.join(this.dir, name), size: st.size, mtimeMs: st.mtimeMs })
      } catch {
        // removed meanwhile
      }
    }
    return out
  }

  remove(hash: string, ext: string) {
    const file = this.file(hash, ext)
    try {
      fs.chmodSync(file, 0o644)
    } catch {
      // gone already
    }
    fs.rmSync(file, { force: true })
  }

  /** Total bytes of the asset files (not the snippet working copies). */
  size() {
    return this.list().reduce((n, f) => n + f.size, 0)
  }
}

/** `Name.nodboard` → `Name.assets` in the same folder: the assets that travel with a board file. */
export function siblingAssetsDir(boardFile: string) {
  const dir = path.dirname(boardFile)
  const base = path.basename(boardFile).replace(/\.(nodboard|aifig)$/i, '')
  return path.join(dir, `${base}.assets`)
}
