import { site } from '@/config/site'
import { cn } from '@/lib/utils'

/** The product's app mark (apps/canvas/public/favicon.svg): two overlapping stickies. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-6', className)}>
      <rect width="32" height="32" rx="8" fill="#1C1917" />
      <rect x="7" y="7" width="11" height="11" rx="2" fill="var(--tk-yellow-bg)" />
      <rect x="14" y="14" width="11" height="11" rx="3" fill="var(--tk-purple-bg)" />
    </svg>
  )
}

export function BrandName({ className }: { className?: string }) {
  return <span className={cn('font-semibold tracking-[-0.01em]', className)}>{site.name}</span>
}
