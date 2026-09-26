import { WindowFrame } from '@/components/product-shot'
import { type ScenarioSlug, scenarios } from '@/content/scenarios'
import type { Dict } from '@/i18n'
import { cn } from '@/lib/utils'

type Item = Dict['scenarios']['items'][ScenarioSlug]

/**
 * The board a scenario's Skill produces, drawn with the canvas tokens: typed cards in frames, the agent's
 * latest round still pending review. Stands in until a real screenshot is imported.
 */
export function ScenarioBoard({
  slug,
  item,
  badge,
  compact,
  className,
}: {
  slug: ScenarioSlug
  item: Item
  badge: string
  compact?: boolean
  className?: string
}) {
  const styles = scenarios[slug].blocks
  const frames = item.board.frames
  return (
    <WindowFrame title={item.board.title} className={className}>
      <div role="img" aria-label={item.shotAlt} className={cn('dot-grid relative', compact ? 'p-3 sm:p-4' : 'p-4 sm:p-7')}>
        <p className="-mt-1 mb-2 flex justify-end sm:-mt-3">
          <span className="rounded-full border border-black/[0.06] bg-white/80 px-2 py-0.5 text-[10.5px] font-medium text-stone-600">{badge}</span>
        </p>
        <div className={cn('grid gap-3 sm:grid-cols-2', compact ? 'sm:gap-3' : 'sm:gap-5')}>
          {frames.map((f, fi) => {
            const pending = fi === frames.length - 1
            const items = compact ? f.items.slice(0, 3) : f.items
            return (
              <div key={f.title} className="rounded-[10px] border border-black/[0.08] bg-white/55 p-2.5 sm:p-3">
                <p className="px-0.5 pb-2 text-[11px] font-medium text-stone-600">{f.title}</p>
                <ul className="grid gap-2">
                  {items.map((it, i) => {
                    const style = styles[it.block]
                    const Icon = style.icon
                    const last = pending && i === items.length - 1
                    return (
                      <li
                        key={`${it.title}-${i}`}
                        className={cn(
                          'relative rounded-[6px] bg-white px-2.5 py-2 shadow-[0_1px_1px_rgb(0_0_0/0.04),0_2px_8px_-2px_rgb(0_0_0/0.08)]',
                          pending && 'pending-outline',
                        )}
                        style={{ borderLeft: `3px solid var(--tk-${style.color}-accent)` }}
                      >
                        <span
                          className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px text-[10.5px] font-medium"
                          style={{ background: `var(--tk-${style.color}-bg)`, color: `var(--tk-${style.color}-ink)` }}
                        >
                          <Icon className="size-3" strokeWidth={1.8} />
                          {item.blocks[it.block].name}
                        </span>
                        <p className="mt-1 text-[12.5px] leading-snug font-medium text-stone-900">{it.title}</p>
                        <p className="text-[11px] leading-snug text-stone-600">{it.meta}</p>
                        {last && (
                          <span className="absolute -right-1 -bottom-5 z-10 flex items-start">
                            <svg width="14" height="16" viewBox="0 0 16 18">
                              <path d="M1 1l13 6.5-5.6 1.6L6 15z" fill="var(--tk-agent-0)" stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
                            </svg>
                            <span className="mt-2.5 rounded-full px-1.5 py-[2px] text-[10px] font-medium whitespace-nowrap text-white" style={{ background: 'var(--tk-agent-0)' }}>
                              Claude Code
                            </span>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </WindowFrame>
  )
}
