'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export function DocsToc({ items, title }: { items: { id: string; label: string }[]; title: string }) {
  const [active, setActive] = useState(items[0]?.id)
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e)
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [items])

  return (
    <nav aria-label={title}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-0 lg:border-l lg:border-border lg:pb-0">
        {items.map((i) => (
          <li key={i.id} className="shrink-0">
            <a
              href={`#${i.id}`}
              aria-current={active === i.id ? 'location' : undefined}
              className={cn(
                'block rounded-full border px-3 py-1 text-[13.5px] whitespace-nowrap transition-colors lg:-ml-px lg:whitespace-normal lg:rounded-none lg:border-0 lg:border-l lg:px-4 lg:py-1.5',
                active === i.id
                  ? 'border-foreground/20 text-foreground lg:border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground lg:border-transparent',
              )}
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
