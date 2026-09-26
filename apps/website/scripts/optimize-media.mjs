// Writes an 800px-wide `<name>-800.webp` next to every screenshot in public/media, so
// phones download a quarter of the pixels. Idempotent: skips variants that are newer than their source.
// usage: node scripts/optimize-media.mjs [--force]
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const force = process.argv.includes('--force')
const dirs = ['../public/media/'].map((d) => fileURLToPath(new URL(d, import.meta.url)))

for (const dir of dirs) {
  let files
  try {
    files = readdirSync(dir)
  } catch {
    continue
  }
  for (const f of files) {
    if (!f.endsWith('.webp') || /-\d+\.webp$/.test(f)) continue
    const src = join(dir, f)
    const out = join(dir, f.replace(/\.webp$/, '-800.webp'))
    try {
      if (!force && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue
    } catch {}
    const { width } = await sharp(src).metadata()
    if (!width || width <= 800) continue
    const info = await sharp(src).resize({ width: 800 }).webp({ quality: 80, effort: 6 }).toFile(out)
    console.log(`${f} → ${out.split('/').pop()} (${Math.round(info.size / 1024)} KB)`)
  }
}
