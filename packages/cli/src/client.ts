import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homeDir, readToken } from '@nodboard/core/auth'
import { CORE_PORT, type AnyToolName, type CallResponse, type CallerInfo } from '@nodboard/shared'

export const base = () => process.env.NODBOARD_CORE_URL ?? `http://127.0.0.1:${CORE_PORT}`

/** Headers for the core: the per-install access token from NODBOARD_HOME (or NODBOARD_TOKEN). */
export function authHeaders(): Record<string, string> {
  const t = readToken()
  return t ? { authorization: `Bearer ${t}` } : {}
}

/** Authenticated request to the core; a 401 gets an actionable message instead of a JSON parse error. */
export async function coreFetch(pathname: string, init: RequestInit = {}) {
  await ensureCore()
  const r = await fetch(`${base()}${pathname}`, { ...init, headers: { 'content-type': 'application/json', ...authHeaders(), ...(init.headers as Record<string, string>) } })
  if (r.status === 401) throw new Error(`The nodboard core rejected the access token. Make sure NODBOARD_HOME (${process.env.NODBOARD_HOME ?? '~/.nodboard'}) matches the running core, or set NODBOARD_TOKEN.`)
  return r
}

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
    if (process.env.NODBOARD_NO_AUTOSTART) throw new Error(`nodboard core is not running at ${base()}. Start it with \`npm run core\`.`)
    const home = homeDir()
    fs.mkdirSync(home, { recursive: true })
    const log = fs.openSync(path.join(home, 'core.log'), 'a')
    const bin = process.env.NODBOARD_BIN ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../bin/nodboard.mjs')
    // Linux AppImage: process.execPath is inside this process's temporary mount, which goes away when it exits;
    // start the core through the AppImage file so it gets a mount that lives as long as it does
    const appImage = process.env.ELECTRON_RUN_AS_NODE && process.env.APPIMAGE
    const child = appImage
      ? spawn(appImage, [bin, 'core', '--no-sandbox'], { detached: true, stdio: ['ignore', log, log], env: process.env })
      : spawn(process.execPath, [bin, 'core'], { detached: true, stdio: ['ignore', log, log], env: process.env })
    child.unref()
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 200))
      if (await healthy()) return
    }
    throw new Error(`Started the nodboard core but it did not answer at ${base()}. See ${path.join(home, 'core.log')}.`)
  })().catch((e) => {
    ensured = null
    throw e
  })
  return ensured
}

export async function callCore(tool: AnyToolName, args: Record<string, unknown>, caller: CallerInfo): Promise<CallResponse> {
  try {
    const r = await coreFetch('/api/call', { method: 'POST', body: JSON.stringify({ tool, args, caller }) })
    return (await r.json()) as CallResponse
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function leave(callerId: string) {
  try {
    await fetch(`${base()}/api/agent/leave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ id: callerId }),
      signal: AbortSignal.timeout(500),
    })
  } catch {
    /* core may be gone */
  }
}
