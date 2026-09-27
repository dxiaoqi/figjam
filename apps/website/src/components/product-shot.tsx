import { type ShotName, shots } from '@/lib/media'
import { cn } from '@/lib/utils'

/** A screenshot in a quiet desktop-window frame, like the app sitting next to your editor. */
export function WindowFrame({
  children,
  title,
  className,
  bare,
}: {
  children: React.ReactNode
  title?: string
  className?: string
  bare?: boolean
}) {
  return (
    <div className={cn('shot overflow-hidden rounded-xl border border-black/[0.07] bg-card', className)}>
      {!bare && (
        <div className="flex h-8 items-center gap-1.5 border-b border-black/[0.06] bg-[#F4F4F2] px-3" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#E5625C]/80" />
          <span className="size-2.5 rounded-full bg-[#E8B22E]/80" />
          <span className="size-2.5 rounded-full bg-[#6BB85C]/80" />
          {title && <span className="mx-auto -translate-x-6 truncate text-[11px] font-medium text-stone-500">{title}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Shot({
  name,
  alt,
  className,
  priority,
  sizes,
}: {
  name: ShotName
  alt: string
  className?: string
  priority?: boolean
  sizes?: string
}) {
  const [w, h] = shots[name]
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, pre-optimized WebP
    <img
      src={`/media/${name}.webp`}
      alt={alt}
      width={w}
      height={h}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={cn('block h-auto w-full', className)}
    />
  )
}

export function FramedShot({
  name,
  alt,
  title,
  className,
  bare,
  priority,
}: {
  name: ShotName
  alt: string
  title?: string
  className?: string
  bare?: boolean
  priority?: boolean
}) {
  return (
    <WindowFrame title={title} className={className} bare={bare}>
      <Shot name={name} alt={alt} priority={priority} />
    </WindowFrame>
  )
}
