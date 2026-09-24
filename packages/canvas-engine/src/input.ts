import type { Editor, HandleId } from './editor'
import type { Vec } from './geometry'

const DRAG_PX = 3

function isEditableTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.closest?.('[role="dialog"],[role="menu"]')
}

/** Translates DOM input on the viewport element into editor interactions. */
export class InputController {
  private el: HTMLElement
  private pointerId: number | null = null
  private disposers: (() => void)[] = []

  constructor(
    private editor: Editor,
    el: HTMLElement,
  ) {
    this.el = el
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(el, 'pointerdown', this.onPointerDown)
    on(el, 'pointermove', this.onPointerMove)
    on(el, 'pointerup', this.onPointerUp)
    on(el, 'pointercancel', this.onPointerUp)
    on(el, 'wheel', this.onWheel, { passive: false })
    on(el, 'contextmenu', (e) => e.preventDefault())
    on(window, 'keydown', this.onKeyDown)
    on(window, 'keyup', this.onKeyUp)
    on(window, 'copy', this.onCopy as any)
    on(window, 'cut', this.onCut as any)
    on(window, 'paste', this.onPaste as any)
    on(window, 'blur', () => {
      this.editor.spaceDown = false
    })
    // Safari trackpad pinch
    on(el, 'gesturestart' as any, (e: any) => {
      e.preventDefault()
      this.gestureZ = this.editor.camera.z
    })
    on(el, 'gesturechange' as any, (e: any) => {
      e.preventDefault()
      this.editor.zoomAt(this.local(e), this.gestureZ * e.scale)
    })
  }

  dispose() {
    this.disposers.forEach((d) => d())
  }

  private local(e: { clientX: number; clientY: number }): Vec {
    const r = this.el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private page(e: { clientX: number; clientY: number }) {
    return this.editor.screenToPage(this.local(e))
  }

  private lastPointer: Vec | null = null
  private gestureZ = 1
  private touches = new Map<number, Vec>()
  private rightClick: { screen: Vec; page: Vec; target: string | null } | null = null

  private startPinch() {
    const ed = this.editor
    const [a, b] = [...this.touches.values()]
    ed.interaction = { type: 'pinch', startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: { ...ed.camera } }
    ed.guides = []
    ed.spacing = []
    ed.bump()
  }

  private onPointerDown = (e: PointerEvent) => {
    const ed = this.editor
    const target = e.target as HTMLElement
    if (target.closest('[data-ui]')) return
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, this.local(e))
      this.el.setPointerCapture(e.pointerId)
      if (this.touches.size === 2) {
        // a second finger cancels whatever the first one started and becomes pinch/pan
        if (ed.editingId) ed.stopEditing()
        return this.startPinch()
      }
      if (this.touches.size > 2) return
    }
    const editing = ed.editingId
    if (editing && target.closest(`[data-block-id="${editing}"] textarea, [data-block-id="${editing}"] input, [data-editing-input]`)) return
    if (editing) ed.stopEditing()
    ;(document.activeElement as HTMLElement | null)?.blur?.()

    const screen = this.local(e)
    const page = ed.screenToPage(screen)
    // Detect double-clicks here: after pointer capture the browser retargets `dblclick` to the canvas.
    const now = performance.now()
    const last = this.lastDown
    this.lastDown = { t: now, p: screen }
    if (e.button === 0 && e.pointerType !== 'touch' && last && now - last.t < 380 && Math.hypot(screen.x - last.p.x, screen.y - last.p.y) < 6) {
      this.lastDown = null
      if (ed.interaction.type !== 'idle') ed.endInteraction()
      if (this.onDoubleClick(target, page)) {
        e.preventDefault()
        return
      }
    }
    this.el.setPointerCapture(e.pointerId)
    this.pointerId = e.pointerId

