import { ArrowRight, Archive, FileLock2, HardDrive, History, KeyRound, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { ReviewDemo } from '@/components/home/review-demo'
import { ShotTabs } from '@/components/home/shot-tabs'
import { FramedShot, Shot, WindowFrame } from '@/components/product-shot'
import { ProductVideo } from '@/components/product-video'
import { Reveal } from '@/components/reveal'
import { Container, Eyebrow, SectionHeading, StickyList } from '@/components/section'
import { Button } from '@/components/ui/button'
import { site } from '@/config/site'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n'

const localIcons = [HardDrive, History, Archive, ShieldCheck, KeyRound, FileLock2]

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const t = getDictionary(locale)
  const h = t.home
  const base = `/${locale}`
  const boardTitle = locale === 'zh' ? `访谈综合 — ${site.name}` : `Onboarding research — ${site.name}`

  return (
    <>
      {/* Hero */}
      <section className="relative -mt-14 overflow-hidden pt-14">
        <div aria-hidden className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_40%,transparent_92%)]" />
        <Container className="relative pt-16 pb-10 text-center sm:pt-24">
          <HeroStickies a={h.hero.stickyA} b={h.hero.stickyB} />
          <Reveal>
            <p className="chrome mx-auto inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[12.5px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[#10A37F]" aria-hidden />
              {h.hero.eyebrow}
            </p>
          </Reveal>
          <Reveal delay={60}>
            <h1 className="display mx-auto mt-7 max-w-4xl text-[2.6rem] leading-[1.05] font-semibold text-foreground sm:text-6xl lg:text-[4.5rem]">
              {h.hero.titleA} <span className="marker whitespace-nowrap sm:whitespace-normal">{h.hero.titleB}</span>
            </h1>
          </Reveal>
          <Reveal delay={120}>
            <p className="lede mx-auto mt-7 max-w-2xl text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{h.hero.lede}</p>
          </Reveal>
          <Reveal delay={180} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 rounded-full px-6 text-[15px]">
              <Link href={`${base}/download/#beta`}>
                {h.hero.primary}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 rounded-full bg-white/70 px-6 text-[15px]">
              <Link href={`${base}/docs/`}>{h.hero.secondary}</Link>
            </Button>
          </Reveal>
          <Reveal delay={240}>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-[13px] text-muted-foreground" aria-label={h.hero.worksWith}>
              <li className="mr-1">{h.hero.worksWith}</li>
              {['Claude Code', 'Cursor', 'Codex', h.hero.anyMcp, h.hero.terminal].map((a) => (
                <li key={a} className="rounded-full border border-border bg-white/80 px-2.5 py-0.5 text-foreground/80">
                  {a}
                </li>
              ))}
            </ul>
          </Reveal>
        </Container>
        <Container className="pb-20 sm:pb-28">
          <Reveal delay={200}>
            <figure>
              <WindowFrame title={boardTitle} className="mx-auto max-w-5xl">
                <ProductVideo
                  src="/media/hero-agent-run"
                  poster="/media/hero-agent-run-poster.webp"
                  label={h.hero.videoLabel}
                  playLabel={t.common.play}
                  pauseLabel={t.common.pause}
                />
              </WindowFrame>
              <figcaption className="mx-auto mt-5 max-w-2xl text-center text-[13px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground/80">{t.common.realRecording}</span> · {h.hero.caption}
              </figcaption>
            </figure>
          </Reveal>
        </Container>
      </section>

      {/* How it works */}
      <section aria-labelledby="how" className="border-t border-border/70 bg-white py-24 sm:py-32">
        <Container>
          <SectionHeading id="how" eyebrow={h.steps.eyebrow} title={h.steps.title} lede={h.steps.lede} dot="var(--tk-agent-0)" />
          <ol className="mt-14 grid gap-5 md:grid-cols-3">
            {h.steps.items.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 80} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background">
                <div className="p-6 pb-5">
                  <span className="font-mono text-[12px] text-muted-foreground">0{i + 1}</span>
                  <h3 className="headline mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
                <div className="mt-auto border-t border-border/70 bg-canvas px-4 pt-4">
                  <div className="overflow-hidden rounded-t-lg border border-b-0 border-black/[0.07] shadow-[0_-1px_12px_-4px_rgb(0_0_0/0.08)]">
                    <Shot name={([locale === 'zh' ? 'step-connect-zh' : 'step-connect-en', 'step-drafting', 'step-review'] as const)[i]} alt={s.alt}  />
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </Container>
      </section>

      <div id="features" className="scroll-mt-14" />

      {/* Canvas feel */}
      <section aria-labelledby="canvas" className="py-24 sm:py-32">
        <Container className="grid items-center gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <SectionHeading id="canvas" eyebrow={h.canvas.eyebrow} title={h.canvas.title} lede={h.canvas.body} />
            <Reveal delay={80}>
              <StickyList items={h.canvas.points} className="mt-8" />
            </Reveal>
          </div>
          <Reveal delay={120}>
            <WindowFrame title={boardTitle}>
              <ProductVideo
                src="/media/canvas-feel"
                poster="/media/canvas-feel-poster.webp"
                label={h.canvas.videoLabel}
                playLabel={t.common.play}
                pauseLabel={t.common.pause}
              />
            </WindowFrame>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <FramedShot name="canvas-guides" alt={h.canvas.alts.guides} bare />
              <FramedShot name="canvas-connectors" alt={h.canvas.alts.connectors} bare />
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Agent presence & review */}
      <section aria-labelledby="presence" className="border-y border-border/70 bg-white py-24 sm:py-32">
        <Container className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <Reveal className="order-2 lg:order-1">
            <ReviewDemo t={h.presence.demo} />
          </Reveal>
          <div className="order-1 lg:order-2">
            <SectionHeading id="presence" eyebrow={h.presence.eyebrow} title={h.presence.title} lede={h.presence.body} dot="var(--tk-agent-0)" />
            <Reveal delay={80}>
              <StickyList items={h.presence.points} className="mt-8" />
            </Reveal>
          </div>
        </Container>
        <Container className="mt-16">
          <Reveal>
            <FramedShot name="comment-reply" alt={h.presence.commentAlt} title={boardTitle} className="mx-auto max-w-5xl" />
          </Reveal>
        </Container>
      </section>

      {/* Typed blocks */}
      <section aria-labelledby="typed" className="py-24 sm:py-32">
        <Container>
          <SectionHeading id="typed" align="center" eyebrow={h.typed.eyebrow} title={h.typed.title} lede={h.typed.body} dot="var(--tk-purple-accent)" />
          <Reveal delay={80} className="mx-auto mt-12 max-w-5xl">
            <ShotTabs tabs={h.typed.tabs} shots={['typed-board', 'typed-slash', 'typed-filter']} alts={h.typed.alts} />
          </Reveal>
        </Container>
      </section>

      {/* Web snippets */}
      <section aria-labelledby="snippets" className="border-y border-border/70 bg-white py-24 sm:py-32">
        <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <SectionHeading id="snippets" eyebrow={h.snippets.eyebrow} title={h.snippets.title} lede={h.snippets.body} dot="var(--tk-blue-accent)" />
            <Reveal delay={80}>
              <StickyList items={h.snippets.points} className="mt-8" />
            </Reveal>
          </div>
          <Reveal delay={120} className="mx-auto w-full max-w-md lg:max-w-none">
            <div className="dot-grid rounded-2xl border border-border p-4 sm:p-6">
              <FramedShot name="snippet-running" alt={h.snippets.alt} bare className="rounded-lg" />
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Skills */}
      <section aria-labelledby="skills" className="py-24 sm:py-32">
        <Container>
          <SectionHeading id="skills" eyebrow={h.skills.eyebrow} title={h.skills.title} lede={h.skills.body} dot="var(--tk-orange-accent)" />
          <div className="mt-12 grid items-start gap-10 lg:grid-cols-[1fr_0.42fr]">
            <Reveal className="relative">
              <FramedShot name="skills-matrix" alt={h.skills.alts.matrix} title={locale === 'zh' ? `白板市场 — 竞品 — ${site.name}` : `Whiteboard market — competitors — ${site.name}`} />
              <div className="absolute -bottom-8 left-4 hidden w-[46%] sm:block">
                <FramedShot name="skills-permission" alt={h.skills.alts.permission} bare className="rounded-lg" />
              </div>
            </Reveal>
            <Reveal delay={100} className="lg:pt-6">
              <StickyList items={h.skills.points} />
              <div className="mt-8">
                <Button asChild variant="outline" className="rounded-full">
                  <Link href={`${base}/docs/#skills`}>
                    SKILL.md
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Local-first & security */}
      <section aria-labelledby="local" className="dot-grid-dark relative py-24 text-white sm:py-32">
        <Container>
          <Reveal className="max-w-2xl">
            <Eyebrow dot="var(--tk-green-accent)" className="text-white/60">
              {h.local.eyebrow}
            </Eyebrow>
            <h2 id="local" className="headline mt-4 text-3xl font-semibold sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
              {h.local.title}
            </h2>
            <p className="lede mt-5 text-[17px] leading-relaxed text-white/65">{h.local.lede}</p>
          </Reveal>
          <ul className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {h.local.items.map((it, i) => {
              const Icon = localIcons[i]
              return (
                <Reveal as="li" key={it.title} delay={(i % 3) * 60} className="bg-[#18181B] p-6 sm:p-7">
                  <Icon className="size-5 text-white/70" aria-hidden strokeWidth={1.6} />
                  <h3 className="mt-5 text-[15.5px] font-semibold">{it.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/60">{it.body}</p>
                </Reveal>
              )
            })}
          </ul>
          <Reveal className="mt-14">
            <FramedShot name="version-history" alt={h.local.alt} bare className="mx-auto max-w-5xl border-white/10" />
          </Reveal>
        </Container>
      </section>

      {/* Templates */}
      <section aria-labelledby="templates" className="py-24 sm:py-32">
        <Container>
          <SectionHeading id="templates" align="center" eyebrow={h.templates.eyebrow} title={h.templates.title} lede={h.templates.body} dot="var(--tk-teal-accent)" />
          <Reveal delay={80} className="mx-auto mt-12 max-w-5xl">
            <ShotTabs
              tabs={h.templates.tabs}
              shots={locale === 'zh' ? ['templates-zh', 'template-research-zh', 'template-brainstorm-zh'] : ['templates-en', 'template-research-en', 'template-brainstorm-en']}
              alts={h.templates.alts}
            />
          </Reveal>
        </Container>
      </section>

      {/* CTA */}
      <section aria-labelledby="cta" className="relative overflow-hidden border-t border-border/70 py-24 sm:py-32">
        <div aria-hidden className="dot-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <Container className="text-center">
          <Reveal>
            <h2 id="cta" className="display mx-auto max-w-3xl text-4xl font-semibold sm:text-5xl">
              {h.cta.title}
            </h2>
            <p className="lede mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-muted-foreground">{h.cta.body}</p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 rounded-full px-6 text-[15px]">
                <Link href={`${base}/download/#beta`}>
                  {h.cta.primary}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 rounded-full bg-white/70 px-6 text-[15px]">
                <Link href={`${base}/download/#source`}>{h.cta.secondary}</Link>
              </Button>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  )
}

