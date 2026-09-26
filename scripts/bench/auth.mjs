// Core access token for the bench: uses scripts/lib/core-auth.mjs when present, else reads it the same way
// (AIFIG_TOKEN, or <AIFIG_HOME>/access-token). Cores without token auth ignore it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let lib = null
try {
  lib = await import('../lib/core-auth.mjs')
} catch {
  // not available on this checkout
}

export function tokenFor(home) {
  if (lib) return lib.tokenFor(home)
  if (process.env.AIFIG_TOKEN) return process.env.AIFIG_TOKEN
  try {
    return fs.readFileSync(path.join(home ?? process.env.AIFIG_HOME ?? path.join(os.homedir(), '.aifig'), 'access-token'), 'utf8').trim()
  } catch {
    return ''
  }
}

export const authHeaders = (home) => {
  const t = tokenFor(home)
  return t ? { authorization: `Bearer ${t}` } : {}
}

export const authedFetch = (url, init = {}, home) => fetch(url, { ...init, headers: { ...authHeaders(home), ...(init.headers ?? {}) } })

/** App URL carrying the token in the fragment (the canvas stores it and strips it; never sent to the server). */
export const withToken = (url, home) => {
  const t = tokenFor(home)
  return t ? `${url}#token=${encodeURIComponent(t)}` : url
}
