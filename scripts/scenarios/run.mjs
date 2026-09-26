// Scenario runs: an agent connected over MCP follows each scenario skill's SKILL.md end to end on an isolated
// core, a person reviews, and the result is checked (arch-kit maps this repo, research-kit synthesizes three
// interviews, product-kit goes from competitors to a PRD, prototype-kit builds three interactive variants,
// lit-kit builds an argument map from five papers).
// usage: node scripts/scenarios/run.mjs [--only=arch-kit,research-kit] [--lang=en|zh-CN|all] [--samples] [--out=dir]
//   --samples  write each finished board to skills/builtin/<skill>/examples/sample.<lang>.aifig
//   --out      also write a PNG snapshot of each board there
import fs from 'node:fs'
import path from 'node:path'
import { checker, connectAgent, readSkill, root, startCore, toolsNamedIn } from './lib.mjs'
import * as arch from './arch-kit.mjs'
import * as research from './research-kit.mjs'
import * as product from './product-kit.mjs'

const SCENARIOS = [arch, research, product]
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const only = arg('only')?.split(',')
const langs = (arg('lang') ?? 'all') === 'all' ? ['en', 'zh-CN'] : [arg('lang')]
const out = arg('out')
const samples = process.argv.includes('--samples')
if (out) fs.mkdirSync(out, { recursive: true })

const core = await startCore()
const results = []
try {
  for (const sc of SCENARIOS.filter((s) => !only || only.includes(s.skill))) {
    for (const lang of langs) {
      const { check, results: r } = checker(`[${sc.skill} ${lang}]`)
      const agent = await connectAgent(core.env)
      try {
        const { board } = await sc.run({ core, agent, lang, check, out })
        const named = toolsNamedIn(readSkill(sc.skill))
        const used = new Set(agent.log)
        const skipped = [...named].filter((t) => !used.has(t) && !(sc.optionalTools ?? []).includes(t))
        check('the run exercised every tool its SKILL.md workflow names', !skipped.length, skipped.length ? `not called: ${skipped.join(', ')}` : `${named.size} tools`)
        const lint = await core.human('lint_layout', { board })
        const pending = (await core.human('list_change_sets', { board })).changeSets.filter((c) => c.status === 'pending' || c.status === 'open')
        check('the finished board is lint-clean and fully reviewed', lint.issues.length === 0 && !pending.length, lint.issues.map((i) => i.message).slice(0, 2).join(' | '))
        if (out) {
          const snap = await core.snapshot(board)
          const img = snap.content.find((c) => c.type === 'image')
          if (img) fs.writeFileSync(path.join(out, `${sc.skill}-${lang}.png`), Buffer.from(img.data, 'base64'))
        }
        if (samples) {
          const tmp = path.join(core.home, `${sc.skill}-${lang}.aifig`)
          await core.human('save_file', { board, path: tmp })
          const dest = path.join(root, 'skills/builtin', sc.skill, 'examples', `sample.${lang}.aifig`)
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.copyFileSync(tmp, dest)
          console.log(`  wrote ${path.relative(root, dest)} (${Math.round(fs.statSync(dest).size / 1024)} KB)`)
        }
      } catch (e) {
        check('runs without errors', false, e.message)
      } finally {
        await agent.close()
      }
      results.push(...r)
    }
  }
} finally {
  core.stop()
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n${failed.length} scenario check(s) failed` : `\nall ${results.length} scenario checks passed`)
process.exit(failed.length ? 1 : 0)