    if (e.button === 2) {
      const blockEl = target.closest<HTMLElement>('[data-block-id]')
      const hit = ed.hitTest(page) ?? (blockEl ? ed.block(blockEl.dataset.blockId!) : null) ?? ed.hitTest(page, { frames: true })
      const labelId = target.closest<HTMLElement>('[data-frame-label]')?.dataset.frameLabel
      const conn = !hit && !labelId ? ed.connectorAt(page) : null
      this.rightClick = { screen, page, target: labelId ?? hit?.id ?? conn?.id ?? null }
    }
    if (e.button === 1 || e.button === 2 || ed.spaceDown || ed.tool === 'hand') {
      ed.interaction = { type: 'pan', startScreen: screen, cam: { ...ed.camera } }
      ed.bump()
      return
    }
    if (e.button !== 0) return

    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as HandleId | undefined
    const connectFrom = target.closest<HTMLElement>('[data-connect-from]')?.dataset.connectFrom
    const endpointEl = target.closest<HTMLElement>('[data-connector-endpoint]')
    if (endpointEl) return ed.beginEndpoint(endpointEl.dataset.connectorEndpoint!, endpointEl.dataset.endpoint as 'start' | 'end', page)
    const blockEl = target.closest<HTMLElement>('[data-block-id]')
    const labelEl = target.closest<HTMLElement>('[data-frame-label]')
    const connectorEl = target.closest<HTMLElement>('[data-connector-id]')

    if (connectFrom) return ed.beginConnect(connectFrom, page)
    if (handle && ed.selection.size === 1) return ed.beginResize([...ed.selection][0], handle, page)

    const tool = ed.tool
    if (tool === 'frame') return ed.beginFrame(page)
    if (tool !== 'select' && tool !== 'connector') return // creation tools act on pointerup

