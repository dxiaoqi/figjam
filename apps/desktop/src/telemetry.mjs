// Anonymous install counting. Opt-in: nothing is stored or sent until the user turns it on (welcome tour or
// Settings), and AIFIG_TELEMETRY=off / DO_NOT_TRACK=1 turn it off regardless. With no endpoint configured this
// module does nothing at all.
//
// What a ping contains — and nothing else: a random install ID (generated when the user opts in, deleted when
// they opt out), the event (`install` once, then `active` at most once per UTC day), app version, OS, CPU
// architecture and UI locale. No names, paths, hostnames, board content, or anything derived from them.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const PING_FIELDS = ['v', 'event', 'installId', 'appVersion', 'os', 'arch', 'locale']
const OFF = /^(0|off|false|no|disabled?)$/i

export function disabledByEnv(env = process.env) {
  return OFF.test(env.AIFIG_TELEMETRY ?? '') || env.DO_NOT_TRACK === '1'
}

/** `en-US`, `zh-CN`, `de`: language and region only; anything else becomes `und`. */
export function normalizeLocale(locale) {
  const m = /^([a-z]{2,3})(?:[-_]([a-z]{2}|\d{3})(?![a-z0-9]))?(?![a-z0-9])/i.exec(String(locale ?? '').trim())
  if (!m) return 'und'
  return m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase()
}

const OS = { darwin: 'macos', win32: 'windows', linux: 'linux' }
const utcDay = (t) => new Date(t).toISOString().slice(0, 10)

/**
 * @param {object} o
 * @param {string} o.endpoint   base URL of the counter service ('' → no-op)
 * @param {string} o.stateFile  where consent, the install ID and send markers live (the Electron profile)
 * @param {string} o.appVersion
 * @param {string} [o.platform] process.platform
 * @param {string} [o.arch]     process.arch
 * @param {() => string} [o.locale]
 * @param {Record<string, string|undefined>} [o.env]
 * @param {typeof fetch} [o.fetch]
 * @param {() => number} [o.now]
 */
export function createTelemetry(o) {
  const env = o.env ?? process.env
  const doFetch = o.fetch ?? globalThis.fetch
  const now = o.now ?? Date.now
  const endpoint = (o.endpoint ?? '').trim().replace(/\/+$/, '')
  let inflight = null

  const read = () => {
    try {
      const s = JSON.parse(fs.readFileSync(o.stateFile, 'utf8'))
      return s && typeof s === 'object' ? s : {}
    } catch {
      return {}
    }
  }
  const write = (s) => {
    fs.mkdirSync(path.dirname(o.stateFile), { recursive: true })
    const tmp = `${o.stateFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, o.stateFile)
  }

  const envOff = () => disabledByEnv(env)
  const enabled = (s = read()) => !!endpoint && !envOff() && s.consent === 'granted'

  function payload(event, s) {
    return {
      v: 1,
      event,
      installId: s.installId,
      appVersion: o.appVersion,
      os: OS[o.platform ?? process.platform] ?? 'other',
      arch: o.arch ?? process.arch,
      locale: normalizeLocale(o.locale?.() ?? Intl.DateTimeFormat().resolvedOptions().locale),
    }
  }

  async function post(body) {
    const r = await doFetch(`${endpoint}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) throw new Error(`telemetry endpoint answered ${r.status}`)
  }

  /** Sends what's due (the install event once, then one active ping per UTC day). Never throws. */
  async function tick() {
    if (!enabled()) return { sent: [] }
    inflight ??= (async () => {
      const sent = []
      try {
        const s = read()
        if (!s.installId) {
          s.installId = randomUUID()
          write(s)
        }
        const today = utcDay(now())
        if (!s.installSent) {
          await post(payload('install', s))
          s.installSent = true
          s.lastActiveDay = today
          write(s)
          sent.push('install')
        } else if (s.lastActiveDay !== today) {
          await post(payload('active', s))
          s.lastActiveDay = today
          write(s)
          sent.push('active')
        }
      } catch {
        // offline or endpoint down: try again on the next tick
      }
      return { sent }
    })().finally(() => (inflight = null))
    return inflight
  }

  function status() {
    const s = read()
    return {
      configured: !!endpoint,
      envDisabled: envOff(),
      consent: s.consent ?? null,
      enabled: enabled(s),
      // exactly what a ping carries, so the UI can show it
      preview: payload('active', { installId: s.consent === 'granted' ? s.installId : undefined }),
    }
  }

  /** granted → a new random ID on the next tick; denied → the ID is deleted, so a later opt-in isn't linkable. */
  function setConsent(granted) {
    const s = read()
    const next = granted ? { ...s, consent: 'granted' } : { consent: 'denied' }
    next.decidedAt = utcDay(now())
    write(next)
    if (granted) void tick()
    return status()
  }

  let timer = null
  return {
    status,
    setConsent,
    tick,
    /** check hourly, so a machine that stays on still sends one active ping per day */
    start() {
      if (!endpoint || timer) return
      void tick()
      timer = setInterval(() => void tick(), 60 * 60 * 1000)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
