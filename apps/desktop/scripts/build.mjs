// Builds the desktop app: canvas UI + single-file CLI/core/MCP bundle + bundled main process + installers.
//
// usage: node apps/desktop/scripts/build.mjs [--dir] [--linux] [--win] [--mac] [--x64] [--arm64] [--skip-ui]
//   no platform flag  → the host platform;  no arch flag → the host arch (macOS: x64 and arm64)
//   --dir             → unpacked app only (fastest, for smoke tests)
// Everything the app needs at runtime is inside the package: no Node or npm on the user's machine.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { loadDistribution } from '../../../scripts/release/config.mjs'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(desktop, '../..')
const out = path.join(desktop, 'build')
const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })
const rel = (p) => path.relative(root, p)

const hostPlatform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]
const platforms = ['linux', 'win', 'mac'].filter((p) => flag(`--${p}`))
if (!platforms.length) platforms.push(hostPlatform)
const archFlags = ['x64', 'arm64'].filter((a) => flag(`--${a}`))
const archsFor = (p) => (archFlags.length ? archFlags : p === 'mac' ? ['x64', 'arm64'] : [process.arch === 'arm64' ? 'arm64' : 'x64'])

const dist = loadDistribution()
const version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version

fs.rmSync(path.join(out, 'app'), { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'app'), { recursive: true })
fs.mkdirSync(path.join(out, 'resources'), { recursive: true })

if (!flag('--skip-ui')) {
  console.log('› building the canvas UI')
  run('npm', ['run', 'build', '-w', '@aifig/canvas'])
}

const esm = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __fu } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      'const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);',
    ].join(' '),
  },
}

console.log('› bundling the CLI / core / MCP server')
await build({
  ...esm,
  entryPoints: [path.join(root, 'packages/cli/src/index.ts')],
  outfile: path.join(out, 'aifig.mjs'),
  external: ['@resvg/resvg-js', 'bufferutil', 'utf-8-validate'],
})

console.log('› bundling the main process')
await build({
  ...esm,
  entryPoints: [path.join(desktop, 'src/main.mjs')],
  outfile: path.join(out, 'app/main.mjs'),
  external: ['electron'],
})
for (const f of ['preload.cjs', 'snippet-preload.cjs']) fs.copyFileSync(path.join(desktop, 'src', f), path.join(out, 'app', f))
// runtime URLs baked into the package (env vars and ~/.aifig/config.json can still override them)
fs.writeFileSync(path.join(out, 'app/distribution.json'), JSON.stringify({ version, telemetryUrl: dist.telemetryUrl, updateFeedUrl: dist.updateFeedUrl }, null, 2))

console.log('› rendering icons')
{
  const { Resvg } = await import('@resvg/resvg-js')
  const svg = fs.readFileSync(path.join(desktop, 'resources/icon.svg'))
  for (const size of [1024, 512, 256]) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
    fs.writeFileSync(path.join(out, 'resources', size === 1024 ? 'icon.png' : `icon-${size}.png`), png)
  }
}

// ---- the resvg native module for each target platform/arch --------------------------------------
const RESVG_TRIPLES = {
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
  'win32-x64': 'win32-x64-msvc',
  'win32-arm64': 'win32-arm64-msvc',
  'linux-x64': 'linux-x64-gnu',
  'linux-arm64': 'linux-arm64-gnu',
}
const resvgVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@resvg/resvg-js/package.json'), 'utf8')).version

function stageNative(platform, arch) {
  const key = `${platform}-${arch}`
  const pkg = `@resvg/resvg-js-${RESVG_TRIPLES[key]}`
  const dest = path.join(out, 'native', key, 'node_modules/@resvg')
  fs.rmSync(path.join(out, 'native', key), { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(path.join(root, 'node_modules/@resvg/resvg-js'), path.join(dest, 'resvg-js'), { recursive: true, dereference: true })
  const local = path.join(root, 'node_modules', pkg)
  const target = path.join(dest, path.basename(pkg))
  if (fs.existsSync(local)) return fs.cpSync(local, target, { recursive: true, dereference: true })
  // not installed on this host (another OS/arch): fetch the exact version from the registry
  const cache = path.join(out, 'native-cache')
  fs.mkdirSync(cache, { recursive: true })
  const tgz = path.join(cache, `${path.basename(pkg)}-${resvgVersion}.tgz`)
  if (!fs.existsSync(tgz)) {
    console.log(`  fetching ${pkg}@${resvgVersion}`)
    const name = execFileSync('npm', ['pack', `${pkg}@${resvgVersion}`, '--silent', '--pack-destination', cache], { cwd: cache, encoding: 'utf8' }).trim().split('\n').pop()
    fs.renameSync(path.join(cache, name), tgz)
  }
  fs.mkdirSync(target, { recursive: true })
  run('tar', ['xzf', tgz, '-C', target, '--strip-components=1'])
}

const nodePlatform = { mac: 'darwin', win: 'win32', linux: 'linux' }
for (const p of platforms) for (const a of archsFor(p)) stageNative(nodePlatform[p], a)

// ---- package --------------------------------------------------------------------------------------
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version
const env = { ...process.env, AIFIG_UPDATE_URL: dist.updateFeedUrl }
for (const p of platforms) {
  const archs = archsFor(p)
  console.log(`› packaging ${p} (${archs.join(', ')})${flag('--dir') ? ' — unpacked' : ''}`)
  const args = ['electron-builder', '--projectDir', desktop, '--config', 'electron-builder.config.cjs', `--${p}`, ...archs.map((a) => `--${a}`), '--publish', 'never', '-c.electronVersion', electronVersion]
  if (flag('--dir')) args.push('--dir')
  // one arch per NSIS installer, so each gets its own file (a combined one would be twice the download);
  // x64 goes last so latest.yml (the Windows update feed) points at the x64 installer
  if (p === 'win' && archs.length > 1 && !flag('--dir')) {
    for (const a of [...archs].sort((x) => (x === 'x64' ? 1 : -1))) run('npx', ['electron-builder', ...args.slice(1).filter((x) => !archs.includes(x.slice(2))), `--${a}`], { env })
  } else run('npx', args, { env })
}
console.log(`✓ desktop build in ${rel(path.join(desktop, 'release'))}`)
