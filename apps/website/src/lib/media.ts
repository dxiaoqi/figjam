/** Product screenshots in public/media (WebP), with intrinsic sizes to avoid layout shift. */
export const shots = {
  'agent-drafting': [1600, 1000],
  'canvas-connectors': [1600, 1000],
  'canvas-feel-poster': [1600, 1000],
  'canvas-guides': [1600, 1000],
  'comment-reply': [1600, 1000],
  'connect-agent-en': [1600, 1000],
  'connect-agent-zh': [1600, 1000],
  'desktop-app': [1600, 1000],
  'desktop-zh': [1600, 970],
  'final-board': [1600, 1000],
  'hero-agent-run-poster': [1600, 1000],
  'item-review': [1600, 1000],
  'skills-library': [1600, 1000],
  'skills-matrix': [1600, 1000],
  'skills-permission': [1200, 742],
  'snippet-running': [1200, 814],
  'step-connect-en': [1200, 750],
  'step-connect-zh': [1200, 750],
  'step-drafting': [1200, 750],
  'step-review': [1200, 750],
  'template-brainstorm-en': [1600, 1000],
  'template-brainstorm-zh': [1600, 1000],
  'template-research-en': [1600, 1000],
  'template-research-zh': [1600, 1000],
  'templates-en': [1600, 1000],
  'templates-zh': [1600, 1000],
  'typed-board': [1600, 1000],
  'typed-filter': [1600, 1000],
  'typed-slash': [1600, 1000],
  'version-history': [1600, 1000],
} as const satisfies Record<string, readonly [number, number]>

export type ShotName = keyof typeof shots

export function isShot(name: string): name is ShotName {
  return name in shots
}
