import type { Asset, AssetRole, Block } from './model'

/** Natural size and mime of PNG / JPEG / GIF / WebP bytes, from their headers. */
export function imageInfo(b: Uint8Array): { mime: string; w: number; h: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1]
  const u16le = (i: number) => b[i] | (b[i + 1] << 8)
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))
  if (b.length > 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return { mime: 'image/png', w: u32be(16), h: u32be(20) }
  if (b.length > 10 && ascii(0, 3) === 'GIF') return { mime: 'image/gif', w: u16le(6), h: u16le(8) }
  if (b.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4)
    if (kind === 'VP8 ') return { mime: 'image/webp', w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff }
    if (kind === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      return { mime: 'image/webp', w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8X') return { mime: 'image/webp', w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      const len = u16be(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { mime: 'image/jpeg', w: u16be(i + 7), h: u16be(i + 5) }
      i += 2 + len
    }
  }
  return null
}

export function bytesToBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Plain text for measurement and exports: drops Markdown markers, keeps list bullets. */
export function stripMarkdown(md: string) {
  return (md ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_](?!\s)(.+?)(?<!\s)[*_](?=[^*\w]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
}

// ---- asset files -------------------------------------------------------------------


const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'text/html': 'html',
  'text/css': 'css',
  'text/javascript': 'js',
}
const MIME_BY_EXT: Record<string, string> = { ...Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m])), jpeg: 'image/jpeg', m4v: 'video/mp4' }

export const VIDEO_MIMES = ['video/mp4', 'video/webm']
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export const ASSET_LIMITS = {
  imageBytes: 25 * 1024 * 1024,
  videoBytes: 1024 * 1024 * 1024,
  /** poster frames and snippet previews */
  posterBytes: 4 * 1024 * 1024,
}

export const extForMime = (mime: string) => EXT_BY_MIME[mime.split(';')[0].trim().toLowerCase()] ?? 'bin'
export const mimeForExt = (ext: string) => MIME_BY_EXT[ext.replace(/^\./, '').toLowerCase()] ?? 'application/octet-stream'

/** File name of an asset inside an assets folder. */
export const assetFileName = (a: Pick<Asset, 'hash' | 'ext'>) => `${a.hash}.${a.ext}`
export const ASSET_FILE_RE = /^([0-9a-f]{64})\.([a-z0-9]{1,8})$/

/** Id of a new asset entry: derived from the content, so adding the same file twice reuses one entry. */
export const assetIdFor = (hash: string) => `a${hash.slice(0, 16)}`

export const SNIPPET_ROLES: Record<'html' | 'css' | 'js', AssetRole> = { html: 'snippet-html', css: 'snippet-css', js: 'snippet-js' }
/** How a snippet's source files are named and typed. */
export const SNIPPET_FILES = { html: { name: 'index.html', mime: 'text/html' }, css: { name: 'style.css', mime: 'text/css' }, js: { name: 'script.js', mime: 'text/javascript' } } as const
export type SnippetPart = keyof typeof SNIPPET_FILES

/** Asset ids a block refers to (image, video, poster, snippet source and preview). */
export function blockAssetRefs(b: Pick<Block, 'asset' | 'poster' | 'web'>): string[] {
  const out: string[] = []
  if (b.asset) out.push(b.asset)
  if (b.poster) out.push(b.poster)
  if (b.web?.thumb) out.push(b.web.thumb)
  const s = b.web?.src
  if (s) for (const id of [s.html, s.css, s.js]) if (id) out.push(id)
  return out
}

