// Canvas API regressions (MCP test report 2026-09-25): board resolution, snapping, colors, warnings, arg shapes, exports.
// usage: node scripts/api-regressions.mjs   (starts its own isolated core on a spare port with a temporary AIFIG_HOME)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 47930 + Math.floor(Math.random() * 40) * 2
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-regress-'))
const env = { ...process.env, AIFIG_HOME: home, AIFIG_CORE_PORT: String(port) }
let core
const startCore = async () => {
  core = spawn(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'core', '--port', String(port)], { env, stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) return
    await sleep(100)
  }
  throw new Error('core did not start')
}
const stopCore = () => new Promise((r) => (core.once('exit', r), core.kill()))
await startCore()
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const HUMAN = { id: 'human:regress', name: 'You', client: 'test', kind: 'human' }
const agent = (n) => ({ id: `regress-agent:${n}:${Date.now()}`, name: 'Regress Bot', client: 'regress', kind: 'agent' })
const call = async (caller, tool, args = {}) => (await fetch(`${base}/api/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args, caller }) })).json()
const tag = Date.now().toString(36)

// ---- bug 1: default board resolution -------------------------------------------------
const A = (await call(HUMAN, 'create_board', { title: `Regress A ${tag}` })).result.board.id
const B = (await call(HUMAN, 'create_board', { title: `Regress B ${tag}` })).result.board.id
const canvas = async (board) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/sync/${board}`)
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
  return { ws, view: (focused) => ws.send(JSON.stringify({ type: 'viewport', bounds: { x: 0, y: 0, w: 1200, h: 800 }, focused })) }
}
const cA = await canvas(A)
const cB = await canvas(B)
cA.view(true)
await sleep(100)
for (let i = 0; i < 5; i++) {
  cB.view(false)
  await sleep(20)
}
const active1 = (await (await fetch(`${base}/api/boards`)).json()).active
check('bug 1: an unfocused canvas on another board does not steal the default board', active1 === A, active1)

const s1 = agent(1)
const made = (await call(s1, 'create_blocks', { board: B, blocks: [{ text: 'one' }, { text: 'two' }, { text: 'three' }, { text: 'four' }], changeSet: undefined })).result
const ids = made.created.map((c) => c.id)
const upd = await call(s1, 'update_blocks', { updates: ids.map((id) => ({ id, text: 'edited' })) })
check('bug 1: follow-up calls without `board` stay on the board this session just wrote (all 4 ids found)', upd.ok && upd.result.board === B && !upd.result.warnings, JSON.stringify(upd.error ?? upd.result.warnings ?? upd.result.board))

const s2 = agent(2)
const amb = (await call(s2, 'get_board', {})).result
check('bug 1: an ambiguous default (two canvases on different boards) returns a warning', amb.warnings?.some((w) => w.includes('boards are open') && w.includes('Pass `board`')), JSON.stringify(amb.warnings))
cB.view(true)
await sleep(100)
const again = (await call(s2, 'get_board', { format: 'json' })).result
check('bug 1: within a session the default stays put even if the focused canvas changes', again.board.id === A && !again.warnings, again.board?.id)
const state = JSON.parse(fs.readFileSync(path.join((await (await fetch(`${base}/api/health`)).json()).home, 'state.json'), 'utf8'))
check('bug 1: the active board is persisted (survives a core restart)', state.activeBoardId === B, JSON.stringify(state))
cA.ws.close()
cB.ws.close()
await sleep(100)
const s3 = agent(3)
const none = { ...(await call(s3, 'get_board', {})).result, board: (await call(s3, 'get_board', { format: 'json' })).result.board.id }
check('bug 1: with no canvas open, the default is the last active board — with a warning', none.board === B && none.warnings?.some((w) => w.includes('no canvas is open')), JSON.stringify(none.warnings))
await stopCore()
await startCore()
const afterRestart = (await call(agent(4), 'get_board', { format: 'json' })).result
check('bug 1: after a core restart the default is still the last active board', afterRestart.board.id === B, afterRestart.board?.id)

// ---- bug 2: rotation snaps to 15° with an escape hatch ------------------------------------
const rid = ids[0]
const r1 = (await call(HUMAN, 'update_blocks', { board: B, updates: [{ id: rid, rotation: 37 }] })).result
const rot1 = (await call(HUMAN, 'get_board', { board: B, format: 'json' })).result.blocks.find((b) => b.id === rid).rotation
check('bug 2: rotation snaps to 15° and says so', rot1 === 30 && r1.warnings?.some((w) => w.includes('37°→30°')), `${rot1} ${JSON.stringify(r1.warnings)}`)
await call(HUMAN, 'update_blocks', { board: B, snap: false, updates: [{ id: rid, rotation: 37, x: 101 }] })
const b2 = (await call(HUMAN, 'get_board', { board: B, format: 'json' })).result.blocks.find((b) => b.id === rid)
check('bug 2: `snap: false` keeps exact rotation and position', b2.rotation === 37 && b2.x === 101, `${b2.rotation} ${b2.x}`)