/** Two stickies and an agent cursor floating beside the headline, drawn with the canvas tokens. */
function HeroStickies({ a, b }: { a: string; b: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
      <div
        className="animate-sticky-in absolute top-24 left-0 size-36 -rotate-[4deg] rounded-[4px] p-4 text-left text-[15px] leading-snug font-[450] shadow-[0_1px_1px_rgb(0_0_0/0.04),0_6px_16px_rgb(0_0_0/0.06)]"
        style={{ background: 'var(--tk-yellow-bg)', color: 'var(--tk-yellow-ink)', animationDelay: '300ms' }}
      >
        {a}
      </div>
      <div
        className="animate-sticky-in absolute top-56 right-2 size-32 rotate-[3deg] rounded-[4px] p-4 text-left text-[15px] leading-snug font-[450] shadow-[0_1px_1px_rgb(0_0_0/0.04),0_6px_16px_rgb(0_0_0/0.06)]"
        style={{ background: 'var(--tk-teal-bg)', color: 'var(--tk-teal-ink)', animationDelay: '520ms' }}
      >
        {b}
        <span className="absolute -inset-[5px] rounded-[8px] border-[1.5px] border-dashed" style={{ borderColor: 'var(--tk-agent-0)' }} />
      </div>
      <div className="animate-sticky-in absolute top-[23.5rem] right-20 flex items-start" style={{ animationDelay: '800ms' }}>
        <svg width="16" height="18" viewBox="0 0 16 18">
          <path d="M1 1l13 6.5-5.6 1.6L6 15z" fill="var(--tk-agent-0)" stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span className="mt-3 ml-0.5 rounded-full px-2 py-[3px] text-[11px] font-medium text-white" style={{ background: 'var(--tk-agent-0)' }}>
          Claude Code
        </span>
      </div>
    </div>
  )
}
