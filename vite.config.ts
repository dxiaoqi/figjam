import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const corePort = Number(process.env.AIFIG_CORE_PORT ?? 47821)
const uiPort = Number(process.env.AIFIG_UI_PORT ?? 47820)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // Pre-bundle every runtime dep up front. If Vite discovers one mid-load it re-optimizes,
  // and requests still in flight fail with "504 Outdated Optimize Dep".
  optimizeDeps: {
    entries: ['index.html'],
    include: [
      'react',
      'react/jsx-dev-runtime',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      'tldraw',
      'yjs',
      'y-protocols/sync',
      'lib0/encoding',
      'lib0/decoding',
      'radix-ui',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'class-variance-authority',
      'zod',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: uiPort,
    strictPort: true,
    warmup: { clientFiles: ['./src/ui/main.tsx'] },
    proxy: {
      '/api': `http://127.0.0.1:${corePort}`,
      '/sync': { target: `ws://127.0.0.1:${corePort}`, ws: true },
    },
  },
})