    let hitId: string | null = labelEl?.dataset.frameLabel ?? null
    if (!hitId && blockEl) {
      const b = ed.block(blockEl.dataset.blockId!)
      if (b && b.kind !== 'frame') hitId = b.id
    }
    if (!hitId) {
      const b = ed.hitTest(page)
      if (b) hitId = b.id
    }
    if (tool === 'connector') {
      ed.beginConnect(hitId && ed.block(hitId)?.kind !== 'frame' ? hitId : null, page)
      return
    }
    if (!hitId) {
      const c = connectorEl ? ed.connector(connectorEl.dataset.connectorId!) : ed.connectorAt(page)
      if (c) {
        ed.select(e.shiftKey ? [...ed.selection, c.id] : [c.id])
        return
      }
    }
    if (!hitId && e.pointerType === 'touch') {
      // one finger on empty canvas pans
      ed.interaction = { type: 'pan', startScreen: screen, cam: { ...ed.camera } }
      ed.bump()
      return
    }
    const frameBody = !hitId ? (ed.frameAt(page)?.id ?? null) : null
    const wasSelected = !!hitId && ed.selection.has(hitId)
    if (hitId && !wasSelected) ed.select(e.shiftKey ? [...ed.selection, hitId] : [hitId])
    ed.interaction = { type: 'pending', startScreen: screen, startPage: page, target: hitId, frameBody, shift: e.shiftKey, wasSelected }
    ed.bump()
  }

  private onPointerMove = (e: PointerEvent) => {
    const ed = this.editor
    const screen = this.local(e)
    const page = ed.screenToPage(screen)
    this.lastPointer = page
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, screen)
    const it = ed.interaction
    switch (it.type) {
      case 'pinch': {
        if (this.touches.size < 2) return
        const [a, b] = [...this.touches.values()]
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const z = Math.min(4, Math.max(0.1, it.cam.z * (dist / it.startDist)))
        const anchor = { x: (it.startMid.x - it.cam.x) / it.cam.z, y: (it.startMid.y - it.cam.y) / it.cam.z }
        ed.setCamera({ x: mid.x - anchor.x * z, y: mid.y - anchor.y * z, z })
        return
      }
      case 'endpoint':
        return ed.updateEndpoint(page)
      case 'idle': {
        if (ed.tool !== 'select' && ed.tool !== 'connector') return
        const target = e.target as HTMLElement
        if (target.closest('[data-handle],[data-connect-from]')) return
        let id = ed.hitTest(page)?.id ?? null
        // keep the hovered block while the pointer travels to its connect handles
        if (!id && ed.hover) {
          const r = ed.pageRect(ed.hover)
          if (r && r.x - 28 / ed.camera.z <= page.x && page.x <= r.x + r.w + 28 / ed.camera.z && r.y - 28 / ed.camera.z <= page.y && page.y <= r.y + r.h + 28 / ed.camera.z) id = ed.hover
        }
        if (id !== ed.hover) {
          ed.hover = id
          ed.bump()
        }
        return
      }
      case 'pan':
        ed.setCamera({ ...it.cam, x: it.cam.x + screen.x - it.startScreen.x, y: it.cam.y + screen.y - it.startScreen.y })
        return
      case 'pending': {
        if (Math.hypot(screen.x - it.startScreen.x, screen.y - it.startScreen.y) < DRAG_PX) return
        if (it.target) {
          ed.beginMove(it.startPage)
          ed.updateMove(page, !e.metaKey && !e.ctrlKey)
        } else {
          ed.beginMarquee(it.startPage, it.shift)
          ed.updateMarquee(page)
        }
        return
      }
      case 'move':
        return ed.updateMove(page, !e.metaKey && !e.ctrlKey)
      case 'resize':
        return ed.updateResize(page)
      case 'marquee':
        return ed.updateMarquee(page)
      case 'connect':
        return ed.updateConnect(page)
      case 'frame':
        return ed.updateFrame(page)
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    const ed = this.editor
    if (this.pointerId !== null && this.el.hasPointerCapture(this.pointerId)) this.el.releasePointerCapture(this.pointerId)
    this.pointerId = null
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId)
    const page = this.page(e)
    const it = ed.interaction
    switch (it.type) {
      case 'pinch':
        if (this.touches.size < 2) ed.endInteraction()
        return
      case 'endpoint':
        return ed.endEndpoint()
      case 'pan': {
        const rc = this.rightClick
        this.rightClick = null
        const moved = Math.hypot(ed.camera.x - it.cam.x, ed.camera.y - it.cam.y)
        ed.endInteraction()
        if (e.button === 2 && rc && moved < 3) {
          if (rc.target && !ed.selection.has(rc.target)) ed.select([rc.target])
          if (!rc.target) ed.selectNone()
          ed.options.onContextMenu?.(rc)
        }
        return
      }
      case 'pending':
        ed.endInteraction()
        if (it.target) {
          if (it.wasSelected && it.shift) {
            const next = new Set(ed.selection)
            next.delete(it.target)
            ed.select(next)
          } else if (!it.shift) ed.select([it.target])
        } else if (it.frameBody) ed.select([it.frameBody])
        else if (!it.shift) ed.selectNone()
        return
      case 'move':
        return ed.endMove()
      case 'resize':
        return ed.endResize()
      case 'marquee':
        return ed.endInteraction()
      case 'connect':
        return ed.endConnect()
      case 'frame':
        return ed.endFrame()
      case 'idle':
        if (e.button === 0 && ed.tool !== 'select' && ed.tool !== 'hand' && ed.tool !== 'connector' && ed.tool !== 'frame') ed.createWithTool(ed.tool, page)
        return
    }
  }

  private onWheel = (e: WheelEvent) => {
    const ed = this.editor
    if ((e.target as HTMLElement).closest('[data-ui]')) return
    if (ed.editingId && (e.target as HTMLElement).closest('textarea')) {
      const ta = (e.target as HTMLElement).closest('textarea')!
      if (ta.scrollHeight > ta.clientHeight) return
    }
    e.preventDefault()
    const screen = this.local(e)
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp((-e.deltaY * scale) / (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 100 : 400))
      ed.zoomAt(screen, ed.camera.z * factor)
    } else if (e.shiftKey && !e.deltaX) {
      ed.panBy(-e.deltaY * scale, 0)
    } else {
      ed.panBy(-e.deltaX * scale, -e.deltaY * scale)
    }
  }

  private lastDown: { t: number; p: Vec } | null = null

  /** Returns true when the double-click was handled. */
  private onDoubleClick(target: HTMLElement, page: Vec): boolean {
    const ed = this.editor
    if (target.closest('[data-ui],textarea,input')) return false
    if (ed.tool !== 'select') return false
    const label = target.closest<HTMLElement>('[data-frame-label]')?.dataset.frameLabel
    if (label) {
      ed.startEditing(label)
      return true
    }
    const b = ed.hitTest(page)
    if (b) {
      ed.startEditing(b.id)
      return true
    }
    const c = ed.connectorAt(page)
    if (c) {
      ed.startEditing(c.id)
      return true
    }
    // double-click on a frame's header or empty area edits its title
    const frame = ed.frameAt(page)
    if (frame) {
      ed.startEditing(frame.id)
      return true
    }
    ed.options.onDoubleClickCanvas?.(page)
    return true
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const ed = this.editor
    if (e.key === ' ' && !isEditableTarget(e.target)) {
      if (!ed.spaceDown) {
        ed.spaceDown = true
        ed.bump()
      }
      e.preventDefault()
      return
    }
    if (isEditableTarget(e.target)) {
      if (e.key === 'Escape' && ed.editingId) {
        e.preventDefault()
        ed.stopEditing()
      }
      return
    }
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod) {
      if (k === 'z') {
        e.preventDefault()
        return e.shiftKey ? ed.redo() : ed.undo()
      }
      if (k === 'y') {
        e.preventDefault()
        return ed.redo()
      }
      if (k === 'a') {
        e.preventDefault()
        return ed.selectAll()
      }
      if (k === 'd') {
        e.preventDefault()
        return ed.duplicate()
      }
      if (k === '=' || k === '+') {
        e.preventDefault()
        return ed.zoomIn()
      }
      if (k === '-') {
        e.preventDefault()
        return ed.zoomOut()
      }
      if (k === '0') {
        e.preventDefault()
        return ed.resetZoom()
      }
      return
    }
    if (e.altKey) return
    if (e.shiftKey && k === '1') return ed.zoomToFit()
    if (e.shiftKey && k === '2') {
      const b = ed.selectionBounds()
      return b && ed.zoomToBounds(b, { maxZoom: 2 })
    }
    const tools: Record<string, string> = { v: 'select', h: 'hand', f: 'frame', a: 'connector', ...ed.options.toolKeys }
    if (tools[k] && !e.shiftKey) return ed.setTool(tools[k])
    switch (e.key) {
      case 'Escape':
        if (ed.interaction.type !== 'idle') ed.endInteraction()
        else if (ed.tool !== 'select') ed.setTool('select')
        else ed.selectNone()
        return
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        return ed.deleteSelection()
      case 'Enter':
        if (ed.selection.size === 1) {
          e.preventDefault()
          ed.startEditing([...ed.selection][0])
        }
        return
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!ed.selection.size) return
        e.preventDefault()
        const step = e.shiftKey ? ed.grid * 4 : ed.grid
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]!
        return ed.nudge(d[0], d[1])
      }
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' && this.editor.spaceDown) {
      this.editor.spaceDown = false
      this.editor.bump()
    }
  }

  private onCopy = (e: ClipboardEvent) => {
    if (isEditableTarget(e.target) || !this.editor.selection.size) return
    const text = this.editor.copy()
    if (!text) return
    e.preventDefault()
    e.clipboardData?.setData('text/plain', text)
  }

  private onCut = (e: ClipboardEvent) => {
    if (isEditableTarget(e.target) || !this.editor.selection.size) return
    this.onCopy(e)
    this.editor.deleteSelection()
  }

  private onPaste = (e: ClipboardEvent) => {
    if (isEditableTarget(e.target)) return
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!text.trim()) return
    e.preventDefault()
    this.editor.paste(text, this.lastPointer ?? undefined)
  }
}
