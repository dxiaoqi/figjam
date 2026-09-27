import { Reveal } from '@/components/reveal'
import { cn } from '@/lib/utils'

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
    <Reveal className={cn(align === 'center' && 'mx-auto text-center', 'max-w-2xl', className)}>
      <Eyebrow dot={dot} className={cn(align === 'center' && 'justify-center')}>
        {eyebrow}
      </Eyebrow>
      <h2 id={id} className="headline mt-4 text-3xl font-semibold text-foreground sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
        {title}
      </h2>
      {lede && <p className="lede mt-5 text-[17px] leading-relaxed text-muted-foreground">{lede}</p>}
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
