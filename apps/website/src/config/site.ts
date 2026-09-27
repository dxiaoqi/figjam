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
  betaEmail: 'beta@example.com',
  corePort: 47821,
  uiPort: 47820,
} as const

export type Site = typeof site
