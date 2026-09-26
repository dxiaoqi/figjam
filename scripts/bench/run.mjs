// Performance benchmark: cold start (core, web, desktop), open-board time (1k / 10k), frame timing for pan / zoom /
// hover / select / drag on a 10k board, memory, and Canvas API / MCP latency. Writes a JSON report and fails
// (exit 1) when a metric is over its budget in scripts/bench/budgets.json.
//
// usage: npm run bench [-- --quick] [--out=report.json] [--skip-desktop] [--skip-build] [--only=core,web,frames,mcp,desktop]
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium, _electron as electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const quick = !!args.quick
const only = args.only ? new Set(String(args.only).split(',')) : null
const want = (s) => !only || only.has(s)
const outFile = path.resolve(root, args.out ?? 'bench-results/latest.json')
const CHROME = process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d)
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null
}
const stats = (xs) => ({ p50: round(pct(xs, 50)), p95: round(pct(xs, 95)), max: round(Math.max(...xs)), n: xs.length })
const log = (...m) => console.error('[bench]', ...m)

// ---- setup -----------------------------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-bench-'))
const home = path.join(tmp, 'home')
fs.mkdirSync(home, { recursive: true })
const dist = path.join(root, 'apps/canvas/dist')
if (!args['skip-build'] || !fs.existsSync(dist)) {
  log('building the canvas app…')
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' })
}
log('generating fixtures…')
const fixtures = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/bench/fixtures.ts'), '200', '1000', '10000'], { cwd: root, env: { ...process.env, AIFIG_HOME: home }, encoding: 'utf8' }))
const fx = Object.fromEntries(fixtures.map((f) => [f.blocks, f]))

const report = {
  schema: 'aifig-bench/1',
  at: new Date().toISOString(),
  git: (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    } catch {
      return null
    }
  })(),
  machine: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGB: round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.arch()}`, node: process.version },
  quick,
  fixtures: fixtures.map(({ id, ...rest }) => rest),
  metrics: {},
}
const M = report.metrics

let portSeq = 48100 + Math.floor(Math.random() * 60) * 10
const nextPort = () => (portSeq += 3)
const rssMB = (pid) => {
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)
    return m ? round(Number(m[1]) / 1024) : null
  } catch {
    return null
  }
}

async function startCore(homeDir, port) {
  const t0 = performance.now()
  const proc = spawn(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'core', '--port', String(port)], { env: { ...process.env, AIFIG_HOME: homeDir, AIFIG_CORE_PORT: String(port) }, stdio: 'ignore' })
  for (let i = 0; i < 600; i++) {
    if (await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.ok, () => false)) break
    await sleep(5)
  }
  return { proc, port, base: `http://127.0.0.1:${port}`, ms: performance.now() - t0 }
}
const stopCore = (c) => new Promise((r) => (c.proc.exitCode !== null ? r() : (c.proc.once('exit', r), c.proc.kill())))

// ---- core cold start -----------------------------------------------------------------------------------

if (want('core')) {
  const runs = quick ? 2 : 4
  const empty = []
  const loaded = []
  for (let i = 0; i < runs; i++) {
    const h = path.join(tmp, `empty-${i}`)
    fs.mkdirSync(h)
    const c = await startCore(h, nextPort())
    empty.push(c.ms)
    await stopCore(c)
    const c2 = await startCore(home, nextPort())
    loaded.push(c2.ms)
    if (i === 0) M['memory.coreRssMB.boardsLoaded'] = rssMB(c2.proc.pid)
    await stopCore(c2)
  }
  M['coldStart.core.ms'] = round(median(empty))
  M['coldStart.coreWith11kBlocks.ms'] = round(median(loaded))
  log('core cold start', M['coldStart.core.ms'], 'ms; with 1k+10k boards', M['coldStart.coreWith11kBlocks.ms'], 'ms')
}

// ---- web: cold start, open board, frames, memory -------------------------------------------------------

const readyFn = () => {
  const c = document.querySelector('.ae-canvas')
  if (!c) return false
  if (c.getAttribute('data-lod') === 'canvas') return performance.now()
  return document.querySelector('.ae-block') ? performance.now() : false
}

async function waitReady(page, expected) {
  await page.waitForFunction(readyFn, null, { polling: 'raf', timeout: 60000 })
  if (expected) await page.waitForFunction((n) => window.editor && window.editor.blocks().length >= n, expected, { polling: 'raf', timeout: 60000 })
  // two frames: the fit-to-content camera and its paint
  return page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))))
}

