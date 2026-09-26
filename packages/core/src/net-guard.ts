import { lookup } from 'node:dns/promises'
import net from 'node:net'

/**
 * Outbound fetches the core makes on someone's behalf (images by URL, snippet posters). Only http(s), never to
 * loopback, private, link-local or metadata addresses (so an agent can't use the core to reach local services),
 * redirects followed by hand and re-checked, size-capped.
 */

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const v4num = (ip: string) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4num(ip)
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (v4num(base) >>> (32 - bits)))
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '')
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s)
  }
  return true
}

export class NetGuardError extends Error {}

async function checkUrl(raw: string) {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new NetGuardError(`Not a valid URL: ${raw.slice(0, 80)}`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new NetGuardError('Only http(s) URLs can be fetched')
  if (u.username || u.password) throw new NetGuardError('URLs with credentials are not fetched')
  if (process.env.AIFIG_ALLOW_PRIVATE_FETCH === '1') return u
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (!addrs.length) throw new NetGuardError(`Could not resolve ${u.hostname}`)
  if (addrs.some(isPrivateAddress)) throw new NetGuardError(`${u.hostname} is a local or private address, which ai-figma does not fetch from`)
  return u
}

export async function guardedFetch(url: string, opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {}) {
  const { timeoutMs = 15000, maxBytes = 12 * 1024 * 1024, maxRedirects = 3 } = opts
  let current = url
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await checkUrl(current)
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = new URL(r.headers.get('location')!, u).toString()
      continue
    }
    if (!r.ok) return { ok: false as const, status: r.status, finalUrl: u.toString() }
    const len = Number(r.headers.get('content-length') ?? 0)
    if (len > maxBytes) throw new NetGuardError(`Download is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new NetGuardError(`Download is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
    return { ok: true as const, status: r.status, bytes, finalUrl: u.toString() }
  }
  throw new NetGuardError('Too many redirects')
}
