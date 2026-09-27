# Website

The product website: marketing pages and the docs entry point. Next.js (App Router) with `output: 'export'`,
Tailwind CSS v4 and shadcn/ui. It builds to plain static files in `out/` and has no backend.

```bash
npm run website                 # from the repo root: dev server on http://127.0.0.1:47900
npm run website:build           # static export to apps/website/out
npm start -w @aifig/website     # serve out/ on http://127.0.0.1:47901, as a static host would
```

## Pages

| Route | What |
|---|---|
| `/` | Sends visitors to their saved language, Simplified Chinese by default |
| `/zh/`, `/en/` | Home: hero clip, how it works, canvas, agent review (interactive demo), typed blocks, web snippets, Skills, local-first & security, templates |
| `/<locale>/download/` | Platform status (builds aren't signed yet), beta signup placeholder, build from source |
| `/<locale>/docs/` | Quick start: install, connect Claude Code / Cursor, MCP tools, Skill authoring (sourced from the root README) |
| `/<locale>/changelog/` | What shipped, newest first |

## Where things live

- **Brand.** `src/config/site.ts` holds the product name (a code name for now), the CLI and MCP server names, the
  repository URL and the beta email. Every page, title and command reads from it.
- **Copy.** `src/i18n/dictionaries/en.ts` is the source of truth; `zh.ts` must have the same shape or the typecheck
  fails. Chinese copy follows the app's rules: full-width punctuation, a space between Chinese and Latin words.
  Shell and JSON snippets are built from the config in `src/content/commands.ts`.
- **Design tokens.** Sticky, surface and agent colors come straight from `@aifig/shared` (`TokenStyle` emits them as
  CSS variables); the shadcn theme values match `apps/canvas/src/index.css`.
- **Media.** `public/media` holds WebP screenshots and MP4/WebM clips from the product's demo recordings;
  `src/lib/media.ts` lists their sizes.
- **Beta form.** A placeholder, clearly labeled on the page: it validates the address and opens a prefilled email to
  `site.betaEmail`. Point it at a real endpoint when there is one.

## Screenshots

```bash
node apps/website/scripts/screenshots.mjs <out-dir> [--full] [--pages=/,/docs/] [--base=http://127.0.0.1:47900]
```

Captures every page in both languages at desktop (1440×900) and mobile (390×844) sizes with headless Chrome
(`CHROME_PATH` overrides the browser).