if (want('web') || want('frames')) {
  const core = await startCore(home, nextPort())
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--enable-precise-memory-info'] })
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => log('page error:', e.message))
    return { ctx, page }
  }

  if (want('web')) {
    // warm the core's caches for the medium board, then measure a cold browser profile
    const cold = []
    for (let i = 0; i < (quick ? 2 : 4); i++) {
      const { ctx, page } = await newPage()
      await page.goto(`${core.base}/?board=${fx[200].id}`)
      cold.push(await waitReady(page))
      await ctx.close()
    }
    M['coldStart.web.ms'] = round(median(cold))
    log('web cold start (medium board, 200 blocks)', M['coldStart.web.ms'], 'ms')

    for (const n of [1000, 10000]) {
      const times = []
      for (let i = 0; i < (quick ? 2 : 3); i++) {
        const { ctx, page } = await newPage()
        await page.goto(`${core.base}/?board=${fx[n].id}&perf`)
        times.push(await waitReady(page, n))
        if (n === 10000 && i === 0) {
          const cdp = await ctx.newCDPSession(page)
          await page.waitForTimeout(1500)
          await cdp.send('HeapProfiler.collectGarbage')
          const heap = await cdp.send('Runtime.getHeapUsage')
          await cdp.send('Performance.enable')
          const pm = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
          M['memory.webHeapMB.board10k'] = round(heap.usedSize / 2 ** 20)
          M['memory.webDomNodes.board10k'] = pm.Nodes
        }
        await ctx.close()
      }
      M[`openBoard.${n === 1000 ? '1k' : '10k'}.ms`] = round(median(times))
      log(`open ${n}-block board`, M[`openBoard.${n === 1000 ? '1k' : '10k'}.ms`], 'ms')
    }
  }

  if (want('frames')) {
    const { ctx, page } = await newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.goto(`${core.base}/?board=${fx[10000].id}&perf`)
    await waitReady(page, 10000)
    await page.waitForTimeout(2500)
    const taskMs = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value * 1000

    // camera scenarios, driven once per animation frame
    const cameraRun = async (name, setup, frames, step) => {
      await page.evaluate(setup)
      await page.evaluate(() => new Promise((r) => setTimeout(r, 400)))
      const busy0 = await taskMs()
      const res = await page.evaluate(
        ({ frames, step }) =>
          new Promise((resolve) => {
            const fn = new Function('ed', 'i', step)
            const deltas = []
            let i = 0
            let last = 0
            const t0 = performance.now()
            const tick = (t) => {
              if (last) deltas.push(t - last)
              last = t
              if (i === frames) return resolve({ deltas, total: performance.now() - t0 })
              fn(window.editor, i++)
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }),
        { frames, step },
      )
      const busy = (await taskMs()) - busy0
      const fps = (res.deltas.length * 1000) / res.deltas.reduce((s, d) => s + d, 0)
      M[`frames.${name}.fps`] = round(fps)
      M[`frames.${name}.frameP95Ms`] = round(pct(res.deltas, 95))
      M[`frames.${name}.mainThreadMsPerFrame`] = round(busy / frames)
      log(`${name}: ${round(fps)} fps, p95 frame ${round(pct(res.deltas, 95))} ms, main thread ${round(busy / frames)} ms/frame`)
    }
    const F = quick ? 90 : 180
    // dense area at 100%: DOM rendering, crossing the pre-rendered region several times
    const at100 = `const ed = window.editor; ed.setCamera({ x: 200, y: 120, z: 1 })`
    await cameraRun('pan100', at100, F, `ed.panBy(-14, -6)`)
    // zoom out from 100% through the LOD threshold and back in, anchored at the viewport center
    await cameraRun('zoom', at100, F, `const k = ${F}; const t = i < k / 2 ? i / (k / 2) : (k - i) / (k / 2); ed.zoomAt({ x: 720, y: 450 }, Math.exp(Math.log(1) + (Math.log(0.08) - Math.log(1)) * t))`)
    // whole board in view: level-of-detail canvas
    await cameraRun('panFit', `window.editor.zoomToFit(false)`, F, `ed.panBy(-6, -3)`)
    await cameraRun('pan40', `const ed = window.editor; ed.setCamera({ x: 100, y: 60, z: 0.4 })`, F, `ed.panBy(-10, -5)`)

    // pointer scenarios through real (CDP) input; latency = event timestamp → end of the next rendered frame
    await page.evaluate(() => {
      window.__lat = []
      const rec = (e) => {
        const t0 = e.timeStamp
        requestAnimationFrame(() => {
          const ch = new MessageChannel()
          ch.port1.onmessage = () => window.__lat.push(performance.now() - t0)
          ch.port2.postMessage(0)
        })
      }
      for (const t of ['pointermove', 'pointerdown', 'pointerup']) window.addEventListener(t, rec, { capture: true })
    })
    const pointerRun = async (name, fn) => {
      await page.evaluate(() => (window.__lat = []))
      const busy0 = await taskMs()
      const events = await fn()
      await page.waitForTimeout(300)
      const busy = (await taskMs()) - busy0
      const lat = await page.evaluate(() => window.__lat)
      M[`input.${name}.p50Ms`] = round(pct(lat, 50))
      M[`input.${name}.p95Ms`] = round(pct(lat, 95))
      M[`input.${name}.mainThreadMsPerEvent`] = round(busy / Math.max(1, events))
      log(`${name}: input→frame p50 ${round(pct(lat, 50))} ms, p95 ${round(pct(lat, 95))} ms, main thread ${round(busy / Math.max(1, events))} ms/event`)
    }
    await page.evaluate(() => window.editor.setCamera({ x: 200, y: 120, z: 1 }))
    await page.waitForTimeout(500)
    const blockAt = (sel) =>
      page.evaluate((sel) => {
        const ed = window.editor
        const vp = ed.viewportPageBounds()
        const inView = ed.blocks().filter((b) => {
          const r = ed.pageRect(b.id)
          return b.kind === sel && r.x > vp.x + 60 && r.y > vp.y + 60 && r.x + r.w < vp.x + vp.w - 300 && r.y + r.h < vp.y + vp.h - 200
        })
        const b = inView[Math.floor(inView.length / 2)]
        const r = ed.pageRect(b.id)
        const p = ed.pageToScreen({ x: r.x + Math.min(r.w / 2, 40), y: r.y + Math.min(r.h / 2, 40) })
        return { id: b.id, x: p.x, y: p.y }
      }, sel)
    const moves = quick ? 40 : 80
    await pointerRun('hover', async () => {
      for (let i = 0; i < moves; i++) await page.mouse.move(80 + i * 14, 140 + (i % 10) * 50)
      return moves
    })
    await pointerRun('select', async () => {
      let n = 0
      for (let i = 0; i < (quick ? 8 : 16); i++) {
        await page.mouse.click(100 + (i % 8) * 150, 180 + Math.floor(i / 8) * 220)
        n += 3
      }
      return n
    })
    const sticky = await blockAt('sticky')
    await pointerRun('drag', async () => {
      await page.mouse.move(sticky.x, sticky.y)
      await page.mouse.down()
      for (let i = 1; i <= moves; i++) await page.mouse.move(sticky.x + i * 3, sticky.y + i * 2)
      await page.mouse.up()
      return moves + 3
    })
    await page.keyboard.press('Control+z')
    await page.evaluate(() => window.editor.setCamera({ x: 120, y: 80, z: 0.45 }))
    await page.waitForTimeout(500)
    const frame = await page.evaluate(() => {
      const ed = window.editor
      const f = ed.blocks().find((b) => b.kind === 'frame')
      const r = ed.pageRect(f.id)
      return ed.pageToScreen({ x: r.x + 40, y: r.y + 10 })
    })
    await pointerRun('dragFrame', async () => {
      await page.mouse.move(frame.x, frame.y)
      await page.mouse.down()
      for (let i = 1; i <= moves; i++) await page.mouse.move(frame.x + i * 3, frame.y + i * 2)
      await page.mouse.up()
      return moves + 3
    })
    await page.keyboard.press('Control+z')
    await page.evaluate(() => window.editor.setCamera({ x: 200, y: 120, z: 1 }))
    await page.waitForTimeout(400)
    await pointerRun('marquee', async () => {
      await page.mouse.move(1400, 880)
      await page.mouse.down()
      for (let i = 1; i <= moves / 2; i++) await page.mouse.move(1400 - i * 30, 880 - i * 18)
      await page.mouse.up()
      return moves / 2 + 2
    })
    await ctx.close()
  }
  await browser.close()
  await stopCore(core)
}

