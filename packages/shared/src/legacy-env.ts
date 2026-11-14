/** Copy AIFIG_* onto NODBOARD_* when the new name is unset, so existing shells keep working. */
export function applyLegacyEnv() {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  if (!env) return
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('AIFIG_') || value == null) continue
    const next = `NODBOARD_${key.slice('AIFIG_'.length)}`
    if (env[next] == null) env[next] = value
  }
}
