import type { Block, Connector, Thread } from './model'
import type { TypeRegistry } from './types'

/**
 * What an exported web page carries (`board.js`: `window.__AIFIG_BOARD__ = …`). A classic script rather than
 * JSON fetched at runtime, so the page works from `file://` as well as from any static host.
 */
export const WEB_EXPORT_FORMAT = 'aifig-web/1'

export interface WebExportAsset {
  /** Relative path (`assets/<sha256>.<ext>`) or, in single-file pages, a data: URI. */
  src: string
  mime: string
  name?: string
  w?: number
  h?: number
  duration?: number
}

export interface WebExportData {
  format: typeof WEB_EXPORT_FORMAT
  title: string
  exportedAt: string
  theme: 'light' | 'dark'
  /** Content language of the board (the viewer's own labels follow the reader's browser). */
  language?: string
  blocks: Block[]
  connectors: Connector[]
  threads: Thread[]
  /** Built-in and skill types used by the blocks, for headers and field rows. */
  types: TypeRegistry
  assets: Record<string, WebExportAsset>
  /** Inline snippets: a document next to the page (`src`) or, in single-file pages, `srcdoc`. */
  snippets: Record<string, { src?: string; srcdoc?: string }>
  options: { comments: boolean; fields: boolean }
}

/** Single-file pages above this size get a warning (browsers and mail clients struggle). */
export const SINGLE_FILE_WARN_BYTES = 20 * 1024 * 1024
