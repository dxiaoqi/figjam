import type { Metadata } from 'next'
import { FramedShot } from '@/components/product-shot'
import { Reveal } from '@/components/reveal'
import { Container, Eyebrow } from '@/components/section'
import { type Locale, htmlLang, isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n'
import { isShot } from '@/lib/media'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return { title: getDictionary(isLocale(locale) ? locale : 'zh').meta.changelog }
}

function formatDate(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(htmlLang[locale], { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}

export default async function ChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const t = getDictionary(locale)
  const c = t.changelog

  return (
    <>
      <section className="relative -mt-14 overflow-hidden border-b border-border/70 pt-14">
        <div aria-hidden className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_20%,transparent_100%)]" />
        <Container className="pt-16 pb-14 sm:pt-20">
          <Eyebrow dot="var(--tk-green-accent)">{c.eyebrow}</Eyebrow>
          <h1 className="display mt-5 text-4xl font-semibold sm:text-5xl">{c.title}</h1>
          <p className="lede mt-5 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">{c.lede}</p>
        </Container>
      </section>

      <Container className="py-14 sm:py-20">
        <ol className="relative">
          {c.entries.map((e, i) => (
            <Reveal as="li" key={`${e.date}-${e.title}`} className="grid gap-4 pb-16 last:pb-0 md:grid-cols-[180px_minmax(0,1fr)] md:gap-12">
              <div className="md:sticky md:top-24 md:self-start">
                <time dateTime={e.date} className="text-[13.5px] font-medium text-foreground">
                  {formatDate(e.date, locale)}
                </time>
                {e.tag && (
                  <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium md:mt-2 md:ml-0 md:inline-block" style={{ background: 'var(--tk-green-bg)', color: 'var(--tk-green-ink)' }}>
                    {e.tag}
                  </span>
                )}
              </div>
              <article className={i < c.entries.length - 1 ? 'border-b border-border/70 pb-16 md:border-0 md:pb-0' : undefined}>
                <h2 className="headline text-2xl font-semibold">{e.title}</h2>
                <ul className="mt-5 space-y-2.5">
                  {e.items.map((it) => (
                    <li key={it} className="flex gap-3 text-[15px] leading-7 text-foreground/80">
                      <span aria-hidden className="mt-[11px] size-1.5 shrink-0 rounded-full bg-foreground/30" />
                      {it}
                    </li>
                  ))}
                </ul>
                {e.image && isShot(e.image) && <FramedShot name={e.image} alt={e.title} bare className="mt-8 max-w-3xl" />}
              </article>
            </Reveal>
          ))}
        </ol>
      </Container>
    </>
  )
}
