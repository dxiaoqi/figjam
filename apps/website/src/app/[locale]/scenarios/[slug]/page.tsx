import { ArrowRight, Download } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CodeBlock } from '@/components/copy-command'
import { Reveal } from '@/components/reveal'
import { ScenarioCard } from '@/components/scenarios/scenario-cards'
import { ScenarioShot, hasScenarioShot } from '@/components/scenarios/scenario-shot'
import { Container, Eyebrow, SectionHeading, StickyList, sectionY } from '@/components/section'
import { Button } from '@/components/ui/button'
import { site } from '@/config/site'
import { isScenario, scenarioSlugs, scenarios } from '@/content/scenarios'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n'
import { pageMetadata } from '@/lib/seo'
import { cn } from '@/lib/utils'

export const dynamicParams = false

export function generateStaticParams() {
  return scenarioSlugs.map((slug) => ({ slug }))
}

type Params = Promise<{ locale: string; slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale: raw, slug } = await params
  if (!isScenario(slug)) return {}
  const locale = isLocale(raw) ? raw : 'zh'
  const t = getDictionary(locale).scenarios
  const it = t.items[slug]
  return pageMetadata({
    locale,
    path: `/scenarios/${slug}/`,
    title: t.page.metaTitle.replace('{title}', it.title),
    description: `${it.tagline} ${it.summary}`,
    og: `scenario-${slug}`,
  })
}

