import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import type { AgentPresence, ClientMessage, Rect, ServerMessage } from '@aifig/shared'
import { wsProtocols } from '../lib/auth'

const MSG_SYNC = 0

/** Permission prompts and activity entries, re-broadcast as a window event for the chrome that shows them. */
export const SECURITY_EVENT = 'aifig:security'

export type ConnectionStatus = 'connecting' | 'connected' | 'offline'

/** Connects a local Y.Doc to the core's copy of one board. */
export class CoreProvider {
  readonly doc = new Y.Doc()
  status: ConnectionStatus = 'connecting'
  synced = false
  agents: AgentPresence[] = []
  private ws: WebSocket | null = null
  private retry = 0
  private timer: number | null = null
  private destroyed = false
  private listeners = new Set<() => void>()

  constructor(readonly boardId: string) {
    this.doc.on('update', this.onLocalUpdate)
    this.connect()
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private connect() {
    if (this.destroyed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/sync/${encodeURIComponent(this.boardId)}`, wsProtocols())
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.status = 'connected'
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeSyncStep1(enc, this.doc)
      ws.send(encoding.toUint8Array(enc))
      this.emit()
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data) as ServerMessage
        if (msg.type === 'presence') {
          this.agents = msg.agents
          this.emit()
        } else if (msg.type === 'permission' || msg.type === 'permission-settled' || msg.type === 'activity') {
          window.dispatchEvent(new CustomEvent(SECURITY_EVENT, { detail: msg }))
        }
        return
      }
      const dec = decoding.createDecoder(new Uint8Array(ev.data))
      if (decoding.readVarUint(dec) !== MSG_SYNC) return
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      // Yjs encodes every transaction for 'update' listeners; remote updates never need re-sending, so detach
      // while applying them (about 90ms saved when opening a 10k-block board)
      this.doc.off('update', this.onLocalUpdate)
      let kind: number
      try {
        kind = syncProtocol.readSyncMessage(dec, enc, this.doc, this)
      } finally {
        if (!this.destroyed) this.doc.on('update', this.onLocalUpdate)
      }
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
      if (kind === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true
        this.emit()
      }
    }
    ws.onclose = () => {
      this.ws = null
      if (this.destroyed) return
      this.status = 'offline'
      this.emit()
      const delay = Math.min(8000, 400 * 2 ** this.retry++)
      this.timer = window.setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => ws.close()
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeUpdate(enc, update)
    this.ws.send(encoding.toUint8Array(enc))
  }

  sendViewport(bounds: Rect) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const msg: ClientMessage = { type: 'viewport', bounds, focused: document.hasFocus() && document.visibilityState === 'visible' }
    this.ws.send(JSON.stringify(msg))
  }

  destroy() {
    this.destroyed = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.doc.off('update', this.onLocalUpdate)
    this.doc.destroy()
    this.listeners.clear()
  }
}
