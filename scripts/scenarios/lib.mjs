// Shared harness for the scenario runs: an isolated core, an MCP agent over stdio (like Claude Code), a person
// reviewing through the Canvas API, and checks.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { authedFetch } from '../lib/core-auth.mjs'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const fixtures = path.join(root, 'tests/fixtures/scenarios')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function startCore() {
  const port = 48110 + Math.floor(Math.random() * 40) * 2
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nodboard-scenarios-'))
  const env = { ...process.env, NODBOARD_HOME: home, NODBOARD_CORE_PORT: String(port) }
  delete env.NODBOARD_TOKEN
  const proc = spawn(process.execPath, [path.join(root, 'bin/nodboard.mjs'), 'core', '--port', String(port)], { env, stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 150 && !(await fetch(`${base}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(100)
  const PERSON = { id: 'human:scenario', name: 'You', client: 'test', kind: 'human' }
  /** A person using the canvas / CLI: direct edits, reviews, comments. Throws on errors. */
  const human = async (tool, args = {}) => {
    const r = await (await authedFetch(`${base}/api/call`, { method: 'POST', body: JSON.stringify({ tool, args, caller: PERSON }) }, home)).json()
    if (!r.ok) throw new Error(`${tool}: ${r.error}`)
    return r.result
  }
  const snapshot = async (board) => {
    const r = await (await authedFetch(`${base}/api/call`, { method: 'POST', body: JSON.stringify({ tool: 'render_snapshot', args: { board }, caller: PERSON }) }, home)).json()
    return { content: r.image ? [{ type: 'image', ...r.image }] : [] }
  }
  return {
    home,
    port,
    env,
    human,
    snapshot,
    stop: () => {
      proc.kill()
      try {
        fs.rmSync(home, { recursive: true, force: true })
      } catch {
        /* the core may still be flushing */
      }
    },
  }
}

/** An agent connected over MCP stdio, the way Claude Code or Cursor connect. `tool()` returns the parsed result. */
export async function connectAgent(env, name = 'claude-code') {
  const client = new Client({ name, version: '1.0.0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/nodboard.mjs'), 'mcp'], env, stderr: 'ignore' }))
  const log = []
  const tool = async (toolName, args = {}) => {
    const r = await client.callTool({ name: toolName, arguments: args })
    const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    log.push(toolName)
    if (r.isError) throw new Error(`${toolName}: ${text}`)
    try {
      return JSON.parse(text)
    } catch {
      return { text, content: r.content }
    }
  }
  /** A call whose result has images (render_snapshot): the raw MCP content. */
  const raw = async (toolName, args = {}) => {
    log.push(toolName)
    return client.callTool({ name: toolName, arguments: args })
  }
  return { client, tool, raw, log, close: () => client.close() }
}

export function checker(prefix) {
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name: `${prefix} ${name}`, ok: !!ok, detail })
    console.log(`${ok ? '✓' : '✗'} ${prefix} ${name}${detail ? ` — ${detail}` : ''}`)
  }
  return { check, results }
}

/** Blocks of a board (frames flattened), from get_board json. */
export async function blocksOf(tool, board) {
  const g = await tool('get_board', { board, format: 'json' })
  return { board: g, blocks: [...g.blocks, ...g.frames.flatMap((f) => [f, ...f.children])], connectors: g.connectors ?? [] }
}

/** Which SKILL.md steps a run exercised: every tool the workflow names should have been called. */
export function toolsNamedIn(skillMd) {
  const names = new Set()
  for (const m of skillMd.matchAll(/`(create_board|get_skill|get_board|begin_change_set|commit_change_set|create_blocks|connect|set_type|apply_skill_layout|lint_layout|render_snapshot|export_board|query_blocks|create_snippet|update_snippet|get_threads|reply_thread|resolve_thread|list_change_sets|delete_blocks|set_status)\b/g)) names.add(m[1])
  return names
}

export const readSkill = (name) => fs.readFileSync(path.join(root, 'skills/builtin', name, 'SKILL.md'), 'utf8')
