import type { Metadata } from 'next'
import { WindowFrame } from '@/components/product-shot'
import { ProductVideo } from '@/components/product-video'
import { ScenarioGrid } from '@/components/scenarios/scenario-cards'
import { Container, Eyebrow } from '@/components/section'
import { site } from '@/config/site'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n'
import { pageMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const t = getDictionary(locale).scenarios
  return pageMetadata({ locale, path: '/scenarios/', title: t.eyebrow, description: t.lede, og: 'scenarios' })
}

export default async function ScenariosPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const d = getDictionary(locale)
  const t = d.scenarios
  return (
    <section className="relative -mt-14 overflow-hidden pt-14">
      <div aria-hidden className="dot-grid absolute inset-x-0 top-0 -z-10 h-[28rem] [mask-image:linear-gradient(to_bottom,black_30%,transparent)]" />
      <Container className="pt-12 pb-20 sm:pt-20 sm:pb-28">
        <div className="max-w-3xl">
          <Eyebrow dot="var(--tk-blue-accent)">{t.eyebrow}</Eyebrow>
          <h1 className="display mt-5 text-[2.25rem] leading-[1.1] font-semibold sm:text-5xl">{t.title}</h1>
          <p className="lede mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">{t.lede}</p>
        </div>
        <div className="mt-10 sm:mt-14">
          <figure>
            <WindowFrame title={`${t.eyebrow} — ${site.name}`} className="mx-auto max-w-5xl">
              <ProductVideo src="/media/scenarios-flow" poster="scenarios-flow-poster" label={t.flow.label} playLabel={d.common.play} pauseLabel={d.common.pause} />
            </WindowFrame>
            <figcaption className="mx-auto mt-4 max-w-2xl text-center text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">{d.common.realRecording}</span> · {t.flow.caption}
            </figcaption>
          </figure>
        </div>
        <div className="mt-14 sm:mt-20">
          <ScenarioGrid locale={locale} t={t} headingLevel={2} />
        </div>
      </Container>
    </section>
  )
}
