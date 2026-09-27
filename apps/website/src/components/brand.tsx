import { site } from '@/config/site'
import { cn } from '@/lib/utils'

const CURSOR = 'M14 14L26 18.5L20 20L18.5 26Z'

/** The app icon's small tile (assets/brand/icon-small.svg, also the favicon): a sticky with an agent cursor on it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex size-6', className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-full [filter:drop-shadow(0_0_0_1px_rgba(28,25,23,0.16))] dark:[filter:drop-shadow(0_0_0_1px_rgba(255,255,255,0.28))]">
        <rect width="32" height="32" rx="7.5" fill="#1C1917" />
        <rect x="6" y="6" width="12" height="12" rx="2" fill="#FFF1B8" />
        <path d={CURSOR} fill="#D97757" stroke="#1C1917" strokeWidth="3" strokeLinejoin="round" />
        <path d={CURSOR} fill="#D97757" stroke="#D97757" strokeWidth="1" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function BrandName({ className }: { className?: string }) {
  return <span className={cn('font-semibold tracking-[-0.01em]', className)}>{site.name}</span>
}
