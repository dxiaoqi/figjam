/**
 * Brand and product identifiers. Change `name` and every page, title and meta tag follows.
 * `cli` is the binary (`nodboard`). `mcpServer` is the name written into agent configs.
 */
export const site = {
  name: 'nodboard',
  cli: 'nodboard',
  mcpServer: 'nodboard',
  version: '0.1.0',
  url: process.env.SITE_URL ?? 'http://127.0.0.1:47900',
  repoUrl: 'https://cursor.com/codebase/we-ding/genesis',
  cloneUrl: 'https://origin.cursor.com/git/we-ding/genesis.git',
  repoDir: 'genesis',
  contactEmail: 'dwt199718@gmail.com',
  corePort: 47821,
  uiPort: 47820,
  /**
   * The release manifest written by `npm run release` (installers, sizes, SHA-256). An absolute URL (your bucket's
   * latest.json, served with CORS) is re-read in the browser, so a new release shows up without rebuilding the site;
   * a path is read from ./public at build time.
   */
  releaseManifestUrl: process.env.NEXT_PUBLIC_RELEASE_MANIFEST_URL ?? '/downloads/latest.json',
  /** The counter service (apps/telemetry). Empty: downloads aren't counted. */
  telemetryUrl: (process.env.NEXT_PUBLIC_TELEMETRY_URL ?? '').replace(/\/+$/, ''),
} as const

export type Site = typeof site
