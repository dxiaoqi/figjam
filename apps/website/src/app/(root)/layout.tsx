import type { Metadata } from 'next'
import { site } from '@/config/site'
import '../globals.css'

export const metadata: Metadata = {
  title: site.name,
  icons: { icon: '/favicon.svg' },
}

export default function RootRedirectLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
