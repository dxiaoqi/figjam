import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { agentStatus, installAgent, LEGACY_SERVER_NAME, SERVER_NAME } from '../packages/core/src/agent-setup'

const launch = { command: 'node', args: ['bin/nodboard.mjs', 'mcp'] }
const http = { url: 'http://127.0.0.1:47821/mcp', token: 'tok' }

test('install moves a legacy ai-figma MCP entry to nodboard', () => {
  const prev = process.env.NODBOARD_AGENT_CONFIG_HOME
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodboard-agent-'))
  process.env.NODBOARD_AGENT_CONFIG_HOME = dir
  try {
    const file = path.join(dir, '.cursor', 'mcp.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify({ keep: true, mcpServers: { [LEGACY_SERVER_NAME]: { command: 'old', args: ['mcp'] }, other: { command: 'keep' } } }, null, 2)}\n`)
    const before = agentStatus('cursor', launch, http)
    assert.equal(before.state, 'different')
    assert.equal(before.transport, 'stdio')
    const installed = installAgent('cursor', launch, http, 'stdio')
    assert.equal(installed.changed, true)
    assert.equal(installed.status.state, 'configured')
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(written.mcpServers[LEGACY_SERVER_NAME], undefined)
    assert.equal(written.mcpServers[SERVER_NAME].command, 'node')
    assert.deepEqual(written.mcpServers[SERVER_NAME].args, launch.args)
    assert.equal(written.mcpServers.other.command, 'keep')
    assert.equal(written.keep, true)
    assert.equal(installAgent('cursor', launch, http, 'stdio').changed, false)
  } finally {
    if (prev == null) delete process.env.NODBOARD_AGENT_CONFIG_HOME
    else process.env.NODBOARD_AGENT_CONFIG_HOME = prev
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
