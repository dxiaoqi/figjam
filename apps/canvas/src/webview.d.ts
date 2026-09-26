import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      /** Electron <webview> (desktop only; see apps/desktop/src/main.mjs `will-attach-webview`). */
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string; webpreferences?: string; 'data-web-frame'?: string; 'data-web-capture'?: string }
    }
  }
}
