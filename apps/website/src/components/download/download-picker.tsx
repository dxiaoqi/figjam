'use client'

import { ArrowDown, ChevronDown, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CopyButton } from '@/components/copy-command'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { site } from '@/config/site'
import type { Dict } from '@/i18n'
import { formatSize, parseRelease, pickDefault, PLATFORMS, resolveFileUrl, type Arch, type Platform, type Release, type ReleaseFile } from '@/lib/release'
import { cn } from '@/lib/utils'
import { platformIcons } from './platform-icons'

type T = Dict['download']
type Common = Dict['common']

interface Detected {
  platform: Platform | null
  arch: Arch | null
}

async function detect(): Promise<Detected> {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string; platform?: string }> } }
  const ua = navigator.userAgent
  let platform: Platform | null = /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'macos' : /Windows/i.test(ua) ? 'windows' : /Linux|X11|CrOS/i.test(ua) && !/Android/i.test(ua) ? 'linux' : null
  let arch: Arch | null = null
  try {
    const hints = await nav.userAgentData?.getHighEntropyValues?.(['architecture', 'platform'])
    if (hints?.platform) platform = ({ macOS: 'macos', Windows: 'windows', Linux: 'linux', 'Chrome OS': 'linux' } as Record<string, Platform>)[hints.platform] ?? platform
    if (hints?.architecture) arch = hints.architecture === 'arm' ? 'arm64' : hints.architecture === 'x86' ? 'x64' : null
  } catch {
    /* no client hints (Safari, Firefox) */
  }
  if (!arch && /aarch64|arm64/i.test(ua)) arch = 'arm64'
  return { platform, arch }
}

/** Anonymous download count: platform, arch, kind and version only — no cookies, no IDs. Skipped for DNT/GPC. */
function countDownload(f: ReleaseFile, version: string) {
  if (!site.telemetryUrl) return
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl) return
  const body = JSON.stringify({ v: 1, platform: f.platform, arch: f.arch, kind: f.kind, version, source: 'website' })
  try {
    if (!navigator.sendBeacon?.(`${site.telemetryUrl}/v1/downloads`, body)) throw new Error('beacon refused')
  } catch {
    fetch(`${site.telemetryUrl}/v1/downloads`, { method: 'POST', body, keepalive: true, mode: 'cors' }).catch(() => {})
  }
}

function archLabel(t: T, f: Pick<ReleaseFile, 'platform' | 'arch'>) {
  if (f.platform === 'macos') return f.arch === 'arm64' ? t.arch.appleSilicon : f.arch === 'universal' ? t.arch.universal : t.arch.intel
  return f.arch === 'arm64' ? t.arch.arm64 : t.arch.x64
}

