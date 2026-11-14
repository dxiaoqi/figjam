import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Vec } from '@nodboard/canvas-engine'
import { normalizeEmbedUrl, SNIPPET_LIMITS, type Asset } from '@nodboard/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBoard } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { callCore } from '../lib/core'
import { fetchAssetText } from '../lib/assets'
import { useT } from '../i18n'

export interface SnippetDialogRequest {
  id?: string
  at?: Vec
}

const field = 'w-full rounded-lg border bg-muted/40 px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-foreground/30'

/** Create or edit a web snippet: an embedded URL, or inline HTML / CSS / JS. */
export function SnippetDialog() {
  const editor = useEditor()
  const { boardId } = useBoard()
  const [req, setReq] = useState<SnippetDialogRequest | null>(null)
  const [tab, setTab] = useState<'url' | 'inline'>('url')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [html, setHtml] = useState('')
  const [css, setCss] = useState('')
  const [js, setJs] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const t = useT()

  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<SnippetDialogRequest>).detail
      const web = r.id ? editor.block(r.id)?.web : undefined
      setTab(web?.mode ?? 'url')
      setUrl(web?.url ?? '')
      setTitle(web?.title ?? '')
      setHtml(web?.html ?? '')
      setCss(web?.css ?? '')
      setJs(web?.js ?? '')
      setReq(r)
      // stored source lives in the board's files
      if (web?.src) {
        const assets = editor.doc.getMap<Asset>('assets')
        const read = (id?: string) => {
          const a = id ? assets.get(id) : undefined
          return a ? fetchAssetText(boardId, a) : Promise.resolve('')
        }
        setLoading(true)
        Promise.all([read(web.src.html), read(web.src.css), read(web.src.js)])
          .then(([h, c, j]) => {
            setHtml(h)
            setCss(c)
            setJs(j)
          })
          .catch((err) => toast.error((err as Error).message))
          .finally(() => setLoading(false))
      }
    }
    window.addEventListener('nodboard:snippet-dialog', on)
    return () => window.removeEventListener('nodboard:snippet-dialog', on)
  }, [editor, boardId])

  const check = tab === 'url' ? (url.trim() ? normalizeEmbedUrl(url) : null) : null
  const bytes = new TextEncoder().encode(html + css + js).byteLength
  const invalid = tab === 'url' ? !check || 'error' in check : !`${html}${js}`.trim() || bytes > SNIPPET_LIMITS.sourceBytes

  const save = async () => {
    if (!req || invalid) return
    setBusy(true)
    const src = tab === 'url' ? { url: url.trim() } : { html, css, js }
    try {
      const notify = (r: { warnings?: string[] }) => r.warnings?.forEach((w) => toast.warning(w))
      if (req.id) notify(await callCore('update_snippet', { board: boardId, id: req.id, title: title || undefined, ...src }))
      else {
        const at = req.at ?? (() => {
          const vp = editor.viewportPageBounds()
          return { x: vp.x + vp.w / 2 - 240, y: vp.y + vp.h / 2 - 160 }
        })()
        const r = await callCore<{ id: string; warnings?: string[] }>('create_snippet', { board: boardId, title: title || undefined, at, ...src })
        notify(r)
        if (r.id) setTimeout(() => editor.select([r.id]), 150)
      }
      setReq(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && setReq(null)}>
      <DialogContent className="sm:max-w-xl" data-snippet-dialog>
        <DialogHeader>
          <DialogTitle>{t(req?.id ? 'snippet.editTitle' : 'snippet.addTitle')}</DialogTitle>
          <DialogDescription>{t('snippet.description')}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'url' | 'inline')}>
          <TabsList>
            <TabsTrigger value="url">{t('snippet.tabUrl')}</TabsTrigger>
            <TabsTrigger value="inline">HTML · CSS · JS</TabsTrigger>
          </TabsList>
          <TabsContent value="url" className="flex flex-col gap-2 pt-2">
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.figma.com/proto/…  ·  YouTube  ·  CodePen  ·  Loom" className={field} data-snippet-url />
            <p className="text-xs text-muted-foreground">
              {check && 'error' in check ? check.error : check ? t('snippet.embedsAs', { provider: check.provider }) : t('snippet.pasteHint')}
            </p>
          </TabsContent>
          <TabsContent value="inline" className="flex flex-col gap-2 pt-2">
            <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<div id=app>…</div>" rows={5} className={field} data-snippet-html />
            <textarea value={css} onChange={(e) => setCss(e.target.value)} placeholder="CSS" rows={3} className={field} data-snippet-css />
            <textarea value={js} onChange={(e) => setJs(e.target.value)} placeholder={t('snippet.jsPlaceholder')} rows={4} className={field} data-snippet-js />
            <p className="text-xs text-muted-foreground tabular-nums">{t('snippet.limits', { used: (bytes / 1024).toFixed(1), max: SNIPPET_LIMITS.sourceBytes / 1024 })}</p>
          </TabsContent>
        </Tabs>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('snippet.titlePlaceholder')} className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-foreground/30" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setReq(null)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={invalid || busy || loading} data-snippet-save>
            {t(req?.id ? 'common.save' : 'snippet.add')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
