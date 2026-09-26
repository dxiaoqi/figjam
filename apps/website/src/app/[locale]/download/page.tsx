import type { Metadata } from 'next'
import { BetaForm } from '@/components/beta-form'
import { CodeBlock } from '@/components/copy-command'
import { FramedShot } from '@/components/product-shot'
import { Reveal } from '@/components/reveal'
import { Container, Eyebrow } from '@/components/section'
import { commands } from '@/content/commands'
import { site } from '@/config/site'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return { title: getDictionary(isLocale(locale) ? locale : 'zh').meta.download }
}

const platformIcons: Record<string, React.ReactNode> = {
  macOS: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M16.37 12.6c-.02-2.08 1.7-3.08 1.78-3.13-.97-1.42-2.48-1.61-3.02-1.63-1.28-.13-2.51.76-3.16.76-.65 0-1.66-.74-2.72-.72-1.4.02-2.69.81-3.41 2.07-1.46 2.52-.37 6.26 1.04 8.31.7 1 1.52 2.12 2.6 2.08 1.05-.04 1.44-.67 2.7-.67 1.26 0 1.62.67 2.72.65 1.13-.02 1.84-1.02 2.52-2.03.8-1.16 1.12-2.29 1.14-2.35-.03-.01-2.18-.84-2.2-3.34ZM14.3 6.5c.57-.7.96-1.66.85-2.63-.82.03-1.83.55-2.42 1.24-.53.61-.99 1.6-.87 2.54.92.07 1.86-.46 2.44-1.15Z" />
    </svg>
  ),
  Windows: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M3 5.5 10.5 4.5v7H3v-6Zm8.5-1.1L21 3v8.5h-9.5V4.4ZM3 12.5h7.5v7L3 18.5v-6Zm8.5 0H21V21l-9.5-1.4v-7.1Z" />
    </svg>
  ),
  Linux: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="m7 9 3 2.5L7 14M12.5 14H17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const t = getDictionary(locale)
  const d = t.download
  const stepCode = [commands.clone, commands.install, commands.desktop, commands.package]

  return (
    <>
      <section className="relative -mt-14 overflow-hidden pt-14">
        <div aria-hidden className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_30%,transparent_95%)]" />
        <Container className="pt-16 pb-16 sm:pt-24">
          <Reveal className="max-w-2xl">
            <Eyebrow>{d.eyebrow}</Eyebrow>
            <h1 className="display mt-5 text-4xl font-semibold sm:text-5xl lg:text-6xl">{d.title}</h1>
            <p className="lede mt-6 text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{d.lede}</p>
          </Reveal>

          <ul className="mt-12 grid gap-4 sm:grid-cols-3">
            {d.platforms.map((p, i) => (
              <Reveal as="li" key={p.name} delay={i * 60} className="rounded-2xl border border-border bg-white/85 p-5 backdrop-blur">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5 text-foreground">
                    {platformIcons[p.name]}
                    <span className="text-[15px] font-semibold">{p.name}</span>
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">{p.status}</span>
                </div>
                <p className="mt-1.5 text-[13px] text-muted-foreground">{p.detail}</p>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="mt-5 inline-flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md border border-dashed border-border text-[13.5px] text-muted-foreground"
                >
                  {d.unavailable}
                </button>
              </Reveal>
            ))}
          </ul>
        </Container>
      </section>

      <section id="beta" aria-labelledby="beta-title" className="scroll-mt-20 border-y border-border/70 bg-white py-20 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <Reveal>
            <h2 id="beta-title" className="headline text-3xl font-semibold sm:text-4xl">
              {d.beta.title}
            </h2>
            <p className="lede mt-4 max-w-md text-[16px] leading-relaxed text-muted-foreground">{d.beta.body}</p>
            <div className="mt-8 max-w-lg">
              <BetaForm t={d.beta} />
            </div>
          </Reveal>
          <Reveal delay={100}>
            <FramedShot name={locale === 'zh' ? 'desktop-zh' : 'desktop-app'} alt={d.shotAlt} bare />
          </Reveal>
        </Container>
      </section>

      <section id="source" aria-labelledby="source-title" className="scroll-mt-20 py-20 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <Reveal>
            <h2 id="source-title" className="headline text-3xl font-semibold sm:text-4xl">
              {d.source.title}
            </h2>
            <p className="lede mt-4 max-w-md text-[16px] leading-relaxed text-muted-foreground">{d.source.lede}</p>
            <div className="mt-10 rounded-2xl border border-border bg-white p-6">
              <h3 className="text-[15px] font-semibold">{d.unsigned.title}</h3>
              <dl className="mt-4 space-y-3.5">
                {d.unsigned.items.map((u) => (
                  <div key={u.os} className="grid grid-cols-[5.5rem_1fr] gap-3 text-[14px]">
                    <dt className="font-medium text-foreground">{u.os}</dt>
                    <dd className="leading-relaxed text-muted-foreground">{u.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
          <ol className="space-y-6">
            {d.source.steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 60} className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="flex size-7 items-center justify-center rounded-full border border-border bg-white font-mono text-[12px] text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="pt-0.5 text-[15px] font-semibold">{s.title}</h3>
                  {s.note && <p className="mt-1 text-[14px] text-muted-foreground">{s.note}</p>}
                  <CodeBlock code={stepCode[i]} labels={t.common} className="mt-3" />
                </div>
              </Reveal>
            ))}
            <Reveal as="li" className="pl-11 text-[14px] text-muted-foreground">
              {d.source.browserNote}{' '}
              <a href={site.repoUrl} className="underline decoration-border underline-offset-4 hover:text-foreground" target="_blank" rel="noreferrer">
                {t.footer.source} ↗
              </a>
            </Reveal>
          </ol>
        </Container>
      </section>
    </>
  )
}
