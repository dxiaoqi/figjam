// CI: typecheck, lint, every test suite and the bench budgets, one after another, with an isolated NODBOARD_HOME.
// usage: npm run ci [-- --only=typecheck,e2e] [--skip=desktop,bench] [--report=origin] [--out=ci-results]
//   Writes <out>/<step>.log, <out>/results.json and <out>/summary.md; exits 1 if any step failed.
//   --report=origin (or ORIGIN_CHECKS_TOKEN in the environment) posts one Origin check run per step; see README › CI.
//   Needs Node 22+, `npm ci` and Google Chrome at /usr/local/bin/google-chrome. The desktop step (and the bench's
//   desktop cold start) need a display (DISPLAY, e.g. Xvfb) and are skipped without one.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { originReporter } from './ci/origin-checks.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const list = (v) => (typeof v === 'string' ? new Set(v.split(',').map((s) => s.trim()).filter(Boolean)) : null)
const only = list(args.only)
const skip = list(args.skip) ?? new Set()
const outDir = path.resolve(root, typeof args.out === 'string' ? args.out : 'ci-results')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nodboard-ci-'))
const env = { ...process.env, NODBOARD_HOME: path.join(home, 'nodboard'), FORCE_COLOR: '0' }
delete env.NODBOARD_TOKEN
delete env.NODBOARD_CORE_PORT
delete env.NODBOARD_UI_PORT

const hasDisplay = process.platform === 'darwin' || process.platform === 'win32' || !!process.env.DISPLAY
/** `dev`: needs `npm run dev` (fixed ports 47820/47821) running against the CI home. */
const STEPS = [
  { id: 'typecheck', name: 'Typecheck', cmd: ['npm', 'run', '-s', 'typecheck'] },
  { id: 'lint', name: 'Lint', cmd: ['npm', 'run', '-s', 'lint'] },
  { id: 'api', name: 'Canvas API regressions', cmd: ['npm', 'run', '-s', 'test:api'] },
  { id: 'security', name: 'Security', cmd: ['npm', 'run', '-s', 'test:security'] },
  { id: 'data-safety', name: 'Data safety', cmd: ['npm', 'run', '-s', 'test:data-safety'] },
  { id: 'skills', name: 'Skills', cmd: ['npm', 'run', '-s', 'test:skills'] },
  { id: 'contrast', name: 'WCAG contrast', cmd: ['npm', 'run', '-s', 'test:contrast'] },
  { id: 'onboarding', name: 'Onboarding and i18n e2e', cmd: ['npm', 'run', '-s', 'test:onboarding'] },
  { id: 'sharing', name: 'Local files and sharing e2e', cmd: ['npm', 'run', '-s', 'test:sharing'] },
  { id: 'e2e', name: 'Canvas engine e2e', cmd: ['npm', 'run', '-s', 'test:e2e'], dev: true },
  { id: 'aesthetics', name: 'Agent-output aesthetics', cmd: ['npm', 'run', '-s', 'test:aesthetics'], dev: true },
  { id: 'mcp-stdio', name: 'MCP smoke (stdio)', cmd: ['node', 'scripts/mcp-smoke.mjs', '--quiet'], dev: true },
  { id: 'mcp-http', name: 'MCP smoke (HTTP)', cmd: ['node', 'scripts/mcp-http-smoke.mjs'], dev: true },
  { id: 'bench', name: 'Performance budgets', cmd: ['npm', 'run', '-s', 'bench', '--', ...(hasDisplay ? [] : ['--skip-desktop']), `--out=${path.join(outDir, 'bench.json')}`] },
  { id: 'desktop', name: 'Desktop e2e', cmd: ['node', 'scripts/desktop-e2e.mjs'], needsDisplay: true },
].filter((s) => (!only || only.has(s.id)) && !skip.has(s.id))

const report = originReporter({ enabled: args.report === 'origin' || !!process.env.ORIGIN_CHECKS_TOKEN, root, steps: STEPS })
await report.queued()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[ci]', ...a)

