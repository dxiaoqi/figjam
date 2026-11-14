import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('AIFIG_') && value != null && process.env[`NODBOARD_${key.slice(6)}`] == null) process.env[`NODBOARD_${key.slice(6)}`] = value
}
const dataHome = () => {
  if (process.env.NODBOARD_HOME) return process.env.NODBOARD_HOME
  const next = path.join(os.homedir(), '.nodboard')
  const prev = path.join(os.homedir(), '.aifig')
  return fs.existsSync(next) || !fs.existsSync(prev) ? next : prev
}
const corePort = Number(process.env.NODBOARD_CORE_PORT ?? 47821)
const uiPort = Number(process.env.NODBOARD_UI_PORT ?? 47820)

/** Print a signed-in link once the core has created its access token (terminal only; never written to a log). */
function printTokenLink(): Plugin {
  return {
    name: 'nodboard-token-link',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const file = path.join(dataHome(), 'access-token')
        let tries = 0
        const t = setInterval(() => {
          const token = process.env.NODBOARD_TOKEN ?? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '')
          if (token || ++tries > 40) {
            clearInterval(t)
            if (token) console.log(`\n  nodboard: open http://127.0.0.1:${uiPort}/#token=${token}\n  (or run \`npx nodboard open --dev\`)\n`)
          }
        }, 250)
        t.unref()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), printTokenLink()],
  // build-time feature flags (see packages/shared/src/features.ts)
  define: { __NODBOARD_FEATURES__: JSON.stringify({ assistant: process.env.NODBOARD_FEATURE_ASSISTANT === '1' }) },
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
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@tiptap/extensions',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: uiPort,
    strictPort: true,
    warmup: { clientFiles: ['./src/main.tsx'] },
    proxy: {
      '/api': `http://127.0.0.1:${corePort}`,
      '/sync': { target: `ws://127.0.0.1:${corePort}`, ws: true },
    },
  },
})
