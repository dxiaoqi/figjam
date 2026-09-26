import { WindowFrame } from '@/components/product-shot'
import { site } from '@/config/site'
import { type ScenarioSlug, scenarios } from '@/content/scenarios'
import type { Locale } from '@/i18n/config'
import type { Dict } from '@/i18n'
import { type ScenarioShotName, scenarioShots } from '@/lib/scenario-shots'

export function ScenarioImage({
  name,
  alt,
  priority,
  sizes = '(min-width: 1152px) 1088px, 100vw',
}: {
  name: ScenarioShotName
  alt: string
  priority?: boolean
  sizes?: string
}) {
  const [w, h] = scenarioShots[name]
  const base = `/media/scenarios/${name}`
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, pre-optimized WebP
    <img
      src={`${base}.webp`}
      srcSet={`${base}-800.webp 800w, ${base}.webp ${w}w, ${base}-2400.webp 2400w`}
      sizes={sizes}
      alt={alt}
      width={w}
      height={h}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className="block h-auto w-full"
    />
  )
}

/** A scenario's board as the product shows it: a key frame, or the whole board with `overview`. */
export function ScenarioShot({
  slug,
  locale,
  t,
  overview,
  priority,
  sizes,
  className,
}: {
  slug: ScenarioSlug
  locale: Locale
  t: Dict['scenarios']
  overview?: boolean
  priority?: boolean
  sizes?: string
  className?: string
}) {
  const item = t.items[slug]
  const name = `${scenarios[slug].skill}-${locale}${overview ? '-overview' : ''}` as ScenarioShotName
  return (
    <WindowFrame title={`${item.boardTitle} — ${site.name}`} className={className}>
      <ScenarioImage name={name} alt={overview ? item.overviewAlt : item.shotAlt} priority={priority} sizes={sizes} />
    </WindowFrame>
  )
}
