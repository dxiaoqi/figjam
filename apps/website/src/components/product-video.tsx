'use client'

import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** A muted product clip that plays only while on screen, never with reduced motion unless asked, and can be paused. */
export function ProductVideo({
  src,
  poster,
  label,
  className,
  pauseLabel,
  playLabel,
}: {
  src: string
  poster: string
  label: string
  className?: string
  pauseLabel: string
  playLabel: string
}) {
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
        else if (!e.isIntersecting) v.pause()
      },
      { threshold: 0.25 },
    )
    io.observe(v)
    return () => io.disconnect()
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
      <video
        ref={ref}
        className="block h-auto w-full"
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={label}
        width={1440}
        height={900}
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
