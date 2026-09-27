// Distribution settings: distribution.json at the repo root, overridden by environment variables.
// Empty URLs mean "off": no telemetry endpoint → telemetry is a no-op, no feed → the updater stays disabled.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const trimSlash = (s) => (s ?? '').trim().replace(/\/+$/, '')

export function loadDistribution(env = process.env) {
  let file = {}
  try {
    file = JSON.parse(fs.readFileSync(path.join(root, 'distribution.json'), 'utf8'))
  } catch {
    /* defaults */
  }
  const publish = { target: 'none', ...(file.publish ?? {}) }
  if (env.AIFIG_PUBLISH_TARGET) publish.target = env.AIFIG_PUBLISH_TARGET
  const updateFeedUrl = trimSlash(env.AIFIG_UPDATE_URL ?? file.updateFeedUrl)
  return {
    telemetryUrl: trimSlash(env.AIFIG_TELEMETRY_URL ?? file.telemetryUrl),
    updateFeedUrl,
    // where installers are downloaded from; defaults to the update feed (same bucket/folder)
    downloadBaseUrl: trimSlash(env.AIFIG_DOWNLOAD_BASE_URL ?? file.downloadBaseUrl) || updateFeedUrl,
    publish,
  }
}
