# Distribution: installers, releases, updates and install counts

Everything needed to ship ai-figma as a normal desktop app: installers that need no Node/npm, a release channel with
checksums and an auto-update feed, and a privacy-respecting install counter.

## What gets built

| Platform | Files | Built on |
|---|---|---|
| macOS | `ai-figma-<v>-mac-arm64.dmg`, `…-mac-x64.dmg`, `…-mac-arm64.zip`, `…-mac-x64.zip` | a Mac (`npm run release:mac`) |
| Windows | `ai-figma-<v>-win-x64-setup.exe`, `…-win-arm64-setup.exe` (NSIS, per-user, no admin) | Linux with wine, or Windows (`npm run release:win`) |
| Linux | `ai-figma-<v>-linux-x86_64.AppImage`, `ai-figma-<v>-linux-amd64.deb` | Linux (`npm run release:linux`) |

The `.zip` on macOS is what the updater downloads; people install from the `.dmg`. Every package contains the
Electron app, the canvas UI, the core, the CLI and MCP server (one bundled `aifig.mjs`), the built-in skills, the
agent skill (`resources/agent-skill`) and the resvg native module for the target platform. The core, CLI and MCP server
run on Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), so users need nothing else installed.

`apps/desktop/scripts/build.mjs` does the work: builds the UI, bundles the CLI/core/MCP and the Electron main process
(with electron-updater) with esbuild, renders icons from `apps/desktop/resources/icon.svg`, stages the resvg binary for
each target (fetched from npm when the host OS/arch differs), and runs electron-builder with
`apps/desktop/electron-builder.config.cjs`.

## Building on a Mac

Requirements: macOS 12+, Xcode Command Line Tools (`xcode-select --install`), Node 22+, git.

```bash
git clone https://origin.cursor.com/git/we-ding/genesis.git && cd genesis
npm install
npm run release:mac            # → release/<version>/ai-figma-<v>-mac-{arm64,x64}.{dmg,zip}, latest-mac.yml, latest.json
```

