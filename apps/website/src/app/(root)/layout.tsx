import type { Metadata } from 'next'
import { site } from '@/config/site'
import '../globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: site.name,
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: true },
  alternates: { canonical: '/zh/', languages: { 'zh-CN': '/zh/', en: '/en/' } },
}

export default function RootRedirectLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
