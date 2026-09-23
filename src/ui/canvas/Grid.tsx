import type { TLGridProps } from 'tldraw'

/** Quiet dot grid; the 8px snapping grid is shown at 3× so it never gets noisy. */
export function Grid({ x, y, z, size }: TLGridProps) {
  let step = size * 3 * z
  while (step < 16) step *= 4
  const ox = (x * z) % step
  const oy = (y * z) % step
  return (
    <div
      className="tl-grid"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, var(--grid-dot) 1px, transparent 1.2px)',
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${ox}px ${oy}px`,
      }}
    />
  )
}
