// Skill v1: format + validation, discovery/install, enable per board, skill types, layouts, L1 actions with
// permission prompts and the activity log, `aifig skill new/validate/dev`, "Save as block type", MCP exposure.
// usage: node scripts/skills-tests.mjs   (starts its own isolated core on a spare port with a temporary AIFIG_HOME)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 48010 + Math.floor(Math.random() * 40) * 2
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-skills-'))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-skill-work-'))
fs.writeFileSync(path.join(home, 'mcp.json'), JSON.stringify({ mcpServers: { web: { command: process.execPath, args: [path.join(root, 'tests/fixtures/mock-mcp-server.mjs')] } } }))
const env = { ...process.env, AIFIG_HOME: home, AIFIG_CORE_PORT: String(port) }
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const core = spawn(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'core', '--port', String(port)], { env, stdio: 'ignore' })
for (let i = 0; i < 100 && !(await fetch(`${base}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(100)
const HUMAN = { id: 'human:skills', name: 'You', client: 'test', kind: 'human' }
const AGENT = { id: `claude-code:${Date.now()}`, name: '', client: 'claude-code', kind: 'agent' }
const call = async (caller, tool, args = {}) => (await fetch(`${base}/api/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args, caller }) })).json()
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), ...args], { encoding: 'utf8', env })
const board = (await call(HUMAN, 'create_board', { title: 'Skills test' })).result.board.id
const get = async () => (await call(HUMAN, 'get_board', { board, format: 'json' })).result
const allBlocks = async () => {
  const g = await get()
  return [...g.blocks, ...g.frames.flatMap((f) => [f, ...f.children])]
}

// ---- discovery, format, exposure -------------------------------------------------------------
const list = (await call(AGENT, 'list_skills', { board })).result.skills
const rk = list.find((s) => s.name === 'research-kit')
const ck = list.find((s) => s.name === 'competitor-kit')
check('built-in research-kit and competitor-kit are discovered and valid', rk && ck && !rk.errors && !ck.errors && rk.capability === 'L1' && rk.types.length === 3, JSON.stringify(list.map((s) => [s.name, s.errors])))
check('list_skills says which tools are configured', rk.tools[0].name === 'web.search' && rk.tools[0].available === true && ck.tools[0].available === false, JSON.stringify([rk.tools, ck.tools]))
const gs = (await call(AGENT, 'get_skill', { name: 'research-kit' })).result
check('get_skill returns SKILL.md instructions, types with templates, layouts, prompts', gs.instructions.includes('# Research Kit') && gs.types.find((t) => t.id === 'research-kit.insight').template.rows.includes('confidence') && gs.layouts.some((l) => l.id === 'research-kit.opportunity-matrix') && gs.prompts[0].text.includes('query_blocks'))
const mcp = new Client({ name: 'skills-test', version: '1' })
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/aifig.mjs'), 'mcp'], env, stderr: 'ignore' }))
const resources = await mcp.listResources()
const skillRes = resources.resources.find((r) => r.uri === 'aifig://skills/research-kit/SKILL.md')
const read = skillRes ? await mcp.readResource({ uri: skillRes.uri }) : null
check('MCP exposes each skill’s SKILL.md as a resource', !!read && read.contents[0].text.includes('research-kit.quote'), resources.resources.map((r) => r.uri).join(', '))
const tools = (await mcp.listTools()).tools.map((t) => t.name)
check('MCP tools: list_skills, get_skill, apply_skill_layout, run_skill_action (enable stays human-only)', ['list_skills', 'get_skill', 'apply_skill_layout', 'run_skill_action'].every((t) => tools.includes(t)) && !tools.includes('enable_skill'))
const agentEnable = await call(AGENT, 'enable_skill', { board, name: 'research-kit' })
check('agents cannot enable skills themselves', !agentEnable.ok && agentEnable.error.includes('human'), agentEnable.error)

