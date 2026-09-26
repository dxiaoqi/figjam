import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const corePort = Number(process.env.AIFIG_CORE_PORT ?? 47821)
const uiPort = Number(process.env.AIFIG_UI_PORT ?? 47820)

/** Print a signed-in link once the core has created its access token (terminal only; never written to a log). */
function printTokenLink(): Plugin {
  return {
    name: 'aifig-token-link',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const file = path.join(process.env.AIFIG_HOME ?? path.join(os.homedir(), '.aifig'), 'access-token')
        let tries = 0
        const t = setInterval(() => {
          const token = process.env.AIFIG_TOKEN ?? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '')
          if (token || ++tries > 40) {
            clearInterval(t)
            if (token) console.log(`\n  ai-figma: open http://127.0.0.1:${uiPort}/#token=${token}\n  (or run \`npx aifig open --dev\`)\n`)
          }
        }, 250)
        t.unref()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), printTokenLink()],
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
