'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/** Fades [data-reveal] elements in as they scroll into view. Without JS (or with reduced motion) content is simply visible. */
export function RevealObserver() {
  const pathname = usePathname()
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-revealed)'))
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-revealed')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    root.classList.add('reveal-ready')
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [pathname])
  return null
}

export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'figure'
}) {
  return (
    <Tag data-reveal="" className={className} style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}>
      {children}
    </Tag>
  )
}
