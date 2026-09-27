// Imports the scenario screenshots from a folder into public/media/scenarios (WebP, 1600px wide plus 800px and
// 2400px variants) and rewrites src/lib/scenario-shots.ts with their sizes:
//   <skill>-<lang>.png            key frame of the board        → <skill>-<lang>.webp
//   <skill>-<lang>-overview.png   the whole board               → <skill>-<lang>-overview.webp
//   scenarios-dialog-<lang>.png   New board ▸ Scenarios          → scenarios-dialog-<lang>.webp
// lang is zh (or zh-CN) or en. Fails if any file is missing.
// usage: node scripts/import-scenario-shots.mjs <dir>
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const skills = ['arch-kit', 'research-kit', 'product-kit', 'prototype-kit', 'lit-kit']
const langs = { zh: ['zh', 'zh-CN', 'zh-cn'], en: ['en'] }

const dir = process.argv[2]
if (!dir || !existsSync(dir)) {
  console.error('usage: node scripts/import-scenario-shots.mjs <dir>')
  process.exit(1)
}
const out = fileURLToPath(new URL('../public/media/scenarios/', import.meta.url))
const manifest = fileURLToPath(new URL('../src/lib/scenario-shots.ts', import.meta.url))
mkdirSync(out, { recursive: true })

const files = readdirSync(dir)
const wanted = []
for (const locale of Object.keys(langs)) {
  for (const skill of skills) wanted.push([`${skill}-${locale}`, (l) => `${skill}-${l}.png`], [`${skill}-${locale}-overview`, (l) => `${skill}-${l}-overview.png`])
  wanted.push([`scenarios-dialog-${locale}`, (l) => `scenarios-dialog-${l}.png`])
}

const found = {}
const missing = []
for (const [key, name] of wanted) {
  const locale = key.includes('-zh') ? 'zh' : 'en'
  const file = langs[locale].map(name).find((n) => files.includes(n))
  if (!file) {
    missing.push(name(locale))
    continue
  }
  const src = sharp(join(dir, file))
  const { width = 0 } = await src.metadata()
  const full = await src.clone().resize({ width: Math.min(width, 1600) }).webp({ quality: 82, effort: 6 }).toFile(join(out, `${key}.webp`))
  await src.clone().resize({ width: 800 }).webp({ quality: 80, effort: 6 }).toFile(join(out, `${key}-800.webp`))
  if (width >= 2400) await src.clone().resize({ width: 2400 }).webp({ quality: 78, effort: 6 }).toFile(join(out, `${key}-2400.webp`))
  found[key] = [full.width, full.height]
  console.log(`${file} → media/scenarios/${key}.webp (${Math.round(full.size / 1024)} KB)`)
}
if (missing.length) {
  console.error(`missing: ${missing.join(', ')}`)
  process.exit(1)
}

writeFileSync(
  manifest,
  `/** Scenario screenshots in public/media/scenarios (WebP, plus -800 and -2400 variants). Written by scripts/import-scenario-shots.mjs. */
export const scenarioShots = {
${Object.entries(found)
  .map(([k, [w, h]]) => `  '${k}': [${w}, ${h}],`)
  .join('\n')}
} as const satisfies Record<string, readonly [number, number]>

export type ScenarioShotName = keyof typeof scenarioShots
`,
)
console.log(`${Object.keys(found).length} imported`)