// ---- enable per board, skill types ----------------------------------------------------------
const before = await call(AGENT, 'create_blocks', { board, blocks: [{ text: 'x', type: 'research-kit.quote' }] })
check('skill types are unknown until the skill is enabled (warning, created plain)', before.result.warnings?.some((w) => w.includes('Unknown type "research-kit.quote"') && w.includes('list_skills')), JSON.stringify(before.result.warnings))
const en = await call(HUMAN, 'enable_skill', { board, name: 'research-kit' })
check('enabling a skill adds its types to the board', en.ok && en.result.types.includes('research-kit.insight'), en.error)
const lt = (await call(AGENT, 'list_types', { board })).result.types.map((t) => t.id)
check('list_types includes built-in and skill types', lt.includes('hypothesis') && lt.includes('research-kit.opportunity'))
const made = await call(AGENT, 'create_blocks', {
  board,
  frame: 'Synthesis',
  blocks: [
    { text: 'Setup took forever', type: 'research-kit.quote', fields: { participant: 'P1', stage: 'Setup' } },
    { text: 'I gave up after 20 minutes', type: 'research-kit.quote', fields: { participant: 'P4', stage: 'First board' } },
    { title: 'Setup is slower than expected', text: 'People give up.', type: 'research-kit.insight', fields: { theme: 'Onboarding', confidence: 'high', evidence: '3', stage: 'Setup' } },
    { title: 'HMW reach a first board in 5 minutes?', type: 'research-kit.opportunity', fields: { impact: 'high', effort: 'low' } },
    { title: 'HMW show progress while importing?', type: 'research-kit.opportunity', fields: { impact: 'medium', effort: 'low' } },
  ],
})
const created = made.result.created.filter((c) => c.kind !== 'frame')
const blocks1 = await allBlocks()
const insight = blocks1.find((b) => b.type === 'research-kit.insight')
check('create_blocks uses the skill type’s base (card) and color, and coerces number fields', insight.kind === 'card' && insight.color === 'purple' && insight.typeData['research-kit.insight'].evidence === 3, JSON.stringify(insight.typeData))
const badField = await call(AGENT, 'create_blocks', { board, blocks: [{ text: 'q', type: 'research-kit.quote', fields: { mood: 'x' } }] })
check('unknown skill-type fields are refused with the list of fields', !badField.ok && badField.error.includes('participant'), badField.error)
cli('--board', board, '--human', 'accept')
const q = (await call(AGENT, 'query_blocks', { board, type: 'research-kit.opportunity', where: { effort: 'low' } })).result
check('query_blocks works on skill types and fields', q.count === 2)
const conn = await call(AGENT, 'connect', { board, from: created[0].id, to: created[2].id })
cli('--board', board, '--human', 'accept')
const relation = (await get()).connectors.find((c) => c.id === conn.result.connectors[0]).relation
check('skill-declared relations are suggested (quote supports insight)', relation === 'supports', relation)

// ---- layouts ---------------------------------------------------------------------------------
const lay = await call(HUMAN, 'apply_skill_layout', { board, layout: 'research-kit.opportunity-matrix', frame: 'Synthesis' })
const lint = JSON.parse(cli('--json', '--board', board, 'lint').stdout)
const axes = (await allBlocks()).filter((b) => b.layoutRole === 'axis').map((b) => b.text)
check('a skill’s matrix layout arranges its blocks with axis labels, without overlaps', lay.ok && axes.some((t) => t.includes('high')) && axes.some((t) => t.includes('low')) && !lint.issues.some((i) => i.rule === 'overlap'), JSON.stringify({ err: lay.error, axes, issues: lint.issues.filter((i) => i.rule === 'overlap') }))
const tl = await call(HUMAN, 'create_blocks', { board, at: { x: 0, y: 1600 }, layout: 'timeline', blocks: [{ text: 'v2', date: '2026-06' }, { text: 'Beta', date: '2025-11' }, { text: 'v1', date: '2026-02' }] })
const tlBlocks = (await allBlocks()).filter((b) => tl.result.created.some((c) => c.id === b.id && c.kind === 'sticky')).sort((a, b) => a.x - b.x)
check('layout intent "timeline" orders by date and joins with arrows', tlBlocks.map((b) => b.text).join() === 'Beta,v1,v2' && tl.result.connectors.length === 2, tlBlocks.map((b) => b.text).join())
const fl = await call(HUMAN, 'create_blocks', { board, at: { x: 0, y: 2200 }, layout: 'flow', blocks: [{ text: 'Sign up' }, { text: 'Import' }, { text: 'First board' }, { text: 'Share' }] })
check('layout intent "flow" chains steps with arrows', fl.result.connectors.length === 3)
const mx = await call(HUMAN, 'create_blocks', { board, at: { x: 0, y: 2800 }, layout: 'matrix', blocks: [{ text: 'a', row: 'SMB', col: 'Cheap' }, { text: 'b', row: 'Enterprise', col: 'Premium' }, { text: 'c', row: 'SMB', col: 'Premium' }] })
const mxBlocks = (await allBlocks()).filter((b) => mx.result.created.some((c) => c.id === b.id))
const [a1, b1, c1] = ['a', 'b', 'c'].map((t) => mxBlocks.find((b) => b.text === t))
check('layout intent "matrix" places blocks by row × column with labels', a1.y === c1.y && c1.x === b1.x && a1.x < c1.x && mxBlocks.filter((b) => b.layoutRole === 'axis').length === 4)

