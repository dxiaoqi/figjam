import { COLORS, SURFACES, type ColorToken, type TemplateId } from '@aifig/shared'
import type { ThemeMode } from '../board-context'

type Id = TemplateId | 'blank'

/** A miniature of each template, drawn from the same color tokens as the blocks. */
export function TemplatePreview({ id, theme, className }: { id: Id; theme: ThemeMode; className?: string }) {
  const s = SURFACES[theme]
  const frame = (x: number, y: number, w: number, h: number) => <rect key={`f${x},${y}`} x={x} y={y} width={w} height={h} rx={3} fill={s.frame} stroke={s.border} strokeWidth={0.6} />
  const sticky = (x: number, y: number, c: ColorToken, size = 12) => <rect key={`s${x},${y}`} x={x} y={y} width={size} height={size} rx={1} fill={COLORS[c][theme].bg} />
  const card = (x: number, y: number, w: number, h: number, c: ColorToken) => (
    <g key={`c${x},${y}`}>
      <rect x={x} y={y} width={w} height={h} rx={1.6} fill={s.surface} stroke={s.border} strokeWidth={0.5} />
      <rect x={x} y={y} width={w} height={1.6} rx={0.8} fill={COLORS[c][theme].accent} />
      <rect x={x + 3} y={y + 4.5} width={w * 0.55} height={1.8} rx={0.9} fill={s.muted} opacity={0.7} />
      <rect x={x + 3} y={y + 8} width={w * 0.7} height={1.4} rx={0.7} fill={s.muted} opacity={0.35} />
    </g>
  )
  const grid = (x: number, y: number, cols: number, rows: number, color: (c: number, r: number) => ColorToken, size = 12, gap = 4) =>
    Array.from({ length: cols * rows }, (_, i) => sticky(x + (i % cols) * (size + gap), y + Math.floor(i / cols) * (size + gap), color(i % cols, Math.floor(i / cols)), size))
  const heading = (x: number, y: number, w: number) => <rect key={`h${x},${y}`} x={x} y={y} width={w} height={2.4} rx={1.2} fill={s.muted} opacity={0.8} />
  const arrow = (x1: number, y1: number, x2: number, y2: number) => <path key={`a${x1},${y1},${x2},${y2}`} d={`M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`} fill="none" stroke={s.muted} strokeWidth={0.6} opacity={0.7} />

  let body: React.ReactNode
  switch (id) {
    case 'research-synthesis':
      body = [
        frame(6, 12, 40, 76),
        ...grid(10, 16, 2, 4, () => 'teal', 14, 3.5),
        frame(52, 12, 52, 52),
        heading(57, 17, 14),
        heading(79, 17, 14),
        ...grid(57, 23, 2, 2, () => 'purple', 18, 4),
        frame(110, 12, 44, 58),
        card(114, 16, 36, 14, 'orange'),
        card(114, 34, 36, 14, 'orange'),
        card(114, 52, 36, 14, 'blue'),
      ]
      break
    case 'competitor-analysis':
      body = [
        frame(6, 8, 148, 30),
        card(11, 13, 44, 20, 'purple'),
        card(58, 13, 44, 20, 'blue'),
        card(105, 13, 44, 20, 'teal'),
        frame(6, 44, 104, 50),
        heading(11, 48, 16),
        heading(45, 48, 16),
        heading(79, 48, 16),
        ...grid(11, 54, 3, 3, (c) => (['green', 'red', 'yellow'] as const)[c], 10, 3).map((el, i) => <g key={i} transform={`translate(${(i % 3) * 21} 0)`}>{el}</g>),
      ]
      break
    case 'user-journey':
      body = [
        frame(6, 8, 116, 62),
        ...[0, 1, 2, 3].map((i) => heading(11 + i * 28, 13, 14)),
        ...grid(11, 19, 4, 3, (_, r) => (['blue', 'yellow', 'red'] as const)[r], 14, 2.5).map((el, i) => <g key={i} transform={`translate(${(i % 4) * 11.5} 0)`}>{el}</g>),
        frame(6, 74, 84, 20),
        ...grid(11, 78, 4, 1, () => 'yellow', 12, 7),
        frame(128, 8, 26, 26),
        card(131, 12, 20, 18, 'gray'),
      ]
      break
    case 'brainstorm':
      body = [
        frame(6, 6, 52, 24),
        card(10, 10, 44, 16, 'blue'),
        frame(6, 36, 100, 58),
        heading(11, 41, 16),
        heading(44, 41, 16),
        heading(77, 41, 16),
        ...grid(11, 47, 3, 3, () => 'yellow', 12, 3).map((el, i) => <g key={i} transform={`translate(${(i % 3) * 18} 0)`}>{el}</g>),
        frame(112, 36, 42, 38),
        card(116, 40, 34, 14, 'green'),
        card(116, 57, 34, 14, 'green'),
      ]
      break
    case 'meeting-notes':
      body = [
        frame(6, 20, 32, 56),
        card(9, 24, 26, 14, 'gray'),
        card(9, 41, 26, 14, 'gray'),
        card(9, 58, 26, 14, 'gray'),
        frame(42, 20, 42, 42),
        ...grid(46, 24, 2, 2, (c, r) => (c === 0 && r === 1 ? 'blue' : 'yellow'), 15, 4),
        frame(88, 20, 26, 42),
        sticky(92, 24, 'purple', 18),
        sticky(92, 45, 'purple', 13),
        frame(118, 20, 36, 60),
        card(121, 24, 30, 15, 'green'),
        card(121, 42, 30, 15, 'green'),
        card(121, 60, 30, 15, 'green'),
      ]
      break
    case 'architecture-map':
      body = [
        frame(4, 12, 90, 64),
        ...[0, 1, 2, 3].map((i) => heading(8 + i * 21, 16, 10)),
        card(8, 22, 18, 13, 'blue'),
        card(29, 22, 18, 13, 'purple'),
        card(50, 22, 18, 13, 'blue'),
        card(50, 40, 18, 13, 'blue'),
        card(71, 22, 18, 13, 'orange'),
        card(71, 40, 18, 13, 'gray'),
        arrow(26, 28, 29, 28),
        arrow(47, 28, 50, 28),
        arrow(47, 30, 50, 46),
        arrow(68, 28, 71, 28),
        arrow(68, 46, 71, 46),
        frame(98, 12, 28, 64),
        card(101, 17, 22, 15, 'teal'),
        card(101, 36, 22, 15, 'teal'),
        card(101, 55, 22, 15, 'teal'),
        frame(130, 12, 26, 64),
        card(133, 17, 20, 14, 'green'),
        card(133, 35, 20, 14, 'green'),
        sticky(133, 53, 'red', 16),
      ]
      break
    case 'incident-review':
      body = [
        frame(6, 12, 148, 34),
        ...[0, 1, 2, 3, 4].map((i) => heading(12 + i * 28, 16, 8)),
        ...[0, 1, 2, 3, 4].map((i) => sticky(12 + i * 28, 22, 'yellow', 18)),
        ...[0, 1, 2, 3].map((i) => arrow(31 + i * 28, 31, 39 + i * 28, 31)),
        frame(6, 52, 88, 36),
        ...[0, 1, 2].map((i) => sticky(12 + i * 27, 58, 'red', 22)),
        frame(100, 52, 54, 42),
        card(104, 57, 46, 15, 'green'),
        card(104, 75, 46, 15, 'green'),
        arrow(78, 69, 104, 64),
      ]
      break
    case 'interview-synthesis':
      body = [
        frame(6, 6, 96, 24),
        card(10, 10, 28, 16, 'blue'),
        card(41, 10, 28, 16, 'blue'),
        card(72, 10, 28, 16, 'blue'),
        frame(6, 36, 96, 58),
        ...[0, 1].map((c) => heading(11 + c * 46, 40, 14)),
        ...[0, 1].map((c) => card(11 + c * 46, 46, 40, 14, 'purple')),
        ...grid(11, 64, 2, 2, () => 'teal', 12, 3),
        ...grid(57, 64, 2, 2, () => 'teal', 12, 3),
        arrow(17, 64, 17, 60),
        arrow(63, 64, 63, 60),
        frame(108, 36, 46, 58),
        card(112, 41, 38, 14, 'green'),
        card(112, 58, 38, 14, 'green'),
        card(112, 75, 38, 14, 'orange'),
        arrow(97, 53, 112, 48),
      ]
      break
    case 'product-discovery':
      body = [
        frame(4, 10, 50, 50),
        ...grid(12, 18, 3, 3, (c, r) => (c + r) % 3 === 1 ? 'orange' : 'yellow', 11, 3),
        frame(58, 10, 32, 50),
        card(62, 15, 24, 18, 'green'),
        card(62, 37, 24, 18, 'green'),
        frame(94, 10, 62, 50),
        heading(108, 14, 10),
        heading(128, 14, 10),
        heading(146, 14, 8),
        card(104, 20, 18, 14, 'purple'),
        card(125, 20, 18, 14, 'purple'),
        card(137, 40, 16, 14, 'purple'),
        arrow(86, 24, 104, 26),
        arrow(86, 46, 137, 46),
        frame(58, 66, 50, 28),
        card(62, 71, 20, 18, 'orange'),
        sticky(85, 71, 'teal', 18),
        frame(112, 66, 44, 28),
        card(116, 71, 17, 18, 'gray'),
        card(135, 71, 17, 18, 'gray'),
      ]
      break
    case 'prototype-wall':
      body = [
        frame(4, 8, 26, 24),
        card(7, 12, 20, 16, 'blue'),
        ...[0, 1, 2].map((i) => {
          const x = 34 + i * 41
          return (
            <g key={`v${i}`}>
              {frame(x, 8, 37, 58)}
              {card(x + 3, 12, 31, 11, 'purple')}
              <rect x={x + 3} y={26} width={31} height={36} rx={1.6} fill={s.surface} stroke={s.border} strokeWidth={0.5} />
              <rect x={x + 6} y={30} width={16} height={2} rx={1} fill={s.muted} opacity={0.75} />
              <rect x={x + 6} y={36} width={25} height={5} rx={1.2} fill={s.canvas} stroke={s.border} strokeWidth={0.4} />
              <rect x={x + 6} y={44} width={25} height={5} rx={1.2} fill={s.canvas} stroke={s.border} strokeWidth={0.4} />
              <rect x={x + 18} y={54} width={13} height={5} rx={1.2} fill={s.ink} opacity={0.85} />
            </g>
          )
        }),
        arrow(30, 20, 37, 17),
        frame(52, 72, 70, 24),
        ...[0, 1, 2].map((i) => sticky(57 + i * 21, 76, 'yellow', 16)),
        frame(126, 72, 30, 24),
        card(129, 77, 24, 14, 'green'),
      ]
      break
    case 'literature-review':
      body = [
        frame(4, 6, 58, 22),
        card(8, 10, 24, 14, 'orange'),
        card(35, 10, 24, 14, 'orange'),
        frame(4, 34, 76, 34),
        ...[0, 1, 2].map((i) => heading(8 + i * 24, 38, 8)),
        ...[0, 1, 2].map((i) => card(8 + i * 24, 44, 20, 18, 'blue')),
        arrow(28, 53, 32, 53),
        arrow(52, 53, 56, 53),
        frame(84, 34, 72, 50),
        sticky(88, 42, 'teal', 14),
        card(105, 42, 18, 14, 'purple'),
        sticky(126, 42, 'red', 14),
        sticky(143, 42, 'yellow', 11),
        sticky(88, 62, 'teal', 14),
        card(105, 62, 18, 14, 'purple'),
        arrow(102, 49, 105, 49),
        arrow(126, 49, 123, 49),
        arrow(102, 69, 105, 69),
      ]
      break
    default:
      body = (
        <g opacity={0.9}>
          {Array.from({ length: 9 * 5 }, (_, i) => (
            <circle key={i} cx={24 + (i % 9) * 14} cy={22 + Math.floor(i / 9) * 14} r={0.9} fill={s.muted} opacity={0.45} />
          ))}
          <rect x={66} y={40} width={24} height={24} rx={1.5} fill={COLORS.yellow[theme].bg} transform="rotate(-4 78 52)" />
        </g>
      )
  }
  return (
    <svg viewBox="0 0 160 100" className={className} aria-hidden>
      <rect width={160} height={100} fill={s.canvas} />
      {body}
    </svg>
  )
}
