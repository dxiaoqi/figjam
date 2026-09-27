'use client'

import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { shotSrcSet } from '@/components/product-shot'
import { type ShotName, shots } from '@/lib/media'
import { cn } from '@/lib/utils'

/**
 * A muted product clip that plays only while on screen, never with reduced motion unless asked, and can be paused.
 * The poster is a responsive image underneath, so phones get the small one and nothing loads before it's needed.
 */
export function ProductVideo({
  src,
  poster,
  label,
  className,
  pauseLabel,
  playLabel,
  priority,
}: {
  src: string
  poster: ShotName
  label: string
  className?: string
  pauseLabel: string
  playLabel: string
  priority?: boolean
}) {
  const [w, h] = shots[poster]
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const userPaused = useRef(false)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) userPaused.current = true
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !userPaused.current) v.play().catch(() => {})
        // pause() on a clip that never loaded would start loading it (media resource selection)
        else if (!e.isIntersecting && !v.paused) v.pause()
      },
      { threshold: 0.25 },
    )
    // Loading media before the first paint is on screen puts the page back into a loading state and holds that
    // paint, so clips wait for the browser's first-contentful-paint entry (or a second where it isn't reported).
    const start = () => io.observe(v)
    let po: PerformanceObserver | undefined
    let timer = 0
    if (performance.getEntriesByName('first-contentful-paint').length) start()
    else if (PerformanceObserver.supportedEntryTypes?.includes('paint')) {
      po = new PerformanceObserver((list) => {
        if (!list.getEntriesByName('first-contentful-paint').length) return
        po?.disconnect()
        start()
      })
      po.observe({ type: 'paint', buffered: true })
    } else timer = window.setTimeout(start, 1000)
    return () => {
      po?.disconnect()
      clearTimeout(timer)
      io.disconnect()
    }
  }, [])

  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) {
      userPaused.current = false
      v.play().catch(() => {})
    } else {
      userPaused.current = true
      v.pause()
    }
  }

  return (
    <div className={cn('group relative', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, pre-optimized WebP */}
      <img
        src={`/media/${poster}.webp`}
        srcSet={shotSrcSet(poster)}
        sizes="(min-width: 1152px) 1024px, 100vw"
        alt=""
        aria-hidden
        width={w}
        height={h}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <video
        ref={ref}
        className="relative block h-auto w-full"
        muted
        loop
        playsInline
        preload="none"
        aria-label={label}
        width={w}
        height={h}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={`${src}.webm`} type="video/webm" />
        <source src={`${src}.mp4`} type="video/mp4" />
      </video>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? pauseLabel : playLabel}
        className="absolute right-3 bottom-3 flex size-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[paused=true]:opacity-100"
        data-paused={!playing}
      >
        {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5 translate-x-px" aria-hidden />}
      </button>
    </div>
  )
}
