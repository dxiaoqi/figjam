import { spawn, spawnSync } from 'node:child_process'
import type { CallerInfo } from '@aifig/shared'
import type { ActivityLog } from './activity'

/**
 * Where API keys live. Policy:
 *  1. Persist only in an OS-backed store: the macOS Keychain (`security`), the Secret Service on Linux
 *     (`secret-tool` / libsecret), or — in the desktop app — Electron `safeStorage` (Keychain / DPAPI / libsecret).
 *  2. If none is available, keep the key in memory for this session only and say so. Never fall back to a
 *     plain-text or obfuscated file (that includes Electron's `basic_text` backend on Linux).
 *  3. Tests use the explicit `mock` backend (`AIFIG_SECRET_STORE=mock`), which is in-memory and labelled insecure.
 */

export type SecretBackend = 'macos-keychain' | 'libsecret' | 'memory' | 'mock'

export interface SecretStoreInfo {
  backend: SecretBackend
  /** survives a restart */
  persistent: boolean
  /** backed by the OS (false for memory and mock) */
  osBacked: boolean
}

export interface SecretStore extends SecretStoreInfo {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}

const SERVICE = 'ai-figma'
const NAME_RE = /^[\w.:-]{1,80}$/
const checkName = (name: string) => {
  if (!NAME_RE.test(name)) throw new Error(`Invalid secret name "${name}"`)
}

interface Exec {
  (cmd: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }>
}

const exec: Exec = (cmd, args, input) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e.message) }))
    p.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    p.stdin.end(input ?? '')
  })

/** `security -i` reads commands from stdin, so the secret never appears in argv / `ps`. */
const shellQuote = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`

export function macKeychainStore(run: Exec = exec, bin = 'security'): SecretStore {
  return {
    backend: 'macos-keychain',
    persistent: true,
    osBacked: true,
    async get(name) {
      checkName(name)
      const r = await run(bin, ['find-generic-password', '-s', SERVICE, '-a', name, '-w'])
      return r.code === 0 ? r.stdout.replace(/\n$/, '') : null
    },
    async set(name, value) {
      checkName(name)
      if (/[\r\n]/.test(value)) throw new Error('Secrets cannot contain line breaks')
      const r = await run(bin, ['-i'], `add-generic-password -U -s ${SERVICE} -a ${name} -l ${shellQuote(`ai-figma: ${name}`)} -w ${shellQuote(value)}\n`)
      if (r.code !== 0 || /error|fail/i.test(r.stderr)) throw new Error(`The macOS Keychain refused to store the key: ${r.stderr.trim().slice(0, 200)}`)
    },
    async delete(name) {
      checkName(name)
      await run(bin, ['delete-generic-password', '-s', SERVICE, '-a', name])
    },
  }
}

export function libsecretStore(run: Exec = exec, bin = 'secret-tool'): SecretStore {
  return {
    backend: 'libsecret',
    persistent: true,
    osBacked: true,
    async get(name) {
      checkName(name)
      const r = await run(bin, ['lookup', 'service', SERVICE, 'account', name])
      return r.code === 0 && r.stdout ? r.stdout.replace(/\n$/, '') : null
    },
    async set(name, value) {
      checkName(name)
      const r = await run(bin, ['store', `--label=ai-figma: ${name}`, 'service', SERVICE, 'account', name], value)
      if (r.code !== 0) throw new Error(`The Secret Service refused to store the key: ${r.stderr.trim().slice(0, 200)}`)
    },
    async delete(name) {
      checkName(name)
      await run(bin, ['clear', 'service', SERVICE, 'account', name])
    },
  }
}

function mapStore(backend: 'memory' | 'mock'): SecretStore {
  const m = new Map<string, string>()
  return {
    backend,
    persistent: false,
    osBacked: false,
    async get(name) {
      checkName(name)
      return m.get(name) ?? null
    },
    async set(name, value) {
      checkName(name)
      m.set(name, value)
    },
    async delete(name) {
      checkName(name)
      m.delete(name)
    },
  }
}

export const memoryStore = () => mapStore('memory')
export const mockStore = () => mapStore('mock')

const has = (bin: string, args: string[]) => {
  const r = spawnSync(bin, args, { stdio: 'ignore', timeout: 3000 })
  return !r.error
}

/** Pick the best store for this machine (override with AIFIG_SECRET_STORE=keychain|libsecret|memory|mock). */
export function openSecretStore(choice = process.env.AIFIG_SECRET_STORE): SecretStore {
  if (choice === 'mock') return mockStore()
  if (choice === 'memory') return memoryStore()
  if (choice === 'keychain' || (!choice && process.platform === 'darwin' && has('security', ['help']))) return macKeychainStore()
  if (choice === 'libsecret' || (!choice && process.platform === 'linux' && process.env.DBUS_SESSION_BUS_ADDRESS && has('secret-tool', ['--version']))) return libsecretStore()
  return memoryStore()
}

/** A store that writes every access to the activity log (names only, never values). */
export function auditedStore(store: SecretStore, log: ActivityLog): SecretStore & { withActor(actor: CallerInfo): SecretStore } {
  const wrap = (actor: CallerInfo): SecretStore => ({
    backend: store.backend,
    persistent: store.persistent,
    osBacked: store.osBacked,
    async get(name) {
      try {
        const v = await store.get(name)
        log.record({ category: 'secret', action: 'read', outcome: v == null ? 'error' : 'ok', actor, target: name, via: store.backend, detail: v == null ? 'not set' : undefined })
        return v
      } catch (e) {
        log.record({ category: 'secret', action: 'read', outcome: 'error', actor, target: name, via: store.backend, detail: (e as Error).message })
        throw e
      }
    },
    async set(name, value) {
      try {
        await store.set(name, value)
        log.record({ category: 'secret', action: 'store', outcome: 'ok', actor, target: name, via: store.backend, detail: store.persistent ? undefined : 'session only (no OS keychain)' })
      } catch (e) {
        log.record({ category: 'secret', action: 'store', outcome: 'error', actor, target: name, via: store.backend, detail: (e as Error).message })
        throw e
      }
    },
    async delete(name) {
      await store.delete(name)
      log.record({ category: 'secret', action: 'delete', outcome: 'ok', actor, target: name, via: store.backend })
    },
  })
  const system: CallerInfo = { id: 'core', name: 'ai-figma', client: 'core', kind: 'human' }
  return { ...wrap(system), withActor: wrap }
}
