import { WindowFrame } from '@/components/product-shot'
import { ScenarioBoard } from '@/components/scenarios/scenario-board'
import { type ScenarioSlug, scenarios } from '@/content/scenarios'
import type { Locale } from '@/i18n/config'
import type { Dict } from '@/i18n'
import { scenarioShots } from '@/lib/scenario-shots'

export function hasScenarioShot(slug: ScenarioSlug, locale: Locale) {
  return `${scenarios[slug].skill}-${locale}` in scenarioShots
}

/** The real screenshot when one has been imported, otherwise the token-drawn illustration. */
export function ScenarioShot({
  slug,
  locale,
  t,
  compact,
  priority,
  sizes = '(min-width: 1152px) 1088px, 100vw',
  className,
}: {
  slug: ScenarioSlug
  locale: Locale
  t: Dict['scenarios']
  compact?: boolean
  priority?: boolean
  sizes?: string
  className?: string
}) {
  const item = t.items[slug]
  const name = `${scenarios[slug].skill}-${locale}`
  const size = scenarioShots[name]
  if (!size) return <ScenarioBoard slug={slug} item={item} badge={t.page.illustration} compact={compact} className={className} />
  const [w, h] = size
  return (
    <WindowFrame title={item.board.title} className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, pre-optimized WebP */}
      <img
        src={`/media/scenarios/${name}.webp`}
        srcSet={`/media/scenarios/${name}-800.webp 800w, /media/scenarios/${name}.webp ${w}w`}
        sizes={sizes}
        alt={item.shotAlt}
        width={w}
        height={h}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        className="block h-auto w-full"
      />
    </WindowFrame>
  )
}
