/**
 * Brand and product identifiers. The product name is a code name until launch:
 * change `name` here and every page, title and meta tag follows.
 * `cli` and `mcpServer` are the identifiers the product ships today; rename them
 * together with the CLI binary and the default MCP server name.
 */
export const site = {
  name: 'ai-figma',
  cli: 'aifig',
  mcpServer: 'ai-figma',
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
