// Test/script helper: the core's access token from AIFIG_HOME (or AIFIG_TOKEN), as headers or WebSocket protocols.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const homeOf = (home) => home ?? process.env.AIFIG_HOME ?? path.join(os.homedir(), '.aifig')

export function tokenFor(home) {
  if (process.env.AIFIG_TOKEN) return process.env.AIFIG_TOKEN
  try {
    return fs.readFileSync(path.join(homeOf(home), 'access-token'), 'utf8').trim()
  } catch {
    return ''
  }
}

export const authHeaders = (home) => ({ 'content-type': 'application/json', authorization: `Bearer ${tokenFor(home)}` })
export const wsProtocols = (home) => ['aifig', `aifig-token.${tokenFor(home)}`]

/** fetch with the token; same signature as fetch */
export const authedFetch = (url, init = {}, home) => fetch(url, { ...init, headers: { ...authHeaders(home), ...(init.headers ?? {}) } })

/** Playwright: seed the canvas origins' localStorage with the token before any page script runs. */
export const signIn = (page, home) =>
  page.context().addInitScript((t) => {
    try {
      if (/^(127\.0\.0\.1|localhost):4782[01]$/.test(location.host)) localStorage.setItem('aifig:token', t)
    } catch {
      // sandboxed snippet frames have no storage
    }
  }, tokenFor(home))
