import type { Metadata } from 'next'
import { ChevronDown } from 'lucide-react'
import { BetaForm } from '@/components/beta-form'
import { CodeBlock } from '@/components/copy-command'
import { DownloadPicker } from '@/components/download/download-picker'
import { FramedShot } from '@/components/product-shot'
import { Reveal } from '@/components/reveal'
import { Container, Eyebrow } from '@/components/section'
import { commands } from '@/content/commands'
import { site } from '@/config/site'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n'
import { pageMetadata } from '@/lib/seo'
import { loadRelease } from '@/lib/load-release'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const m = getDictionary(locale).meta
  return pageMetadata({ locale, path: '/download/', title: m.download, description: m.downloadDescription, og: 'download' })
}

export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const t = getDictionary(locale)
  const d = t.download
  const release = await loadRelease()
  const stepCode = [commands.clone, commands.install, commands.desktop, commands.package]

  return (
    <>
      <section className="relative -mt-14 overflow-hidden pt-14">
        <div aria-hidden className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_30%,transparent_95%)]" />
        <Container className="pt-16 pb-20 sm:pt-24">
          <Reveal className="max-w-2xl">
            <Eyebrow>{d.eyebrow}</Eyebrow>
            <h1 className="display mt-5 text-4xl font-semibold sm:text-5xl lg:text-6xl">{d.title}</h1>
            <p className="lede mt-6 text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{d.lede}</p>
          </Reveal>
          <DownloadPicker initial={release} t={d} common={t.common} />
        </Container>
      </section>

      <section id="first-launch" aria-labelledby="first-launch-title" className="scroll-mt-20 border-y border-border/70 bg-white py-20 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 [&>*]:min-w-0">
          <Reveal>
            <h2 id="first-launch-title" className="headline text-3xl font-semibold sm:text-4xl">
              {d.firstLaunch.title}
            </h2>
            <p className="lede mt-4 max-w-md text-[16px] leading-relaxed text-muted-foreground">{d.firstLaunch.lede}</p>
            <dl className="mt-8 space-y-4">
              {d.firstLaunch.items.map((u) => (
                <div key={u.os} className="grid grid-cols-[5.5rem_1fr] gap-3 text-[14px]">
                  <dt className="font-medium text-foreground">{u.os}</dt>
                  <dd className="leading-relaxed text-muted-foreground">{u.body}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={100} className="space-y-8">
            <div>
              <h3 className="text-[15px] font-semibold">{d.verify.title}</h3>
              <p className="mt-1 text-[14px] text-muted-foreground">{d.verify.body}</p>
              <CodeBlock code={d.verify.code} labels={t.common} className="mt-3" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold">{d.agents.title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{d.agents.body}</p>
            </div>
            <FramedShot name={locale === 'zh' ? 'empty-board-zh' : 'empty-board-en'} alt={d.shotAlt} title={site.name} />
          </Reveal>
        </Container>
      </section>

      <section id="beta" aria-labelledby="beta-title" className="scroll-mt-20 py-20 sm:py-24">
        <Container className="max-w-2xl">
          <Reveal>
            <h2 id="beta-title" className="headline text-3xl font-semibold sm:text-4xl">
              {d.beta.title}
            </h2>
            <p className="lede mt-4 max-w-md text-[16px] leading-relaxed text-muted-foreground">{d.beta.body}</p>
            <div className="mt-8 max-w-lg">
              <BetaForm t={d.beta} />
            </div>
          </Reveal>
        </Container>
      </section>

      <section id="source" aria-labelledby="source-title" className="scroll-mt-20 border-t border-border/70 py-16">
        <Container>
          <details className="group rounded-2xl border border-border bg-white/70 p-6 open:bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
              <span>
                <h2 id="source-title" className="text-[17px] font-semibold">
                  {d.source.title}
                </h2>
                <span className="mt-1 block text-[14px] text-muted-foreground">{d.source.lede}</span>
              </span>
              <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ol className="mt-8 space-y-6">
              {d.source.steps.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-3">
                  <span className="flex size-7 items-center justify-center rounded-full border border-border bg-white font-mono text-[12px] text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0">
                    <h3 className="pt-0.5 text-[15px] font-semibold">{s.title}</h3>
                    {s.note && <p className="mt-1 text-[14px] text-muted-foreground">{s.note}</p>}
                    <CodeBlock code={stepCode[i]} labels={t.common} className="mt-3" />
                  </div>
                </li>
              ))}
              <li className="pl-11 text-[14px] text-muted-foreground">
                {d.source.browserNote}{' '}
                <a href={site.repoUrl} className="whitespace-nowrap underline decoration-border underline-offset-4 hover:text-foreground" target="_blank" rel="noreferrer">
                  {t.footer.source} ↗
                </a>
              </li>
            </ol>
          </details>
        </Container>
      </section>
    </>
  )
}
