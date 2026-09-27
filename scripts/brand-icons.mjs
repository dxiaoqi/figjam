// Regenerates every icon raster from the SVG sources in assets/brand/ (icon.svg, icon-small.svg, mark.svg).
// usage: node scripts/brand-icons.mjs
//   apps/desktop/resources/  icon.icns (macOS), icon.ico (Windows 16–256), icons/<n>x<n>.png (Linux 16–1024),
//                            tray/ (color 16/32 and macOS template 16/32)
//   apps/canvas/public/      favicon.svg, favicon.ico, apple-touch-icon.png
//   apps/website/public/     favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png
// The OG images embed the icon too: regenerate them with `npx tsx apps/website/scripts/og-images.mts`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { flat, markIn, master, small, smallOnMacGrid } from '../assets/brand/variants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'apps/desktop/resources')
const canvas = path.join(root, 'apps/canvas/public')
const website = path.join(root, 'apps/website/public')

const render = (svg, size) => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())
// the detailed icon turns to mush below 48px; the small tile is drawn for 16–32
const app = (size) => render(size <= 32 ? small() : flat(), size)
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  console.log(`  ${path.relative(root, file)}`)
}

/** ICO with PNG entries (Windows Vista+). */
function ico(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(([size, png], i) => {
    const e = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, e)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(png.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...entries.map(([, png]) => png)])
}

/** ICNS with PNG entries (macOS 10.7+). */
function icns(entries) {
  const chunks = entries.map(([type, png]) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

console.log('› desktop')
const mac = (size) => render(size <= 32 ? smallOnMacGrid() : master(), size)
const ICNS_SLOTS = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 }
const macPng = {}
write(path.join(desktop, 'icon.icns'), icns(Object.entries(ICNS_SLOTS).map(([type, size]) => [type, (macPng[size] ??= mac(size))])))
write(path.join(desktop, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((s) => [s, app(s)])))
for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) write(path.join(desktop, `icons/${s}x${s}.png`), app(s))
write(path.join(desktop, 'tray/tray.png'), render(small(), 16))
write(path.join(desktop, 'tray/tray@2x.png'), render(small(), 32))
write(path.join(desktop, 'tray/trayTemplate.png'), render(markIn('#000000'), 16))
write(path.join(desktop, 'tray/trayTemplate@2x.png'), render(markIn('#000000'), 32))

for (const [name, dir] of [['canvas', canvas], ['website', website]]) {
  console.log(`› ${name}`)
  write(path.join(dir, 'favicon.svg'), small())
  write(path.join(dir, 'favicon.ico'), ico([16, 32, 48].map((s) => [s, app(s)])))
  write(path.join(dir, 'apple-touch-icon.png'), render(flat({ square: true }), 180))
}
write(path.join(website, 'icon-192.png'), render(flat(), 192))
write(path.join(website, 'icon-512.png'), render(flat(), 512))