// ---- Canvas API over MCP (Streamable HTTP) -------------------------------------------------------------

if (want('mcp')) {
  const core = await startCore(home, nextPort())
  const client = new Client({ name: 'aifig-bench', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${core.base}/mcp`)))
  const call = async (name, args) => {
    const t0 = performance.now()
    const r = await client.callTool({ name, arguments: args })
    const ms = performance.now() - t0
    if (r.isError) throw new Error(`${name}: ${r.content?.[0]?.text}`)
    return ms
  }
  const words = 'fast onboarding offline first clear pricing calm review agent layout'.split(' ')
  const batch = (n, tag) => Array.from({ length: n }, (_, i) => ({ text: `${tag} ${words[i % words.length]} ${i}`, kind: i % 5 === 4 ? 'card' : 'sticky', title: i % 5 === 4 ? `Card ${i}` : undefined }))
  const runs = quick ? 4 : 10
  const created = await client.callTool({ name: 'create_board', arguments: { title: 'Bench empty' } })
  const emptyBoard = JSON.parse(created.content[0].text).board.id
  for (const [label, board] of [['emptyBoard', emptyBoard], ['board10k', fx[10000].id]]) {
    for (const n of [10, 100]) {
      const xs = []
      for (let i = 0; i < runs; i++) xs.push(await call('create_blocks', { board, blocks: batch(n, `b${i}`), frame: `Batch ${n}·${i}`, intent: 'bench' }))
      M[`mcp.createBlocks${n}.${label}.p50Ms`] = round(median(xs))
      M[`mcp.createBlocks${n}.${label}.p95Ms`] = round(pct(xs, 95))
      log(`create_blocks ×${n} on ${label}: p50 ${round(median(xs))} ms, p95 ${round(pct(xs, 95))} ms`)
    }
  }
  const board = fx[10000].id
  const time = async (name, a, reps = quick ? 2 : 4) => {
    const xs = []
    for (let i = 0; i < reps; i++) xs.push(await call(name, a))
    return round(median(xs))
  }
  M['mcp.getBoard.board10k.ms'] = await time('get_board', { board })
  M['mcp.lintLayout.board10k.ms'] = await time('lint_layout', { board })
  M['mcp.renderSnapshotSvg.board10k.ms'] = await time('render_snapshot', { board, format: 'svg' }, 2)
  M['mcp.renderSnapshotPng.frame.ms'] = await time('render_snapshot', { board, format: 'png', frame: fx[10000].firstFrame }, 2)
  M['mcp.renderSnapshotPng.board1k.ms'] = await time('render_snapshot', { board: fx[1000].id, format: 'png' }, 2)
  M['memory.coreRssMB.afterMcp'] = rssMB(core.proc.pid)
  log('get_board', M['mcp.getBoard.board10k.ms'], 'ms · lint', M['mcp.lintLayout.board10k.ms'], 'ms · snapshot svg', M['mcp.renderSnapshotSvg.board10k.ms'], 'ms')
  await client.close()
  await stopCore(core)
}

// ---- desktop cold start ------------------------------------------------------------------------------

if (want('desktop') && !args['skip-desktop']) {
  const bin = path.join(root, 'node_modules/electron/dist/electron')
  if (!fs.existsSync(bin)) log('electron not installed; skipping desktop cold start')
  else {
    const times = []
    for (let i = 0; i < (quick ? 1 : 3); i++) {
      const port = nextPort()
      fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ activeBoardId: fx[200].id }))
      const t0 = performance.now()
      const app = await electron.launch({
        executablePath: bin,
        args: [path.join(root, 'apps/desktop'), '--no-sandbox', `--user-data-dir=${path.join(tmp, `profile-${i}`)}`],
        env: { ...process.env, AIFIG_HOME: home, AIFIG_CORE_PORT: String(port), DISPLAY: process.env.DISPLAY ?? ':1' },
      })
      try {
        const win = await app.firstWindow()
        await win.waitForFunction(readyFn, null, { polling: 'raf', timeout: 60000 })
        await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        times.push(performance.now() - t0)
      } finally {
        await app.close().catch(() => {})
        // the desktop app leaves its core running for the CLI / MCP; stop it
        try {
          const pid = JSON.parse(fs.readFileSync(path.join(home, 'core.json'), 'utf8')).pid
          process.kill(pid)
        } catch {
          /* already gone */
        }
      }
    }
    M['coldStart.desktop.ms'] = round(median(times))
    log('desktop cold start (spawns its core, medium board)', M['coldStart.desktop.ms'], 'ms')
  }
}

// ---- budgets -------------------------------------------------------------------------------------------

const budgets = JSON.parse(fs.readFileSync(path.join(root, 'scripts/bench/budgets.json'), 'utf8'))
const results = []
for (const [key, rule] of Object.entries(budgets.metrics)) {
  const v = M[key]
  if (v == null) continue
  const ok = rule.max != null ? v <= rule.max : v >= rule.min
  results.push({ metric: key, value: v, ...(rule.max != null ? { max: rule.max } : { min: rule.min }), ok })
}
report.budgets = { failed: results.filter((r) => !r.ok).length, checked: results.length, results }
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(report, null, 2))
fs.rmSync(tmp, { recursive: true, force: true })

const w = Math.max(...results.map((r) => r.metric.length))
for (const r of results) console.error(`${r.ok ? '✓' : '✗'} ${r.metric.padEnd(w)}  ${String(r.value).padStart(8)}  ${r.max != null ? `≤ ${r.max}` : `≥ ${r.min}`}`)
console.error(`\n[bench] report: ${path.relative(root, outFile)} — ${results.length - report.budgets.failed}/${results.length} budgets met`)
process.stdout.write(`${JSON.stringify(report)}\n`)
process.exit(report.budgets.failed && !args['no-budgets'] ? 1 : 0)