function run(step) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(path.join(outDir, `${step.id}.log`))
    const t0 = Date.now()
    const child = spawn(step.cmd[0], step.cmd.slice(1), { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const onData = (d) => {
      file.write(d)
      tail = (tail + d).slice(-20_000)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('close', (code) => {
      file.end()
      const failedChecks = tail.split('\n').filter((l) => l.startsWith('✗'))
      resolve({ code, ms: Date.now() - t0, tail, failedChecks })
    })
  })
}

let dev = null
async function startDev() {
  if (dev) return
  dev = spawn('npm', ['run', 'dev'], { cwd: root, env, stdio: ['ignore', fs.openSync(path.join(outDir, 'dev-server.log'), 'w'), fs.openSync(path.join(outDir, 'dev-server.log'), 'a')], detached: true })
  for (let i = 0; i < 120; i++) {
    const ok = await Promise.all([fetch('http://127.0.0.1:47820/').then((r) => r.ok, () => false), fetch('http://127.0.0.1:47821/api/health').then((r) => r.ok, () => false)])
    if (ok.every(Boolean)) return sleep(1500)
    await sleep(500)
  }
  throw new Error('npm run dev did not come up on 47820/47821 (see dev-server.log)')
}
function stopDev() {
  if (!dev) return
  try {
    process.kill(-dev.pid, 'SIGTERM')
  } catch {
    // already gone
  }
  dev = null
}
process.on('exit', stopDev)
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

const results = []
for (const step of STEPS) {
  if (step.needsDisplay && !hasDisplay) {
    log(`${step.name}: skipped (no display)`)
    results.push({ ...step, status: 'skipped', ms: 0, detail: 'No display (set DISPLAY, e.g. with Xvfb).' })
    await report.done(step, 'skipped', 'No display (set DISPLAY, e.g. with Xvfb).')
    continue
  }
  await report.started(step)
  let r
  try {
    if (step.dev) await startDev()
    else stopDev()
    log(`${step.name}…`)
    r = await run(step)
  } catch (e) {
    r = { code: 1, ms: 0, tail: String(e?.message ?? e), failedChecks: [] }
  }
  const ok = r.code === 0
  const detail = ok ? lastLine(r.tail) : [...r.failedChecks.slice(0, 20), '', ...r.tail.trim().split('\n').slice(-15)].join('\n').trim()
  log(`${step.name}: ${ok ? 'passed' : 'FAILED'} in ${(r.ms / 1000).toFixed(1)} s`)
  results.push({ ...step, status: ok ? 'passed' : 'failed', ms: r.ms, detail })
  await report.done(step, ok ? 'success' : 'failure', detail, r.ms)
}
stopDev()

function lastLine(s) {
  return (
    s
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .at(-1) ?? ''
  ).slice(0, 300)
}

const bench = fs.existsSync(path.join(outDir, 'bench.json')) ? JSON.parse(fs.readFileSync(path.join(outDir, 'bench.json'), 'utf8')) : null
const icon = { passed: '✅', failed: '❌', skipped: '⏭️' }
const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const summary = [
  `# CI ${git}`,
  '',
  '| Step | Result | Time |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${icon[r.status]} ${r.status} | ${(r.ms / 1000).toFixed(1)} s |`),
  '',
  ...(bench?.budgets ? [`Bench budgets: ${bench.budgets.checked - bench.budgets.failed}/${bench.budgets.checked} within budget.`, ...bench.budgets.results.filter((b) => !b.ok).map((b) => `- ${b.metric}: ${b.value} (${b.max != null ? `max ${b.max}` : `min ${b.min}`})`), ''] : []),
  ...results.filter((r) => r.status === 'failed').flatMap((r) => [`## ${r.name}`, '', '```', r.detail, '```', '']),
].join('\n')
fs.writeFileSync(path.join(outDir, 'summary.md'), summary)
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ commit: git, results: results.map(({ id, name, status, ms, detail }) => ({ id, name, status, ms, detail })), bench: bench?.budgets ?? null }, null, 2))
console.log(`\n${summary}`)
fs.rmSync(home, { recursive: true, force: true })
process.exit(results.some((r) => r.status === 'failed') ? 1 : 0)
