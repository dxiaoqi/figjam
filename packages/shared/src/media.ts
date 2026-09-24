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
