import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Reveal } from '@/components/reveal'
import { ScenarioShot } from '@/components/scenarios/scenario-shot'
import { type ScenarioSlug, scenarioSlugs, scenarios } from '@/content/scenarios'
import type { Locale } from '@/i18n/config'
import type { Dict } from '@/i18n'
import { cn } from '@/lib/utils'

export function scenarioHref(locale: Locale, slug: ScenarioSlug) {
  return `/${locale}/scenarios/${slug}/`
}

function SkillTag({ skill }: { skill: string }) {
  return <span className="rounded-[5px] border border-border bg-background px-1.5 py-px font-mono text-[11.5px] text-muted-foreground">{skill}</span>
}

/** The lead scenario as a wide card with its board, followed by the others as a grid. */
export function ScenarioGrid({ locale, t, headingLevel = 3 }: { locale: Locale; t: Dict['scenarios']; headingLevel?: 2 | 3 }) {
  const [lead, ...rest] = scenarioSlugs
  const H = `h${headingLevel}` as const
  const leadItem = t.items[lead]
  const LeadIcon = scenarios[lead].icon
  return (
    <div className="grid gap-5">
      <Reveal>
        <Link
          href={scenarioHref(locale, lead)}
          className="group grid items-center gap-8 overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors hover:border-foreground/20 sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10"
        >
          <div>
            <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
              <LeadIcon className="size-4" aria-hidden strokeWidth={1.7} style={{ color: `var(--tk-${scenarios[lead].color}-accent)` }} />
              {t.lead}
              <SkillTag skill={scenarios[lead].skill} />
            </p>
            <H className="headline mt-4 text-2xl font-semibold text-foreground sm:text-[1.75rem]">{leadItem.title}</H>
            <p className="mt-2 text-[15px] font-medium text-foreground/80">{leadItem.tagline}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{leadItem.summary}</p>
            <span className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground">
              {t.open}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </div>
          <ScenarioShot slug={lead} locale={locale} t={t} compact sizes="(min-width: 1024px) 600px, 100vw" />
        </Link>
      </Reveal>
      <ul className="grid gap-5 sm:grid-cols-2">
        {rest.map((slug, i) => (
          <Reveal as="li" key={slug} delay={(i % 2) * 60}>
            <ScenarioCard locale={locale} t={t} slug={slug} headingLevel={headingLevel} />
          </Reveal>
        ))}
      </ul>
    </div>
  )
}

export function ScenarioCard({
  locale,
  t,
  slug,
  headingLevel = 3,
  className,
}: {
  locale: Locale
  t: Dict['scenarios']
  slug: ScenarioSlug
  headingLevel?: 2 | 3
  className?: string
}) {
  const it = t.items[slug]
  const meta = scenarios[slug]
  const Icon = meta.icon
  const H = `h${headingLevel}` as const
  return (
    <Link
      href={scenarioHref(locale, slug)}
      className={cn('group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-foreground/20', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="flex size-9 items-center justify-center rounded-[8px]"
          style={{ background: `var(--tk-${meta.color}-bg)`, color: `var(--tk-${meta.color}-ink)` }}
          aria-hidden
        >
          <Icon className="size-[18px]" strokeWidth={1.7} />
        </span>
        <SkillTag skill={meta.skill} />
      </div>
      <H className="headline mt-5 text-lg font-semibold text-foreground">{it.title}</H>
      <p className="mt-1 text-[14.5px] font-medium text-foreground/80">{it.tagline}</p>
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{it.summary}</p>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[13.5px] font-medium text-foreground">
        {t.open}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  )
}
