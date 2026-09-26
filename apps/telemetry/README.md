# @aifig/telemetry

A small, self-hostable counter for ai-figma installs and downloads. Hono, running on Node (SQLite through the built-in
`node:sqlite`) or Cloudflare Workers (D1).

| Endpoint | Auth | What |
|---|---|---|
| `POST /v1/events` | — | App pings: `{ v, event: install\|active, installId, appVersion, os, arch, locale }` |
| `POST /v1/downloads` | — | Website download counts: `{ v, platform, arch, kind, version, source }` |
| `GET /api/stats?days=30` | `Authorization: Bearer $ADMIN_TOKEN` | Totals, installs by day/OS/version/arch/locale, DAU, 7/30-day actives, downloads |
| `GET /admin` | token prompt | Dashboard for the stats above |

Write endpoints take strict JSON (unknown fields are rejected), at most 1 KB, rate-limited per client (`RATE_LIMIT`
per minute, default 30), with CORS for the website (`text/plain` bodies from `navigator.sendBeacon` work). Rows hold
the ping fields and a UTC day; IP addresses are only used in memory for rate limiting.

```bash
npm run mock -w @aifig/telemetry     # in-memory, 90 days of fake data; token: mock-admin-token
npm start -w @aifig/telemetry        # PORT=47910 HOST=127.0.0.1 DB_FILE=data/telemetry.sqlite ADMIN_TOKEN=… TRUST_PROXY=1
npm test -w @aifig/telemetry
```

Cloudflare: `npx wrangler d1 create aifig-telemetry`, put the id in `wrangler.toml`, `npx wrangler secret put ADMIN_TOKEN`,
`npx wrangler deploy`. See [docs/distribution.md](../../docs/distribution.md#anonymous-install-counting) for what the
app sends and why it's opt-in.
