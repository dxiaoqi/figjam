import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Vec } from '@aifig/canvas-engine'
import { normalizeEmbedUrl, SNIPPET_LIMITS } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBoard } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { callCore } from '../lib/core'

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
    }
    window.addEventListener('aifig:snippet-dialog', on)
    return () => window.removeEventListener('aifig:snippet-dialog', on)
  }, [editor])

  const check = tab === 'url' ? (url.trim() ? normalizeEmbedUrl(url) : null) : null
  const bytes = new TextEncoder().encode(html + css + js).byteLength
  const invalid = tab === 'url' ? !check || 'error' in check : !`${html}${js}`.trim() || bytes > SNIPPET_LIMITS.sourceBytes

  const save = async () => {
    if (!req || invalid) return
    setBusy(true)
    const src = tab === 'url' ? { url: url.trim() } : { html, css, js }
    try {
      if (req.id) await callCore('update_snippet', { board: boardId, id: req.id, title: title || undefined, ...src })
      else {
        const at = req.at ?? (() => {
          const vp = editor.viewportPageBounds()
          return { x: vp.x + vp.w / 2 - 240, y: vp.y + vp.h / 2 - 160 }
        })()
        const r = await callCore<{ id: string }>('create_snippet', { board: boardId, title: title || undefined, at, ...src })
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
          <DialogTitle>{req?.id ? 'Edit web snippet' : 'Add a web snippet'}</DialogTitle>
          <DialogDescription>
            Shows a preview on the board and runs only when you double-click it — sandboxed, on its own origin, without access to the board. Inline snippets have
            no network.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'url' | 'inline')}>
          <TabsList>
            <TabsTrigger value="url">Embed a URL</TabsTrigger>
            <TabsTrigger value="inline">HTML · CSS · JS</TabsTrigger>
          </TabsList>
          <TabsContent value="url" className="flex flex-col gap-2 pt-2">
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.figma.com/proto/…  ·  YouTube  ·  CodePen  ·  Loom" className={field} data-snippet-url />
            <p className="text-xs text-muted-foreground">
              {check && 'error' in check ? check.error : check ? `Embeds as ${check.provider}.` : 'Paste a share link; it is converted to its embeddable form.'}
            </p>
          </TabsContent>
          <TabsContent value="inline" className="flex flex-col gap-2 pt-2">
            <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<div id=app>…</div>" rows={5} className={field} data-snippet-html />
            <textarea value={css} onChange={(e) => setCss(e.target.value)} placeholder="CSS" rows={3} className={field} data-snippet-css />
            <textarea value={js} onChange={(e) => setJs(e.target.value)} placeholder="JS — keep state with await aifig.getState() / aifig.setState(obj)" rows={4} className={field} data-snippet-js />
            <p className="text-xs text-muted-foreground tabular-nums">{(bytes / 1024).toFixed(1)} / {SNIPPET_LIMITS.sourceBytes / 1024} KB · no network, no board access</p>
          </TabsContent>
        </Tabs>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-foreground/30" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setReq(null)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={invalid || busy} data-snippet-save>
            {req?.id ? 'Save' : 'Add to board'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
