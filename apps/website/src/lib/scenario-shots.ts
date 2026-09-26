/** Scenario screenshots in public/media/scenarios (WebP, plus -800 and -2400 variants). Written by scripts/import-scenario-shots.mjs. */
export const scenarioShots = {
  'arch-kit-zh': [1600, 1000],
  'arch-kit-zh-overview': [1600, 1000],
  'research-kit-zh': [1600, 1000],
  'research-kit-zh-overview': [1600, 1000],
  'product-kit-zh': [1600, 1000],
  'product-kit-zh-overview': [1600, 1000],
  'prototype-kit-zh': [1600, 1000],
  'prototype-kit-zh-overview': [1600, 1000],
  'lit-kit-zh': [1600, 1000],
  'lit-kit-zh-overview': [1600, 1000],
  'scenarios-dialog-zh': [1600, 1000],
  'arch-kit-en': [1600, 1000],
  'arch-kit-en-overview': [1600, 1000],
  'research-kit-en': [1600, 1000],
  'research-kit-en-overview': [1600, 1000],
  'product-kit-en': [1600, 1000],
  'product-kit-en-overview': [1600, 1000],
  'prototype-kit-en': [1600, 1000],
  'prototype-kit-en-overview': [1600, 1000],
  'lit-kit-en': [1600, 1000],
  'lit-kit-en-overview': [1600, 1000],
  'scenarios-dialog-en': [1600, 1000],
} as const satisfies Record<string, readonly [number, number]>

export type ScenarioShotName = keyof typeof scenarioShots
