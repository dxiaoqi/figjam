import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { site } from '@/config/site'
import { parseRelease, type Release } from './release'

/** Build time: the release manifest from its URL, or from ./public for a path. null when there's none yet. */
export async function loadRelease(): Promise<Release | null> {
  const url = site.releaseManifestUrl
  try {
    if (/^https?:\/\//.test(url)) {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      return r.ok ? parseRelease(await r.json()) : null
    }
    return parseRelease(JSON.parse(await readFile(path.join(process.cwd(), 'public', url.replace(/^\/+/, '')), 'utf8')))
  } catch {
    return null
  }
}
