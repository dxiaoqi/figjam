# Website

The product website: marketing pages, scenario pages and the docs entry point. Next.js (App Router) with
`output: 'export'`, Tailwind CSS v4 and shadcn/ui. It builds to plain static files in `out/` and has no backend.

```bash
npm run website                 # from the repo root: dev server on http://127.0.0.1:47900
npm run website:build           # static export to apps/website/out
npm start -w @aifig/website     # serve out/ on http://127.0.0.1:47901 like a static host (brotli/gzip, cache headers)
```

Set `SITE_URL` (e.g. `https://aifig.dev`) for production builds: canonical URLs, `hreflang` alternates, Open Graph
images, `sitemap.xml` and `robots.txt` are absolute and read it. It defaults to the local dev address.

## Pages

| Route | What |
|---|---|
| `/` | Sends visitors to their saved language, Simplified Chinese by default (`noindex`) |
| `/zh/`, `/en/` | Home: hero clip, how it works, scenarios, agent review (interactive demo), canvas, typed blocks, Skills, web snippets, local-first & security, templates |
| `/<locale>/scenarios/` | All scenarios, architecture & code understanding first |
| `/<locale>/scenarios/<slug>/` | One per scenario (`architecture`, `user-research`, `product-discovery`, `prototype-wall`, `literature-review`): the problem, the Skill's workflow, its block types, a board, and "try it" with a prompt for Claude Code |
| `/<locale>/download/` | Installers from `latest.json`, first-launch help, beta signup placeholder, build from source |
| `/<locale>/docs/` | Quick start: install, connect Claude Code / Cursor, MCP tools, Skill authoring (sourced from the root README) |
| `/<locale>/changelog/` | What shipped, newest first |
| `/<locale>/privacy/` | The opt-in install count, the website download count, what's never collected, contact |

## Where things live

- **Brand.** `src/config/site.ts` holds the product name (a code name for now), the CLI and MCP server names, the
  repository URL and the contact email. Every page, title and command reads from it.
- **Copy.** `src/i18n/dictionaries/en.ts` is the source of truth; `zh.ts` must have the same shape or the typecheck
  fails. Scenario and privacy copy live next to it (`scenarios-en.ts`, `privacy-en.ts` and their `-zh` twins).
  Chinese copy follows the app's rules: full-width punctuation, a space between Chinese and Latin words.
  Shell and JSON snippets are built from the config in `src/content/commands.ts`.
- **Scenarios.** `src/content/scenarios.ts` maps each scenario to its Skill (`arch-kit`, `research-kit`,
  `product-kit`, `prototype-kit`, `lit-kit`) and gives every block type a token color and icon.
- **Design tokens.** Sticky, surface and agent colors come straight from `@aifig/shared` (`TokenStyle` emits them as
  CSS variables); the shadcn theme values match `apps/canvas/src/index.css`.
- **Media.** `public/media` holds WebP screenshots (each with an 800px `-800` variant for phones) and MP4/WebM clips
  from the product's demo recordings; `src/lib/media.ts` lists their sizes. Inter's Latin subset is copied into
  `public/fonts` before `dev`/`build` and preloaded.
- **SEO.** `src/lib/seo.ts` builds each page's title, description, canonical URL, language alternates and Open Graph /
  Twitter card; `src/app/sitemap.ts` and `src/app/robots.ts` are static routes. Open Graph images are in `public/og`.
- **Beta form.** A placeholder, clearly labeled on the page: it validates the address and opens a prefilled email to
  `site.contactEmail`. Point it at a real endpoint when there is one.

## Scripts

```bash
node apps/website/scripts/import-scenario-shots.mjs <dir>   # <skill>-<lang>.png → media/scenarios + manifest
node apps/website/scripts/optimize-media.mjs                # 800px WebP variants for new screenshots
npx tsx apps/website/scripts/og-images.mts                  # public/og/<page>-<locale>.png (needs a CJK font)
node apps/website/scripts/screenshots.mjs <out-dir> [--full] [--pages=/,/docs/] [--base=http://127.0.0.1:47900]
node apps/website/scripts/lighthouse.mjs <out-dir> [--pages=/,/privacy/] [--base=http://127.0.0.1:47901]
```

- **Scenario screenshots.** Until a scenario has a screenshot, its page shows an illustration of the board drawn with
  the product's tokens (labeled as such). Drop `arch-kit-en.png`, `arch-kit-zh.png`, … into a folder and run
  `import-scenario-shots.mjs` on it; `src/lib/scenario-shots.ts` is rewritten and the pages switch over.
- **Screenshots** captures pages in both languages at desktop (1440×900) and mobile (390×844) sizes with headless
  Chrome (`CHROME_PATH` overrides the browser).
- **Lighthouse** runs mobile and desktop audits against `npm start` and writes JSON reports plus `summary.md`.
