import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Uint8Array, prev = 0) {
  let c = (prev ^ 0xffffffff) >>> 0
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  data: Uint8Array
  /** Keep as is (already-compressed media); otherwise deflate. */
  store?: boolean
}

/** Zip archives are limited to 4 GB without ZIP64; packs and exports stay well under this. */
export const ZIP_MAX_BYTES = 2 ** 32 - 1

/** Build a zip from entries (names use `/`, UTF-8), deflating text and storing media. */
export function zipEntries(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  const time = ((new Date().getHours() << 11) | (new Date().getMinutes() << 5) | (new Date().getSeconds() >> 1)) & 0xffff
  const d = new Date()
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  for (const f of entries) {
    const name = Buffer.from(f.name, 'utf8')
    const raw = Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength)
    const packed = f.store ? raw : zlib.deflateRawSync(raw, { level: 6 })
    const method = f.store ? 0 : 8
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + packed.length
    if (offset > ZIP_MAX_BYTES) throw new Error('The archive would be larger than 4 GB')
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** Zip a folder (deflate), with every entry under `root/` — enough to hand someone a skill folder. */
export function zipFolder(dir: string, root: string): Buffer {
  const files: { name: string; data: Buffer }[] = []
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.DS_Store') continue
      const abs = path.join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(abs, r)
      else if (e.isFile()) files.push({ name: `${root}/${r}`, data: fs.readFileSync(abs) })
    }
  }
  walk(dir, '')
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const packed = zlib.deflateRawSync(f.data)
    const crc = crc32(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(f.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/**
 * Write a zip to disk entry by entry: text is deflated in memory, files are stored and copied in chunks (their
 * CRC is computed in a first pass), so a pack holding a large video never has to fit in memory.
 */
export class ZipWriter {
  private fd: number
  private offset = 0
  private centrals: Buffer[] = []
  private count = 0
  private readonly time: number
  private readonly date: number

  constructor(readonly file: string) {
    this.fd = fs.openSync(file, 'w', 0o644)
    const d = new Date()
    this.time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff
    this.date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  }

  private write(buf: Buffer) {
    let off = 0
    while (off < buf.length) off += fs.writeSync(this.fd, buf, off, buf.length - off)
    this.offset += buf.length
    if (this.offset > ZIP_MAX_BYTES) throw new Error('The archive would be larger than 4 GB')
  }

  private header(name: Buffer, method: number, crc: number, packed: number, size: number) {
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(this.time, 10)
    local.writeUInt16LE(this.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(this.time, 12)
    central.writeUInt16LE(this.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(this.offset, 42)
    this.centrals.push(central, name)
    this.count++
    this.write(Buffer.concat([local, name]))
  }

  addBuffer(entryName: string, data: Uint8Array, store = false) {
    const name = Buffer.from(entryName, 'utf8')
    const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const packed = store ? raw : zlib.deflateRawSync(raw, { level: 6 })
    this.header(name, store ? 0 : 8, crc32(raw), packed.length, raw.length)
    this.write(packed)
  }

  addFile(entryName: string, file: string) {
    const name = Buffer.from(entryName, 'utf8')
    const src = fs.openSync(file, 'r')
    try {
      const size = fs.fstatSync(src).size
      const buf = Buffer.allocUnsafe(1 << 20)
      let crc = 0
      for (let pos = 0; pos < size; ) {
        const n = fs.readSync(src, buf, 0, Math.min(buf.length, size - pos), pos)
        if (!n) throw new Error(`${file} changed while it was being packed`)
        crc = crc32(buf.subarray(0, n), crc)
        pos += n
      }
      this.header(name, 0, crc, size, size)
      for (let pos = 0; pos < size; ) {
        const n = fs.readSync(src, buf, 0, Math.min(buf.length, size - pos), pos)
        this.write(buf.subarray(0, n))
        pos += n
      }
    } finally {
      fs.closeSync(src)
    }
  }

  finish() {
    const cd = Buffer.concat(this.centrals)
    const start = this.offset
    this.write(cd)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(this.count, 8)
    end.writeUInt16LE(this.count, 10)
    end.writeUInt32LE(cd.length, 12)
    end.writeUInt32LE(start, 16)
    this.write(end)
    fs.fsyncSync(this.fd)
    fs.closeSync(this.fd)
    return this.offset
  }

  abort() {
    try {
      fs.closeSync(this.fd)
    } catch {
      // already closed
    }
    fs.rmSync(this.file, { force: true })
  }
}