export function formatBytes(n: number, locale = 'en') {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString(locale, { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`
}

/** Reads `len` bytes at `pos` (fewer at the end of the file). */
export type ByteReader = (pos: number, len: number) => Uint8Array

/**
 * Size and duration of an MP4 (ISO BMFF) or WebM (Matroska) video from its container headers, reading only
 * the boxes / elements it needs (the `moov` box may sit after gigabytes of media data).
 */
export function videoInfo(read: ByteReader, size: number): { mime: string; w: number; h: number; duration?: number } | null {
  const head = read(0, Math.min(size, 64))
  const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') return mp4Info(read, size)
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return webmInfo(read(0, Math.min(size, 2 * 1024 * 1024)))
  return null
}

function mp4Info(read: ByteReader, size: number) {
  const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  const type = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])
  let w = 0
  let h = 0
  let duration: number | undefined
  const walk = (start: number, end: number, depth: number) => {
    let pos = start
    while (pos + 8 <= end && depth < 6) {
      const hdr = read(pos, 16)
      if (hdr.length < 8) return
      let len = u32(hdr, 0)
      const t = type(hdr, 4)
      let body = pos + 8
      if (len === 1) {
        len = u32(hdr, 8) * 2 ** 32 + u32(hdr, 12)
        body = pos + 16
      } else if (len === 0) len = end - pos
      if (len < 8) return
      if (t === 'moov' || t === 'trak') walk(body, Math.min(pos + len, end), depth + 1)
      else if (t === 'mvhd') {
        const b = read(body, 32)
        const v1 = b[0] === 1
        const scale = u32(b, v1 ? 20 : 12)
        const dur = v1 ? u32(b, 24) * 2 ** 32 + u32(b, 28) : u32(b, 16)
        if (scale) duration = dur / scale
      } else if (t === 'tkhd' && !w) {
        const b = read(pos + len - 8, 8)
        const tw = u32(b, 0) >>> 16
        const th = u32(b, 4) >>> 16
        if (tw && th) {
          w = tw
          h = th
        }
      }
      pos += len
    }
  }
  walk(0, size, 0)
  return w && h ? { mime: 'video/mp4', w, h, ...(duration ? { duration } : {}) } : null
}

function webmInfo(b: Uint8Array) {
  const vint = (i: number, keepMarker: boolean): [number, number] | null => {
    const first = b[i]
    if (first === undefined || first === 0) return null
    let len = 1
    while (!(first & (0x80 >> (len - 1)))) len++
    if (len > 8 || i + len > b.length) return null
    let v = keepMarker ? first : first & (0xff >> len)
    let allOnes = v === (keepMarker ? first : 0xff >> len)
    for (let k = 1; k < len; k++) {
      v = v * 256 + b[i + k]
      if (b[i + k] !== 0xff) allOnes = false
    }
    return [keepMarker || !allOnes ? v : -1, len]
  }
  const MASTER = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0])
  let w = 0
  let h = 0
  let scale = 1_000_000
  let dur: number | undefined
  const readUint = (i: number, n: number) => {
    let v = 0
    for (let k = 0; k < n; k++) v = v * 256 + b[i + k]
    return v
  }
  const walk = (start: number, end: number) => {
    let pos = start
    while (pos < end) {
      const id = vint(pos, true)
      if (!id) return
      const sz = vint(pos + id[1], false)
      if (!sz) return
      const body = pos + id[1] + sz[1]
      const bodyEnd = sz[0] < 0 ? end : Math.min(end, body + sz[0])
      if (id[0] === 0x1f43b675) return
      if (MASTER.has(id[0])) walk(body, bodyEnd)
      else if (id[0] === 0xb0) w = readUint(body, bodyEnd - body)
      else if (id[0] === 0xba) h = readUint(body, bodyEnd - body)
      else if (id[0] === 0x2ad7b1) scale = readUint(body, bodyEnd - body)
      else if (id[0] === 0x4489) {
        const dv = new DataView(b.buffer, b.byteOffset + body, bodyEnd - body)
        dur = bodyEnd - body === 4 ? dv.getFloat32(0) : dv.getFloat64(0)
      }
      if (sz[0] < 0) return
      pos = bodyEnd
    }
  }
  const header = vint(0, true)
  const hs = header && vint(header[1], false)
  if (!header || !hs) return null
  walk(header[1] + hs[1] + hs[0], b.length)
  return w && h ? { mime: 'video/webm', w, h, ...(dur ? { duration: (dur * scale) / 1e9 } : {}) } : null
}
