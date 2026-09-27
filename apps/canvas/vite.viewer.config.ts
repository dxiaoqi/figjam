import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The read-only viewer for exported web pages: one classic script (IIFE, so it runs from file://, where module
 * scripts are blocked) and one stylesheet, written to dist/viewer and copied into every export by the core.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __AIFIG_FEATURES__: JSON.stringify({ assistant: false }), 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: {
    outDir: 'dist/viewer',
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: true,
    lib: { entry: path.resolve(import.meta.dirname, 'src/viewer/main.tsx'), name: 'AifigViewer', formats: ['iife'], fileName: () => 'viewer.js', cssFileName: 'viewer' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
