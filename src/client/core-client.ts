import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_PORT, type AnyToolName, type CallResponse, type CallerInfo } from '../shared/tools'

const base = () => process.env.AIFIG_CORE_URL ?? `http://127.0.0.1:${CORE_PORT}`

async function healthy() {
  try {
    const r = await fetch(`${base()}/api/health`, { signal: AbortSignal.timeout(800) })
    return r.ok
  } catch {
    return false
  }
}

let ensured: Promise<void> | null = null

/** Make sure a core is listening; start one in the background if not. */
export function ensureCore(): Promise<void> {
  ensured ??= (async () => {
    if (await healthy()) return
    if (process.env.AIFIG_NO_AUTOSTART) throw new Error(`ai-figma core is not running at ${base()}. Start it with \`npm run core\`.`)
    const home = process.env.AIFIG_HOME ?? path.join(os.homedir(), '.aifig')
    fs.mkdirSync(home, { recursive: true })
    const log = fs.openSync(path.join(home, 'core.log'), 'a')
    const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/aifig.mjs')
    const child = spawn(process.execPath, [bin, 'core'], { detached: true, stdio: ['ignore', log, log], env: process.env })
    child.unref()
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 200))
      if (await healthy()) return
    }
    throw new Error(`Started the ai-figma core but it did not answer at ${base()}. See ${path.join(home, 'core.log')}.`)
  })().catch((e) => {
    ensured = null
    throw e
  })
  return ensured
}

export async function callCore(tool: AnyToolName, args: Record<string, unknown>, caller: CallerInfo): Promise<CallResponse> {
  await ensureCore()
  const r = await fetch(`${base()}/api/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, args, caller }),
  })
  return (await r.json()) as CallResponse
}

export async function leave(callerId: string) {
  try {
    await fetch(`${base()}/api/agent/leave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: callerId }),
      signal: AbortSignal.timeout(500),
    })
  } catch {
    /* core may be gone */
  }
}