// ---- disable keeps data ----------------------------------------------------------------------
await call(HUMAN, 'disable_skill', { board, name: 'research-kit' })
const afterOff = (await allBlocks()).find((b) => b.id === insight.id)
const md = (await call(HUMAN, 'export_board', { board, format: 'markdown' })).result.content
check('disabling keeps the blocks’ type and fields (shown as a stand-in)', afterOff.type === 'research-kit.insight' && afterOff.typeData['research-kit.insight'].theme === 'Onboarding' && md.includes('Insight'), md.slice(0, 80))
await call(HUMAN, 'enable_skill', { board, name: 'research-kit' })

// ---- L1: permission prompt, activity log --------------------------------------------------------
await call(HUMAN, 'load_dev_skill', { path: path.join(root, 'tests/fixtures/skills/probe-kit') })
await call(HUMAN, 'enable_skill', { board, name: 'probe-kit' })
const probe = (await call(HUMAN, 'create_blocks', { board, at: { x: 1600, y: 0 }, blocks: [{ title: 'Onboarding benchmarks', type: 'probe-kit.probe', fields: { level: 2 } }] })).result.created[0].id
const r1 = (await call(AGENT, 'run_skill_action', { board, skill: 'probe-kit', action: 'search', ids: [probe] })).result
const pend = (await call(HUMAN, 'list_activity', { board })).result
check('first use of a tool asks the person (needs_permission, prompt pending)', r1.status === 'needs_permission' && pend.pending.length === 1 && pend.pending[0].tools[0] === 'web.search', JSON.stringify(r1))
const g1 = (await call(HUMAN, 'grant_skill_permission', { board, request: r1.request, decision: 'allow_once' })).result
const ideas = (await allBlocks()).filter((b) => b.type === 'idea' && b.pending)
check('“Allow once” runs the action: results arrive as blocks for review', g1.result?.status === 'ok' && ideas.length === 3 && ideas.some((b) => b.text.includes('Source B')), JSON.stringify(g1.result))
const r2 = (await call(AGENT, 'run_skill_action', { board, skill: 'probe-kit', action: 'search', ids: [probe] })).result
check('“Allow once” is consumed: the next call asks again', r2.status === 'needs_permission')
const g2 = (await call(HUMAN, 'grant_skill_permission', { board, request: r2.request, decision: 'allow_board' })).result
const r3 = (await call(AGENT, 'run_skill_action', { board, skill: 'probe-kit', action: 'search', ids: [probe] })).result
check('“Always allow on this board” runs later calls directly', g2.result?.status === 'ok' && r3.status === 'ok', JSON.stringify(r3))
await call(HUMAN, 'revoke_skill_permission', { board, skill: 'probe-kit', tool: 'web.search' })
const r4 = (await call(AGENT, 'run_skill_action', { board, skill: 'probe-kit', action: 'search', ids: [probe] })).result
await call(HUMAN, 'grant_skill_permission', { board, request: r4.request, decision: 'deny' })
const act = (await call(HUMAN, 'list_activity', { board, skill: 'probe-kit' })).result.activity
check('revoking asks again; denying runs nothing', r4.status === 'needs_permission' && act[0].status === 'denied')
check('the activity log records enable, requests, decisions and tool calls', ['enable', 'permission', 'tool'].every((k) => act.some((e) => e.kind === k)) && act.filter((e) => e.kind === 'tool' && e.status === 'ok').length === 3, act.map((e) => `${e.kind}:${e.status}`).join(' '))
const noTool = await call(AGENT, 'run_skill_action', { board, skill: 'competitor-kit', action: 'fetch-homepage', ids: [probe] })
check('actions of skills not enabled, or with unconfigured tools, fail clearly', !noTool.ok && noTool.error.includes('not enabled'), noTool.error)

