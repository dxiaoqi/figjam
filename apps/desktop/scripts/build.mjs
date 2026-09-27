// Builds the desktop app: canvas UI + a single-file CLI/core/MCP bundle + electron-builder package.
// usage: node apps/desktop/scripts/build.mjs [--dir]   (--dir: unpacked app only, fastest)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(desktop, '../..')
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })
// build-time feature flags, baked into the UI (Vite reads the same env), the core bundle and the shell
const features = { assistant: process.env.AIFIG_FEATURE_ASSISTANT === '1' }

console.log('› building the canvas UI')
run('npm', ['run', 'build', '-w', '@aifig/canvas'])

console.log('› bundling the CLI / core / MCP server')
fs.mkdirSync(path.join(desktop, 'build'), { recursive: true })
await build({
  entryPoints: [path.join(root, 'packages/cli/src/index.ts')],
  outfile: path.join(desktop, 'build/aifig.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@resvg/resvg-js', 'bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: { __AIFIG_FEATURES__: JSON.stringify(features) },
  logLevel: 'info',
})
fs.writeFileSync(path.join(desktop, 'build/features.json'), `${JSON.stringify(features)}\n`)

console.log('› packaging with electron-builder')
const args = ['electron-builder', '--projectDir', desktop, '--config.electronVersion', JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version]
if (process.argv.includes('--dir')) args.push('--dir')
run('npx', args)
console.log(`✓ desktop build in ${path.join(desktop, 'release')}`)