export default async function ScenarioPage({ params }: { params: Params }) {
  const { locale: raw, slug } = await params
  if (!isScenario(slug)) notFound()
  const locale = isLocale(raw) ? raw : 'zh'
  const d = getDictionary(locale)
  const t = d.scenarios
  const p = t.page
  const it = t.items[slug]
  const meta = scenarios[slug]
  const Icon = meta.icon
  const base = `/${locale}`
  const illustrated = !hasScenarioShot(slug, locale)
  const labels = { copy: d.common.copy, copied: d.common.copied }

  return (
    <>
      {/* Intro */}
      <section className="relative -mt-14 overflow-hidden pt-14">
        <div aria-hidden className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_35%,transparent_90%)]" />
        <Container className="pt-10 pb-10 sm:pt-16 sm:pb-14">
          <nav aria-label={p.breadcrumb}>
            <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
              <li>
                <Link href={`${base}/scenarios/`} className="underline-offset-4 hover:text-foreground hover:underline">
                  {t.eyebrow}
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li aria-current="page" className="text-foreground/80">
                {it.short}
              </li>
            </ol>
          </nav>
          <div className="mt-8 max-w-3xl">
            <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-muted-foreground">
              <span
                className="flex size-7 items-center justify-center rounded-[7px]"
                style={{ background: `var(--tk-${meta.color}-bg)`, color: `var(--tk-${meta.color}-ink)` }}
                aria-hidden
              >
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <span className="rounded-[5px] border border-border bg-card px-1.5 py-px font-mono text-[12px]">{meta.skill}</span>
            </p>
            <h1 className="display mt-5 text-[2.25rem] leading-[1.08] font-semibold sm:text-5xl lg:text-[3.5rem]">{it.title}</h1>
            <p className="headline mt-5 text-lg font-medium text-foreground/85 sm:text-xl">{it.tagline}</p>
            <p className="lede mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-[17px]">{it.summary}</p>
            <div className="mt-8 flex max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row">
              <Button asChild size="lg" className="h-11 rounded-full px-6 text-[15px]">
                <Link href="#try">
                  {p.tryIt}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 rounded-full bg-white/70 px-6 text-[15px]">
                <Link href={`${base}/download/`}>{d.nav.download}</Link>
              </Button>
            </div>
          </div>
        </Container>
        <Container className="pb-16 sm:pb-24">
          <figure>
            <ScenarioShot slug={slug} locale={locale} t={t} priority className="mx-auto max-w-5xl" />
            {illustrated && <figcaption className="mx-auto mt-4 max-w-5xl text-center text-[13px] text-muted-foreground">{p.illustrationNote}</figcaption>}
          </figure>
        </Container>
      </section>

      {/* Problem */}
      <section aria-labelledby="problem" className={cn('border-y border-border/70 bg-white', sectionY)}>
        <Container className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal>
            <Eyebrow dot={`var(--tk-${meta.color}-accent)`}>{it.short}</Eyebrow>
            <h2 id="problem" className="headline mt-4 text-[1.875rem] leading-[1.15] font-semibold sm:text-4xl">
              {p.problem}
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="lede text-base leading-relaxed text-foreground/85 sm:text-[17px]">{it.problem.body}</p>
            <StickyList items={it.problem.points} className="mt-7" />
          </Reveal>
        </Container>
      </section>

      {/* Workflow */}
      <section aria-labelledby="how" className={sectionY}>
        <Container>
          <SectionHeading id="how" eyebrow={meta.skill} title={p.how} lede={p.howLede} dot="var(--tk-agent-0)" />
          <ol className="relative mt-10 max-w-3xl sm:mt-14">
            {it.steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 50} className="relative grid grid-cols-[2.25rem_1fr] gap-4 pb-8 last:pb-0 sm:gap-5">
                {i < it.steps.length - 1 && <span aria-hidden className="absolute top-10 bottom-1 left-[1.125rem] w-px bg-border" />}
                <span
                  className={cn(
                    'relative flex size-9 items-center justify-center rounded-full border font-mono text-[13px] font-medium',
                    s.you ? 'border-transparent' : 'border-border bg-card text-foreground/80',
                  )}
                  style={s.you ? { background: 'var(--tk-yellow-bg)', color: 'var(--tk-yellow-ink)' } : undefined}
                >
                  {i + 1}
                </span>
                <div className="pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[16.5px] font-semibold">{s.title}</h3>
                    <span
                      className="rounded-full px-2 py-px text-[11.5px] font-medium"
                      style={
                        s.you
                          ? { background: 'var(--tk-yellow-bg)', color: 'var(--tk-yellow-ink)' }
                          : { background: 'color-mix(in srgb, var(--tk-agent-0) 12%, white)', color: 'var(--foreground)' }
                      }
                    >
                      {s.you ? p.you : p.agent}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </Container>
      </section>

      {/* Blocks */}
      <section aria-labelledby="blocks" className={cn('border-y border-border/70 bg-white', sectionY)}>
        <Container>
          <SectionHeading id="blocks" eyebrow={meta.skill} title={p.blocks} lede={p.blocksLede} dot={`var(--tk-${meta.color}-accent)`} />
          <ul className="mt-10 grid gap-3 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
            {it.blocks.map((b, i) => {
              const style = meta.blocks[i]
              const BIcon = style.icon
              return (
                <Reveal as="li" key={b.name} delay={(i % 3) * 50} className="flex gap-3.5 rounded-xl border border-border bg-background p-4">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-[8px]"
                    style={{ background: `var(--tk-${style.color}-bg)`, color: `var(--tk-${style.color}-ink)` }}
                    aria-hidden
                  >
                    <BIcon className="size-[18px]" strokeWidth={1.7} />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold">{b.name}</h3>
                    <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">{b.body}</p>
                  </div>
                </Reveal>
              )
            })}
          </ul>
        </Container>
      </section>

      {/* Try it */}
      <section id="try" aria-labelledby="try-title" className={cn('scroll-mt-14', sectionY)}>
        <Container>
          <SectionHeading id="try-title" eyebrow={p.tryIt} title={it.tagline} lede={p.tryLede} dot="var(--tk-green-accent)" />
          <ol className="mt-10 grid gap-5 sm:mt-14 lg:grid-cols-[0.85fr_1.15fr]">
            <li className="grid content-start gap-5">
              <Reveal className="rounded-2xl border border-border bg-card p-6">
                <TryStep n={1} title={p.install.title} />
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{p.install.body}</p>
                <Button asChild variant="outline" className="mt-5 rounded-full">
                  <Link href={`${base}/download/`}>
                    <Download className="size-4" aria-hidden />
                    {p.install.cta}
                  </Link>
                </Button>
              </Reveal>
              <Reveal delay={60} className="rounded-2xl border border-border bg-card p-6">
                <TryStep n={2} title={p.enable.title} />
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{p.enable.body.replace('{skill}', meta.skill)}</p>
                <CodeBlock code={`${site.cli} skill enable ${meta.skill}`} labels={labels} className="mt-4" />
              </Reveal>
            </li>
            <li>
              <Reveal delay={120} className="h-full rounded-2xl border border-border bg-card p-6">
                <TryStep n={3} title={p.paste.title} />
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{p.paste.body}</p>
                <CodeBlock code={it.prompt} labels={labels} lang="md" title={p.promptTitle} wrap className="mt-4" />
              </Reveal>
            </li>
          </ol>
        </Container>
      </section>

      {/* Other scenarios */}
      <section aria-labelledby="others" className={cn('border-t border-border/70 bg-white', sectionY)}>
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="others" className="headline text-2xl font-semibold sm:text-3xl">
              {p.others}
            </h2>
            <Link href={`${base}/scenarios/`} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground underline-offset-4 hover:underline">
              {t.all}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {scenarioSlugs
              .filter((s) => s !== slug)
              .map((s) => (
                <li key={s}>
                  <ScenarioCard locale={locale} t={t} slug={s} />
                </li>
              ))}
          </ul>
        </Container>
      </section>
    </>
  )
}

function TryStep({ n, title }: { n: number; title: string }) {
  return (
    <h3 className="flex items-center gap-3 text-[16.5px] font-semibold">
      <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-foreground font-mono text-[12.5px] text-background">
        {n}
      </span>
      {title}
    </h3>
  )
}

