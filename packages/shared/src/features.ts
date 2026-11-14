/**
 * Build-time feature flags. Off unless the build (or, for the node side run from source, the environment) sets
 * `NODBOARD_FEATURE_<NAME>=1`. Vite and the desktop bundle bake `__NODBOARD_FEATURES__` in; tsx reads the environment.
 *
 * - `assistant`: the built-in assistant (Extract ideas / Cluster / Tidy, provider settings, key UI). Not shipped:
 *   the canvas is driven by external agents over MCP / CLI, and scenario capabilities ship as Skills.
 */
import { applyLegacyEnv } from './legacy-env'

declare const __NODBOARD_FEATURES__: { assistant?: boolean } | undefined

applyLegacyEnv()
const env: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const baked = typeof __NODBOARD_FEATURES__ === 'object' && __NODBOARD_FEATURES__ ? __NODBOARD_FEATURES__ : undefined

export const FEATURES = {
  assistant: baked?.assistant ?? env.NODBOARD_FEATURE_ASSISTANT === '1',
} as const
