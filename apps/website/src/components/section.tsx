import { Reveal } from '@/components/reveal'
import { cn } from '@/lib/utils'

/** Vertical rhythm shared by every page section (all of them start below the fold, so they render lazily). */
export const sectionY = 'cv-auto py-20 sm:py-28 lg:py-32'

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-5 sm:px-8', className)}>{children}</div>
}

export function Eyebrow({ children, className, dot = 'var(--tk-yellow-accent)' }: { children: React.ReactNode; className?: string; dot?: string }) {
  return (
    <p className={cn('flex items-center gap-2 text-[13px] font-medium text-muted-foreground', className)}>
      <span aria-hidden className="size-2 rounded-[2px]" style={{ background: dot }} />
      {children}
    </p>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  id,
  align = 'left',
  dot,
  className,
}: {
  eyebrow: string
  title: string
  lede?: string
  id?: string
  align?: 'left' | 'center'
  dot?: string
  className?: string
}) {
  return (
    <Reveal className={cn(align === 'center' && 'sm:mx-auto sm:text-center', 'max-w-2xl', className)}>
      <Eyebrow dot={dot} className={cn(align === 'center' && 'sm:justify-center')}>
        {eyebrow}
      </Eyebrow>
      <h2 id={id} className="headline mt-4 text-[1.875rem] leading-[1.15] font-semibold text-foreground sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
        {title}
      </h2>
      {lede && <p className="lede mt-4 text-base leading-relaxed text-muted-foreground sm:mt-5 sm:text-[17px]">{lede}</p>}
    </Reveal>
  )
}

const bulletColors = ['yellow', 'teal', 'purple', 'orange', 'blue', 'green'] as const

/** Bullets marked with tiny stickies in the product's token colors. */
export function StickyList({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={cn('space-y-3', className)}>
      {items.map((item, i) => (
        <li key={item} className="flex gap-3 text-[15px] leading-6 text-foreground/85">
          <span
            aria-hidden
            className="mt-[7px] size-2.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]"
            style={{ background: `var(--tk-${bulletColors[i % bulletColors.length]}-accent)` }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