That builds both Apple silicon and Intel; add `-- --arm64` (or `--x64`) for one. Without a certificate the app is
**ad-hoc signed** (Apple silicon refuses to run unsigned code at all), so it runs on your own Mac straight away; on
other Macs Gatekeeper asks once (see [First launch](#first-launch-on-unsigned-builds)).

To ship a signed, notarized build, export these before `npm run release:mac`:

```bash
# Developer ID Application certificate, exported from Keychain Access as .p12
export CSC_LINK=~/certs/developer-id-application.p12      # or base64 of the file
export CSC_KEY_PASSWORD='…'
# notarization (App Store Connect → Users and Access → an app-specific password)
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=abcd-efgh-ijkl-mnop
export APPLE_TEAM_ID=ABCDE12345
```

If the certificate is already in your login keychain, `CSC_NAME="Developer ID Application: Your Name (ABCDE12345)"`
works instead of `CSC_LINK`. An App Store Connect API key (`APPLE_API_KEY` = path to the `.p8`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`) can replace the Apple ID trio. With a certificate the build uses the hardened runtime with
`apps/desktop/resources/entitlements.mac.plist` (JIT for V8/Node mode, library validation off for the resvg module).
Check the result with `spctl -a -vv /Applications/ai-figma.app` and `xcrun stapler validate release/*/ai-figma-*.dmg`.

Then publish from the Mac the same way as elsewhere (below); `latest.json` merges with what Linux already published.

## Building on Linux (and Windows from Linux)

```bash
npm run release:linux          # AppImage + .deb (electron-builder downloads fpm; nothing to install)
sudo apt install wine64        # once, for Windows installers with the app icon and version info
npm run release:win            # NSIS installers for x64 and arm64
```

Without wine, `AIFIG_WIN_EDIT_EXE=0 npm run release:win` still produces working installers but the `.exe` keeps
Electron's icon and metadata. Windows signing: `WIN_CSC_LINK` (`.pfx`, path or base64) and `WIN_CSC_KEY_PASSWORD`;
cross-signing from Linux uses osslsigncode, which electron-builder downloads. EV certificates on hardware tokens and
Azure Trusted Signing need a Windows machine or CI runner (`win.azureSignOptions` in the config).

## First launch on unsigned builds

| OS | What people see | What to do |
|---|---|---|
| macOS 15+ | "Apple could not verify ai-figma is free of malware" | System Settings › Privacy & Security › scroll down › **Open Anyway**, then confirm. Once. |
| macOS 14 and earlier | "…can't be opened because it is from an unidentified developer" | Right-click the app › **Open** › Open. Once. |
| Windows | SmartScreen: "Windows protected your PC" | **More info** › **Run anyway**. Signed builds build reputation over time; EV certificates skip it. |
| Linux AppImage | nothing, or "cannot mount" | `chmod +x ai-figma-*.AppImage`; needs FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` before). |
| Linux .deb | — | `sudo apt install ./ai-figma-*.deb` (pulls in its dependencies). |

The website Download page shows the same steps.

## Release channel

```bash
npm run release -- --bump patch            # set the version (root + desktop package.json + website config), build, checksum
npm run release -- --version 0.3.0 --mac   # explicit version, one platform
npm run release -- --skip-build --publish  # checksum what's built and publish it
```

Output goes to `release/<version>/`:

- the installers and `.blockmap`s (differential updates)
- `latest.yml` (Windows), `latest-mac.yml`, `latest-linux.yml` — the electron-updater feed, written by electron-builder
- `latest.json` — every installer with platform, arch, kind, size, SHA-256 and URL, for the website and anyone else
- `SHA256SUMS.txt` — `sha256sum -c` compatible

`latest.json` looks like this (URLs are absolute when `downloadBaseUrl` is set, otherwise relative to the manifest):

```json
{ "product": "ai-figma", "version": "0.2.0", "releasedAt": "2026-09-26T07:17:06.996Z", "baseUrl": "https://dl.example.com/ai-figma",
  "files": [{ "name": "ai-figma-0.2.0-mac-arm64.dmg", "url": "https://dl.example.com/ai-figma/ai-figma-0.2.0-mac-arm64.dmg",
              "platform": "macos", "arch": "arm64", "kind": "dmg", "size": 121634213, "sha256": "…" }] }
```

Build on several machines and publish from each: before uploading, the release script reads the published
`latest.json` and, for the same version, keeps the entries it didn't rebuild. Publish order is installers first,
feeds last, so a feed never points at a missing file.

### Where releases go

Set the target and URLs in `distribution.json` (committed) or with environment variables (CI):

| `distribution.json` | Env override | Meaning |
|---|---|---|
| `updateFeedUrl` | `AIFIG_UPDATE_URL` | Public URL of the release folder; baked into the app for auto-update. Empty = updater off |
| `downloadBaseUrl` | `AIFIG_DOWNLOAD_BASE_URL` | Public URL the installers are downloaded from; defaults to `updateFeedUrl` |
| `telemetryUrl` | `AIFIG_TELEMETRY_URL` | The counter service; baked into the app. Empty = telemetry is a no-op |
| `publish.target` | `AIFIG_PUBLISH_TARGET` | `s3`, `http`, `dir` or `none` |

Targets (`scripts/release/publish.mjs`):

- **`s3`** — any S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO. `S3_BUCKET`, `S3_PREFIX`,
  `S3_REGION` (default `auto`), `S3_ENDPOINT` (e.g. `https://<account>.r2.cloudflarestorage.com`),
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=1` for MinIO. Feeds get `Cache-Control: no-cache`,
  installers `immutable`.
- **`http`** — `PUT` of each file to `AIFIG_PUBLISH_URL/<name>`, with `AIFIG_PUBLISH_TOKEN` as a Bearer token (WebDAV,
  nginx `dav_methods PUT`, a small upload function).
- **`dir`** — copy into `AIFIG_PUBLISH_DIR` (a mounted share, an rsync staging folder, a static host's root).

Origin (cursor.com/docs/origin) hosts the repository and pull requests but has no release/asset storage yet, so it
isn't a target; `publish.mjs` is where one would go.

A good default is a public R2 bucket on a custom domain (`dl.example.com/ai-figma/`) with CORS allowing `GET` from the
website's origin (so the Download page can read `latest.json` live). `node scripts/release/serve.mjs` serves
`release/<version>/` locally with CORS and range requests, like a bucket.

## Auto-update

`apps/desktop/src/updater.mjs` wires electron-updater's generic provider. It runs only in packaged builds with a feed
URL (baked from `distribution.json`/`AIFIG_UPDATE_URL`, or `{"updates": {"feedUrl": "…"}}` in `~/.aifig/config.json`),
checks 10 s after launch and every 6 hours, downloads in the background and installs on quit. `AIFIG_UPDATES=off`
disables it on one machine; results go to `updates.log` in the app's profile folder.

- **macOS**: Squirrel.Mac installs only Developer ID–signed updates, so ad-hoc builds check but can't apply them.
- **Windows**: the feed (`latest.yml`) points at the x64 installer; arm64 installs update by reinstalling for now.
- **Linux**: AppImages are replaced in place; `.deb` installs download the new `.deb` and install it with `pkexec`.

## Agents and the installed app

The Connect agent dialog writes an MCP entry that runs the app's own executable in Node mode with the bundled CLI:

| Install | `command` | `args` |
|---|---|---|
| macOS | `/Applications/ai-figma.app/Contents/MacOS/ai-figma` | `…/Contents/Resources/aifig.mjs mcp` |
| Windows | `%LOCALAPPDATA%\Programs\ai-figma\ai-figma.exe` | `…\resources\aifig.mjs mcp` |
| Linux .deb | `/opt/ai-figma/ai-figma` | `/opt/ai-figma/resources/aifig.mjs mcp` |
| Linux AppImage | the `.AppImage` file itself | `~/.aifig/runtime/<version>/aifig.mjs mcp --no-sandbox` |

with `env: { ELECTRON_RUN_AS_NODE: "1", AIFIG_BIN, AIFIG_BUILTIN_SKILLS, AIFIG_UI_DIST }`. Two AppImage details: it runs
from a new `/tmp/.mount_*` folder on every launch, so the app copies the CLI, UI and skills to `~/.aifig/runtime/<version>/`
and points agents at the AppImage file (a stable path the updater replaces in place); and its launcher inserts
`--no-sandbox` before the arguments when unprivileged user namespaces are off (Ubuntu 24.04's default), which Node mode
rejects — unless `--no-sandbox` is already present, which is why the entry ends with it (the CLI ignores it). A CLI
started from an AppImage also launches its background core through the AppImage file, so the core keeps a mount of its
own. If the app moves, Connect agent shows the entry as different and offers to update it.

## Anonymous install counting

**What is sent.** When enabled, the app sends `POST <telemetryUrl>/v1/events` with exactly:

```json
{ "v": 1, "event": "install", "installId": "5f0b0869-2f3c-480e-9a42-fe818d910566", "appVersion": "0.2.0", "os": "macos", "arch": "arm64", "locale": "en-US" }
```

`install` once, then `active` at most once per UTC day (checked at launch and hourly). The install ID is a random UUID
created when the user opts in and deleted when they opt out, so a later opt-in isn't linkable. Nothing else — no user or
host names, paths, board content, IP-derived data or timestamps finer than a day. The server's schema rejects any
other field, and stores rows keyed by install ID, event and UTC day; it never stores IP addresses (they're used in memory
for rate limiting only).

**Consent: opt-in.** Nothing is stored or sent until the user turns on *Help us count installs* in the first step of
the welcome tour (or Settings › Anonymous install count). Why not opt-out:

- Storing an identifier on the user's device for analytics needs consent under the EU ePrivacy Directive (Art. 5(3)) —
  counting installs isn't strictly necessary to provide the app.
- A persistent random ID seen together with the sender's IP is pseudonymous personal data under the GDPR (Recital 26/30),
  and consent must be an affirmative act; a pre-enabled switch doesn't count (CJEU *Planet49*, C‑673/17).
- The product promise is local-first and private; a silent ping on first launch would contradict it.

The trade-off is that install counts are a lower bound. The website's download counter (no identifier, nothing stored
in the browser, skipped for Do Not Track / Global Privacy Control) gives the top of the funnel; *installs per download* on
the dashboard shows the opt-in rate among new users.

The website's Privacy page (`/<locale>/privacy/`) explains all of this to users; privacy questions and deletion
requests (by install ID) go to [dwt199718@gmail.com](mailto:dwt199718@gmail.com), the `contactEmail` in `distribution.json`.

**Off switches.** `AIFIG_TELEMETRY=off` (also `0`, `false`, `no`) or `DO_NOT_TRACK=1` turn it off regardless of the
switch; with no `telemetryUrl` configured the code is a no-op and the UI hides the switch. Consent lives in
`telemetry.json` in the Electron profile folder, not in `~/.aifig`.

## The counter service (`apps/telemetry`)

A Hono app with two write endpoints (`POST /v1/events`, `POST /v1/downloads`; strict schemas, 1 KB bodies, per-client
rate limit, CORS for the website) and an admin API/dashboard (`GET /api/stats?days=30`, `/admin`) behind a Bearer
token: total installs, installs by day / OS / version / arch / locale, DAU, 7- and 30-day actives, active installs by
version, downloads by day and file.

```bash
npm run telemetry:dev                     # in-memory, 90 days of mock data, http://127.0.0.1:47910/admin, token mock-admin-token
ADMIN_TOKEN=$(openssl rand -base64 24) DB_FILE=/var/lib/aifig/telemetry.sqlite HOST=0.0.0.0 npm start -w @aifig/telemetry
```

Node needs 22.13+ (built-in `node:sqlite`, nothing native to compile). Behind a reverse proxy set `TRUST_PROXY=1` so rate
limiting uses `X-Forwarded-For`. On Cloudflare Workers with D1:

```bash
cd apps/telemetry
npx wrangler d1 create aifig-telemetry          # paste the database_id into wrangler.toml
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy                             # → https://aifig-telemetry.<you>.workers.dev
```

Then set `telemetryUrl` in `distribution.json` (baked into the next build) and `NEXT_PUBLIC_TELEMETRY_URL` for the
website build.

## Website

`apps/website` reads the manifest from `NEXT_PUBLIC_RELEASE_MANIFEST_URL` (default `/downloads/latest.json` in
`public/`). With an absolute URL (the bucket's `latest.json`, served with CORS) the page also re-reads it in the browser,
so a new release appears without rebuilding the site. It detects the visitor's OS and CPU (client hints where available;
Macs default to Apple silicon with Intel one click away), offers the matching installer, lists every file with its
SHA-256, links `SHA256SUMS.txt`, and counts downloads via `navigator.sendBeacon` when `NEXT_PUBLIC_TELEMETRY_URL` is set.

## Tests

```bash
npm run test:telemetry     # desktop telemetry client (opt-in, env off, fields, no PII, daily), release manifest, counter service
npm run test:packaging     # packaged Linux AppImage: starts core + window, telemetry consent, one-click setup, MCP handshake
```

`test:packaging` needs a display (`DISPLAY`, or `xvfb-run -a npm run test:packaging`). Without FUSE (containers) it
extracts the AppImage and runs its AppRun, which exercises the same launcher script.
