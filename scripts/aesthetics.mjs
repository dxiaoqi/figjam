// Agent-output aesthetics regression set (§6.8): replays fixed agent sessions over real MCP against an isolated core,
// checks lint_layout, renders snapshots and compares them to committed baselines.
// usage: node scripts/aesthetics.mjs [--update] [--only name]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { scenarios } from '../tests/aesthetics/scenarios.mjs'
import { authHeaders } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'tests/aesthetics')
const baselines = path.join(dir, 'baselines')
const output = path.join(dir, 'output')
const update = process.argv.includes('--update')
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const MAX_DIFF = 0.002 // share of pixels allowed to differ
const STRICT_RULES = ['overlap', 'outside-frame', 'off-grid', 'too-many-colors', 'text-overflow', 'empty-block']
fs.mkdirSync(baselines, { recursive: true })
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })

// isolated core
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nodboard-aesthetics-'))
const port = String(47861 + Math.floor(Math.random() * 100))
const env = { ...process.env, NODBOARD_HOME: home, NODBOARD_CORE_PORT: port, NODBOARD_NO_AUTOSTART: '1' }
const core = spawn(process.execPath, [path.join(root, 'bin/nodboard.mjs'), 'core'], { env, stdio: 'ignore' })
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 200))
  try {
    if ((await fetch(`http://127.0.0.1:${port}/api/health`, { headers: authHeaders(home) })).ok) break
  } catch {
    /* starting */
  }
}

const client = new Client({ name: 'claude-code', version: 'aesthetics' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/nodboard.mjs'), 'mcp'], env, stderr: 'inherit' }))
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  if (r.isError) throw new Error(`${name}: ${text}`)
  return { content: r.content, json: (() => { try { return JSON.parse(text) } catch { return null } })() }
}

const rows = []
let failed = 0
for (const s of scenarios) {
  if (only && s.name !== only) continue
  const row = { name: s.name, lint: '', pixels: '', status: 'pass' }
  try {
    const board = (await call('create_board', { title: s.title })).json.board.id
    for (const step of s.steps) await call(step.tool, { board, ...step.args })
    // review as a person would, so snapshots show the final look rather than the suggestion layer
    const reviewed = await fetch(`http://127.0.0.1:${port}/api/call`, { method: 'POST', headers: authHeaders(home), body: JSON.stringify({ tool: 'review_change_set', args: { board, id: 'all', action: 'accept' }, caller: { id: 'human:aesthetics', name: 'Reviewer', client: 'test', kind: 'human' } }) }).then((r) => r.json())
    if (!reviewed.ok) throw new Error(`review failed: ${reviewed.error}`)
    const lint = (await call('lint_layout', { board })).json
    const strict = lint.issues.filter((i) => STRICT_RULES.includes(i.rule))
    row.lint = strict.length ? strict.map((i) => `${i.rule}: ${i.message}`).join('; ') : 'clean'
    if (strict.length) row.status = 'fail'
    const img = (await call('render_snapshot', { board })).content.find((c) => c.type === 'image')
    const png = Buffer.from(img.data, 'base64')
    fs.writeFileSync(path.join(output, `${s.name}.png`), png)
    const basePath = path.join(baselines, `${s.name}.png`)
    if (update || !fs.existsSync(basePath)) {
      fs.writeFileSync(basePath, png)
      row.pixels = update ? 'baseline updated' : 'new baseline'
    } else {
      const a = PNG.sync.read(fs.readFileSync(basePath))
      const b = PNG.sync.read(png)
      if (a.width !== b.width || a.height !== b.height) {
        row.pixels = `size changed ${a.width}×${a.height} → ${b.width}×${b.height}`
        row.status = 'fail'
      } else {
        const diff = new PNG({ width: a.width, height: a.height })
        const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 })
        const share = n / (a.width * a.height)
        row.pixels = `${(share * 100).toFixed(3)}% differ`
        if (share > MAX_DIFF) {
          row.status = 'fail'
          fs.writeFileSync(path.join(output, `${s.name}.diff.png`), PNG.sync.write(diff))
        }
      }
    }
  } catch (e) {
    row.status = 'fail'
    row.lint = String(e.message ?? e)
  }
  if (row.status === 'fail') failed++
  rows.push(row)
  console.log(`${row.status === 'pass' ? '✓' : '✗'} ${row.name.padEnd(22)} lint: ${row.lint.slice(0, 80).padEnd(10)}  ${row.pixels}`)
}

const report = [
  '# Agent output aesthetics — regression report',
  '',
  `Run ${new Date().toISOString()} · ${rows.length} scenarios · ${failed} failing`,
  '',
  '| Scenario | Lint | Snapshot vs baseline | Result |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.lint} | ${r.pixels} | ${r.status === 'pass' ? '✓' : '✗'} |`),
  '',
  'Snapshots are in `tests/aesthetics/output/`; diffs are written next to them for failing scenarios.',
].join('\n')
fs.writeFileSync(path.join(output, 'report.md'), report)
await client.close()
core.kill()
await new Promise((r) => setTimeout(r, 400))
try {
  fs.rmSync(home, { recursive: true, force: true })
} catch {
  /* the core may still be flushing */
}
console.log(failed ? `\n${failed} scenario(s) failed — see tests/aesthetics/output/report.md` : '\nall aesthetics scenarios pass')
process.exit(failed ? 1 : 0)
