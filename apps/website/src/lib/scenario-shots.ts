/**
 * Real scenario screenshots in public/media/scenarios (WebP, plus a -800 variant), keyed `<skill>-<locale>`.
 * Written by `node scripts/import-scenario-shots.mjs <dir>`; a scenario without an entry shows its illustration.
 */
export const scenarioShots: Record<string, readonly [number, number]> = {}
