import type { Platform } from '@/lib/release'

export const platformIcons: Record<Platform, React.ReactNode> = {
  macos: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M16.37 12.6c-.02-2.08 1.7-3.08 1.78-3.13-.97-1.42-2.48-1.61-3.02-1.63-1.28-.13-2.51.76-3.16.76-.65 0-1.66-.74-2.72-.72-1.4.02-2.69.81-3.41 2.07-1.46 2.52-.37 6.26 1.04 8.31.7 1 1.52 2.12 2.6 2.08 1.05-.04 1.44-.67 2.7-.67 1.26 0 1.62.67 2.72.65 1.13-.02 1.84-1.02 2.52-2.03.8-1.16 1.12-2.29 1.14-2.35-.03-.01-2.18-.84-2.2-3.34ZM14.3 6.5c.57-.7.96-1.66.85-2.63-.82.03-1.83.55-2.42 1.24-.53.61-.99 1.6-.87 2.54.92.07 1.86-.46 2.44-1.15Z" />
    </svg>
  ),
  windows: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M3 5.5 10.5 4.5v7H3v-6Zm8.5-1.1L21 3v8.5h-9.5V4.4ZM3 12.5h7.5v7L3 18.5v-6Zm8.5 0H21V21l-9.5-1.4v-7.1Z" />
    </svg>
  ),
  linux: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="m7 9 3 2.5L7 14M12.5 14H17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}