export function DownloadPicker({ initial, t, common }: { initial: Release | null; t: T; common: Common }) {
  const [release, setRelease] = useState<Release | null>(initial)
  const [loading, setLoading] = useState(!initial)
  const [failed, setFailed] = useState(false)
  const [detected, setDetected] = useState<Detected | null>(null)

  useEffect(() => {
    detect().then(setDetected)
    let live = true
    fetch(site.releaseManifestUrl, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const r = parseRelease(j)
        if (live && r) setRelease(r)
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [])

  const files = useMemo(() => (release?.files ?? []).map((f) => ({ ...f, href: resolveFileUrl(f.url, site.releaseManifestUrl) })), [release])
  const platform = detected?.platform ?? null
  const primary = release && platform ? pickDefault(files, platform, detected?.arch ?? null) : null
  const primaryHref = primary ? files.find((f) => f.name === primary.name)?.href : undefined
  const alternatives = platform ? files.filter((f) => f.platform === platform && f.name !== primary?.name) : []
  const date = release ? new Date(release.releasedAt).toLocaleDateString(t.dateLocale, { year: 'numeric', month: 'long', day: 'numeric' }) : ''
  const sumsHref = resolveFileUrl('SHA256SUMS.txt', site.releaseManifestUrl.startsWith('http') || !release?.baseUrl ? site.releaseManifestUrl : `${release.baseUrl}/latest.json`)

  if (!release)
    return (
      <div className="mt-10 max-w-xl rounded-2xl border border-dashed border-border bg-white/70 p-6" data-download-state={loading ? 'loading' : 'empty'} aria-busy={loading}>
        {loading ? (
          <div className="space-y-3">
            <div className="h-11 w-72 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <>
            <h2 className="text-[15px] font-semibold">{t.none.title}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{failed ? t.none.failed : t.none.body}</p>
          </>
        )}
      </div>
    )

  return (
    <div data-download-state="ready">
      <div className="mt-10 flex flex-col items-start gap-3">
        {primary && primaryHref ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="lg" className="h-12 rounded-full pr-6 pl-5 text-[15px]">
              <a href={primaryHref} onClick={() => countDownload(primary, release.version)} data-download-primary={primary.name}>
                <span className="[&_svg]:size-[18px]">{platformIcons[primary.platform]}</span>
                {t.primary.replace('{os}', `${t.platforms[primary.platform]} · ${archLabel(t, primary)}`)}
                <ArrowDown className="size-4" aria-hidden />
              </a>
            </Button>
            {alternatives.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="lg" className="h-12 rounded-full bg-white/80 px-5 text-[14px]">
                    {t.otherFormats} <ChevronDown className="size-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-64">
                  {alternatives.map((f) => (
                    <DropdownMenuItem key={f.name} asChild>
                      <a href={f.href} onClick={() => countDownload(f, release.version)} className="flex justify-between gap-6">
                        <span>
                          {archLabel(t, f)} · {t.kinds[f.kind]}
                        </span>
                        <span className="text-muted-foreground">{formatSize(f.size)}</span>
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ) : (
          <p className="text-[14px] text-muted-foreground">{detected ? t.pickBelow : t.detecting}</p>
        )}
        <p className="text-[13px] text-muted-foreground">
          {t.versionLine.replace('{version}', release.version).replace('{date}', date)}
          {primary ? ` · ${formatSize(primary.size)} · ${t.requirements[primary.platform]}` : ''}
          {release.notesUrl && (
            <>
              {' · '}
              <a href={release.notesUrl} className="underline decoration-border underline-offset-4 hover:text-foreground">
                {t.notes}
              </a>
            </>
          )}
        </p>
      </div>

      <section aria-labelledby="all-downloads" className="mt-14">
        <h2 id="all-downloads" className="text-[15px] font-semibold">
          {t.allTitle}
        </h2>
        <ul className="mt-4 grid gap-4 lg:grid-cols-3">
          {PLATFORMS.map((p) => {
            const mine = files.filter((f) => f.platform === p)
            return (
              <li key={p} className={cn('min-w-0 rounded-2xl border bg-white/85 p-5 backdrop-blur', p === platform ? 'border-foreground/25 ring-1 ring-foreground/10' : 'border-border')} data-platform={p}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5 text-foreground">
                    {platformIcons[p]}
                    <span className="text-[15px] font-semibold">{t.platforms[p]}</span>
                  </span>
                  {p === platform && <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">{t.yourSystem}</span>}
                </div>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{t.requirements[p]}</p>
                {mine.length ? (
                  <ul className="mt-4 divide-y divide-border/70">
                    {mine.map((f) => (
                      <li key={f.name} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-3">
                          <a href={f.href} onClick={() => countDownload(f, release.version)} className="group min-w-0" data-download-file={f.name}>
                            <span className="block text-[14px] font-medium group-hover:underline group-hover:underline-offset-4">
                              {archLabel(t, f)} · {t.kinds[f.kind]}
                            </span>
                            <span className="block truncate text-[12px] text-muted-foreground">
                              {f.name} · {formatSize(f.size)}
                            </span>
                          </a>
                          <Button asChild variant="outline" size="icon-sm" className="shrink-0 rounded-full" aria-label={`${t.downloadFile} ${f.name}`}>
                            <a href={f.href} onClick={() => countDownload(f, release.version)} tabIndex={-1}>
                              <ArrowDown aria-hidden />
                            </a>
                          </Button>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 rounded-md bg-muted/60 py-0.5 pr-0.5 pl-2">
                          <span className="shrink-0 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">{t.sha}</span>
                          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/75" title={f.sha256} data-sha256={f.sha256}>
                            {f.sha256}
                          </code>
                          <CopyButton text={f.sha256} labels={{ copy: t.copySha, copied: common.copied }} className="size-6" />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-[13px] text-muted-foreground">{t.notYet}</p>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden />
          <span>{t.verifyHint}</span>
          <a href={sumsHref} className="underline decoration-border underline-offset-4 hover:text-foreground">
            SHA256SUMS.txt
          </a>
          {site.telemetryUrl && <span>· {t.counted}</span>}
        </p>
      </section>
    </div>
  )
}