// ---- bug 3: unknown colors warn; strict mode errors -----------------------------------------
const c1 = (await call(HUMAN, 'update_blocks', { board: B, updates: [{ id: ids[1], color: 'magenta2' }] })).result
check('bug 3: an unknown color falls back with a warning', c1.warnings?.some((w) => w.includes('Unknown color "magenta2"')), JSON.stringify(c1.warnings))
const c2 = await call(HUMAN, 'update_blocks', { board: B, strict: true, updates: [{ id: ids[1], color: 'magenta2' }] })
check('bug 3: strict mode refuses unknown colors', !c2.ok && c2.error.includes('Unknown color'), c2.error)
const c3 = (await call(HUMAN, 'create_blocks', { board: B, at: { x: 2000, y: 2000 }, blocks: [{ text: 'hex', color: '#ff0000' }] })).result
check('bug 3: hex colors say which token they mapped to', c3.warnings?.some((w) => w.includes('#ff0000') && w.includes('nearest token')), JSON.stringify(c3.warnings))

// ---- DX: warnings for silent adjustments ------------------------------------------------------
const g = (await call(HUMAN, 'update_blocks', { board: B, updates: [{ id: ids[2], x: 101, y: 203 }] })).result
check('DX 3: 8px snapping of coordinates is reported', g.warnings?.some((w) => w.includes('x 101→104') && w.includes('y 203→200')), JSON.stringify(g.warnings))
const f = (await call(HUMAN, 'create_blocks', { board: B, at: { x: 3000, y: 3000 }, frame: `F ${tag}`, blocks: [{ text: 'in frame' }] })).result
const ai = (await call(HUMAN, 'create_blocks', { board: B, inside: f.frame, at: { x: 5, y: 5 }, blocks: [{ text: 'x' }] })).result
check('DX 2: `at` together with `inside` is reported as ignored', ai.warnings?.some((w) => w.includes('`at` is ignored together with `inside`')), JSON.stringify(ai.warnings))

// ---- DX 1: both argument shapes for connectors --------------------------------------------------
const flat = await call(HUMAN, 'connect', { board: B, from: ids[0], to: ids[1], label: 'flat' })
const arr = await call(HUMAN, 'connect', { board: B, connectors: [{ from: ids[1], to: ids[2] }] })
check('DX 1: connect accepts a single from/to or a connectors array', flat.ok && arr.ok && flat.result.connectors.length === 1 && arr.result.connectors.length === 1, flat.error ?? arr.error)
const cid = flat.result.connectors[0]
const per = await call(HUMAN, 'update_connectors', { board: B, connectors: [{ id: cid, route: 'elbow', waypoints: [{ x: 101, y: 50 }] }] })
const same = await call(HUMAN, 'update_connectors', { board: B, ids: [arr.result.connectors[0]], route: 'straight' })
const conns = (await call(HUMAN, 'get_board', { board: B, format: 'json' })).result.connectors
check('DX 1: update_connectors accepts per-connector items or ids + shared fields', per.ok && same.ok && conns.find((c) => c.id === cid).route === 'elbow' && conns.find((c) => c.id === arr.result.connectors[0]).route === 'straight', per.error ?? same.error)
check('DX 3: waypoint snapping is reported', per.result.warnings?.some((w) => w.includes('waypoint 1.x 101→104')), JSON.stringify(per.result.warnings))

// ---- DX 6: self-contained exports ----------------------------------------------------------------
const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
await call(HUMAN, 'add_image', { board: B, data: png1x1, at: { x: 4000, y: 0 } })
const mdLink = (await call(HUMAN, 'export_board', { board: B, format: 'markdown' })).result.content
const mdInline = (await call(HUMAN, 'export_board', { board: B, format: 'markdown', images: 'inline' })).result.content
check('DX 6: Markdown export can inline images as data: URIs', mdInline.includes('](data:image/png;base64,') && !mdLink.includes('data:image'))
const mcp = new Client({ name: 'regress', version: '1' })
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/aifig.mjs'), 'mcp'], env, stderr: 'ignore' }))
const listed = (await mcp.listTools()).tools
check('bug 1: tool descriptions recommend passing `board`', listed.filter((t) => t.inputSchema.properties?.board).every((t) => String(t.inputSchema.properties.board.description).includes('always pass it')), `${listed.length} tools`)
const raw = await mcp.callTool({ name: 'render_snapshot', arguments: { board: B, format: 'svg', raw: true } })
const wrapped = await mcp.callTool({ name: 'render_snapshot', arguments: { board: B, format: 'svg' } })
check('DX 6: render_snapshot can return raw SVG text (default stays JSON)', raw.content[0].text.startsWith('<svg') && wrapped.content[0].text.startsWith('{'), raw.content[0].text.slice(0, 20))
const mw = await mcp.callTool({ name: 'update_blocks', arguments: { board: B, updates: [{ id: ids[3], color: 'chartreuse-ish' }] } })
check('warnings reach MCP clients in the tool result', mw.content[0].text.includes('"warnings"') && mw.content[0].text.includes('Unknown color'))
await mcp.close()
const cli = spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), '--board', B, '--human', 'update', ids[3], '--color', 'nope'], { encoding: 'utf8', env })
check('the CLI prints warnings', cli.stderr.includes('⚠ Unknown color "nope"'), cli.stderr.trim().slice(0, 120))

await stopCore()
fs.rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed` : '\nall API regression checks passed')
process.exit(failures ? 1 : 0)
