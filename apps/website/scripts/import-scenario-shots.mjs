// Imports scenario screenshots named <skill>-<lang>.png (lang: zh, zh-CN or en) from a folder: converts them to
// WebP in public/media/scenarios (1600px wide plus an 800px variant) and rewrites src/lib/scenario-shots.ts, so
// each scenario page shows its screenshot instead of the illustration. Missing files keep the illustration.
// usage: node scripts/import-scenario-shots.mjs <dir>
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const skills = ['arch-kit', 'research-kit', 'product-kit', 'prototype-kit', 'lit-kit']
const langs = { zh: ['zh', 'zh-CN', 'zh-cn'], en: ['en', 'en-US', 'en-us'] }

const dir = process.argv[2]
if (!dir || !existsSync(dir)) {
  console.error('usage: node scripts/import-scenario-shots.mjs <dir with <skill>-<lang>.png>')
  process.exit(1)
}
const out = fileURLToPath(new URL('../public/media/scenarios/', import.meta.url))
const manifest = fileURLToPath(new URL('../src/lib/scenario-shots.ts', import.meta.url))
mkdirSync(out, { recursive: true })

const files = readdirSync(dir)
const found = {}
const missing = []
for (const skill of skills) {
  for (const [locale, names] of Object.entries(langs)) {
    const file = names.map((n) => `${skill}-${n}.png`).find((n) => files.includes(n))
    const key = `${skill}-${locale}`
    if (!file) {
      missing.push(`${skill}-${locale}.png`)
      continue
    }
    const src = sharp(join(dir, file))
    const { width = 0 } = await src.metadata()
    const full = await src.clone().resize({ width: Math.min(width, 1600) }).webp({ quality: 82, effort: 6 }).toFile(join(out, `${key}.webp`))
    await src.clone().resize({ width: 800 }).webp({ quality: 80, effort: 6 }).toFile(join(out, `${key}-800.webp`))
    found[key] = [full.width, full.height]
    console.log(`${file} → media/scenarios/${key}.webp (${full.width}×${full.height})`)
  }
}

const entries = Object.entries(found)
  .map(([k, [w, h]]) => `  '${k}': [${w}, ${h}],`)
  .join('\n')
writeFileSync(
  manifest,
  `/**
 * Real scenario screenshots in public/media/scenarios (WebP, plus a -800 variant), keyed \`<skill>-<locale>\`.
 * Written by \`node scripts/import-scenario-shots.mjs <dir>\`; a scenario without an entry shows its illustration.
 */
export const scenarioShots: Record<string, readonly [number, number]> = {${entries ? `\n${entries}\n` : ''}}
`,
)
console.log(`${Object.keys(found).length} imported${missing.length ? `; missing: ${missing.join(', ')}` : ''}`)
