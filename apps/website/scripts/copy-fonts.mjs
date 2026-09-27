// Copies the Latin subset of Inter (variable) from @fontsource-variable/inter into public/fonts, so the site can
// preload one self-hosted file. Runs before `dev` and `build`; the copy isn't committed.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const src = createRequire(import.meta.url).resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')
const dir = fileURLToPath(new URL('../public/fonts/', import.meta.url))
mkdirSync(dir, { recursive: true })
copyFileSync(src, `${dir}inter-latin.woff2`)
