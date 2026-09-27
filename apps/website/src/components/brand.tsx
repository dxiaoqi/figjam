import { site } from '@/config/site'
import { cn } from '@/lib/utils'

const CURSOR = 'M14 14L26 18.5L20 20L18.5 26Z'

/** The app icon's small tile (assets/brand/icon-small.svg, also the favicon): a sticky with an agent cursor on it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-6', className)}>
      <rect width="32" height="32" rx="7.5" fill="#1C1917" />
      <rect x="6" y="6" width="12" height="12" rx="2" fill="#FFF1B8" />
      <path d={CURSOR} fill="#D97757" stroke="#1C1917" strokeWidth="3" strokeLinejoin="round" />
      <path d={CURSOR} fill="#D97757" stroke="#D97757" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  )
}

export function BrandName({ className }: { className?: string }) {
  return <span className={cn('font-semibold tracking-[-0.01em]', className)}>{site.name}</span>
}
