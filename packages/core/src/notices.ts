import fs from 'node:fs'
import path from 'node:path'
import type { DataNotice } from '@aifig/shared'
import { writeFileAtomic } from './atomic'
import { aifigHome } from './config'

/** Data notices (recoveries, unreadable files, failing saves), persisted until the person dismisses them. */
export class NoticeStore {
  private items: DataNotice[] = []
  onChange: (() => void) | null = null

  private get file() {
    return path.join(aifigHome(), 'notices.json')
  }

  load() {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (Array.isArray(v)) this.items = v
    } catch {
      this.items = []
    }
  }

  private save() {
    try {
      writeFileAtomic(this.file, JSON.stringify(this.items, null, 2))
    } catch (e) {
      console.error('[core] could not save notices:', e)
    }
    this.onChange?.()
  }

  /** Add or replace (same id) a notice. */
  add(n: Omit<DataNotice, 'createdAt'> & { createdAt?: number }) {
    const notice: DataNotice = { ...n, createdAt: n.createdAt ?? Date.now() }
    this.items = [...this.items.filter((x) => x.id !== n.id), notice]
    this.save()
    const where = notice.boardTitle ? ` “${notice.boardTitle}”` : ''
    console.error(`[core] ${notice.level}:${where} ${notice.title} — ${notice.detail}`)
    return notice
  }

  dismiss(id: string) {
    const before = this.items.length
    this.items = this.items.filter((x) => x.id !== id)
    if (this.items.length !== before) this.save()
    return before !== this.items.length
  }

  list(boardId?: string) {
    return this.items.filter((n) => !boardId || !n.boardId || n.boardId === boardId).sort((a, b) => b.createdAt - a.createdAt)
  }

  has(id: string) {
    return this.items.some((n) => n.id === id)
  }
}