// ---- aifig skill new / validate / dev (hot reload) -----------------------------------------------
const nw = cli('skill', 'new', 'persona-kit', '--dir', work)
const kit = path.join(work, 'persona-kit')
check('`aifig skill new` scaffolds a valid skill', nw.status === 0 && fs.existsSync(path.join(kit, 'SKILL.md')) && fs.existsSync(path.join(kit, 'canvas/blocks.json')), nw.stdout + nw.stderr)
const blocksPath = path.join(kit, 'canvas/blocks.json')
const good = fs.readFileSync(blocksPath, 'utf8')
const broken = JSON.parse(good)
broken.types.item.color = 'magenta'
broken.types.item.template.rows.push('nope')
broken.layouts.push({ id: 'x', label: 'X', intent: 'matrix' })
fs.writeFileSync(blocksPath, JSON.stringify(broken))
const v = cli('skill', 'validate', kit)
check('`aifig skill validate` reports problems with their location', v.status === 1 && v.stdout.includes('canvas/blocks.json › types.item.color') && v.stdout.includes('"nope" is not one of this type\'s fields') && v.stdout.includes('needs "rows" and "cols"'), v.stdout)
fs.writeFileSync(blocksPath, good)
const dev = spawn(process.execPath, [path.join(root, 'bin/aifig.mjs'), '--board', board, 'skill', 'dev', kit, '--enable'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let devOut = ''
dev.stdout.on('data', (d) => (devOut += d))
for (let i = 0; i < 50 && !devOut.includes('enabled persona-kit'); i++) await sleep(100)
const withField = JSON.parse(good)
withField.types.item.fields.push({ key: 'due', label: 'Due', kind: 'text' })
fs.writeFileSync(blocksPath, JSON.stringify(withField, null, 2))
let reloaded = false
for (let i = 0; i < 40 && !reloaded; i++) {
  await sleep(100)
  reloaded = (await call(HUMAN, 'list_types', { board })).result.types.find((t) => t.id === 'persona-kit.item')?.fields.some((f) => f.key === 'due')
}
check('`aifig skill dev` hot-reloads changes into boards that use the skill', reloaded, devOut.split('\n').slice(-3).join(' | '))
fs.writeFileSync(blocksPath, '{ "types": ')
await sleep(900)
const kept = (await call(HUMAN, 'list_types', { board })).result.types.find((t) => t.id === 'persona-kit.item')
check('a broken save shows the error and keeps the last good version', devOut.includes('not valid JSON') && kept?.fields.some((f) => f.key === 'due'), devOut.split('\n').slice(-3).join(' | '))
dev.kill()
fs.writeFileSync(blocksPath, JSON.stringify(withField, null, 2))
const inst = await call(HUMAN, 'install_skill', { path: kit })
check('installing copies a skill into ~/.aifig/skills', inst.ok && fs.existsSync(path.join(home, 'skills/persona-kit/SKILL.md')), inst.error)

// ---- no-code "Save as block type" ------------------------------------------------------------------
const vendor = (await call(HUMAN, 'create_blocks', { board, at: { x: 2400, y: 0 }, blocks: [{ kind: 'card', title: 'Acme Boards', text: 'Price: $49/mo\nSegment: SMB\nOpen source: no' }] })).result.created[0].id
const saved = await call(HUMAN, 'save_block_type', { board, block: vendor, label: 'Vendor', color: 'teal', icon: 'Store' })
const vb = (await allBlocks()).find((b) => b.id === vendor)
const skillDir = saved.result?.path
const exported = skillDir ? spawnSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'skill', 'validate', skillDir], { encoding: 'utf8', env }) : null
check('“Save as block type” infers fields and types the block', saved.ok && saved.result.fields.map((f) => `${f.key}:${f.kind}`).join() === 'price:number,segment:text,open_source:boolean' && vb.type === saved.result.type && vb.typeData[saved.result.type].price === 49, JSON.stringify(saved.error ?? saved.result?.fields))
check('…and writes a standard skill folder that validates', exported?.status === 0 && fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').startsWith('---\nname: skills-test-types'), exported?.stdout)
const zip = Buffer.from(await (await fetch(`${base}${saved.result.export}`)).arrayBuffer())
check('…which downloads as a zip', zip.subarray(0, 2).toString() === 'PK' && zip.includes(Buffer.from('skills-test-types/SKILL.md')), `${zip.length} bytes`)

await mcp.close()
core.kill()
fs.rmSync(home, { recursive: true, force: true })
fs.rmSync(work, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed` : '\nall skill checks passed')
process.exit(failures ? 1 : 0)
