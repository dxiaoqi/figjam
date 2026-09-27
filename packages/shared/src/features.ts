/**
 * Build-time feature flags. Off unless the build (or, for the node side run from source, the environment) sets
 * `AIFIG_FEATURE_<NAME>=1`. Vite and the desktop bundle bake `__AIFIG_FEATURES__` in; tsx reads the environment.
 *
 * - `assistant`: the built-in assistant (Extract ideas / Cluster / Tidy, provider settings, key UI). Not shipped:
 *   the canvas is driven by external agents over MCP / CLI, and scenario capabilities ship as Skills.
 */
declare const __AIFIG_FEATURES__: { assistant?: boolean } | undefined

const env: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const baked = typeof __AIFIG_FEATURES__ === 'object' && __AIFIG_FEATURES__ ? __AIFIG_FEATURES__ : undefined

export const FEATURES = {
  assistant: baked?.assistant ?? env.AIFIG_FEATURE_ASSISTANT === '1',
} as const
