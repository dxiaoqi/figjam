import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBoard } from '../board-context'
import { mcpSnippets } from '../lib/core'
import { tn, useT } from '../i18n'
import { AgentSetup } from './AgentSetup'

export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const t = useT()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(t('common.copied', { label }))
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error(t('common.clipboardUnavailable'))
    }
  }
  return (
    <div className="group relative">
      <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/60 p-3 pr-12 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all select-all">{text}</pre>
      <Button size="icon" variant="ghost" className="absolute top-1.5 right-1.5 size-8" onClick={copy} aria-label={t('common.copy', { label })}>
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </Button>
    </div>
  )
}

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { health } = useBoard()
  const t = useT()
  const s = mcpSnippets(health, t('connect.cliExample').split('|') as [string, string, string])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-x-hidden overflow-y-auto sm:max-w-xl [&>*]:min-w-0" data-connect-dialog>
        <DialogHeader>
          <DialogTitle>{t('connect.title')}</DialogTitle>
          <DialogDescription>{tn('connect.description', { cli: <code className="font-mono">nodboard</code> })}</DialogDescription>
        </DialogHeader>
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">{t('connect.oneClick')}</h3>
          {open && <AgentSetup />}
        </section>
        <h3 className="-mb-1 text-xs font-medium text-muted-foreground">
          {t('connect.manual')} <span className="font-normal">· {t('connect.manualHint')}</span>
        </h3>
        <Tabs defaultValue="claude">
          <TabsList>
            <TabsTrigger value="claude">Claude Code</TabsTrigger>
            <TabsTrigger value="cursor">Cursor</TabsTrigger>
            <TabsTrigger value="http">HTTP</TabsTrigger>
            <TabsTrigger value="cli">CLI</TabsTrigger>
          </TabsList>
          <TabsContent value="claude" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">{t('connect.runOnce')}</p>
            <CopyBlock label={t('connect.claudeLabel')} text={s.claude} />
            <p className="text-sm text-muted-foreground">{t('connect.claudeThen')}</p>
          </TabsContent>
          <TabsContent value="cursor" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">
              {tn('connect.cursorAdd', { global: <code className="font-mono">~/.cursor/mcp.json</code>, project: <code className="font-mono">.cursor/mcp.json</code> })}
            </p>
            <CopyBlock label={t('connect.cursorLabel')} text={s.cursor} />
          </TabsContent>
          <TabsContent value="http" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">
              {tn('connect.http', { url: <code className="font-mono">{s.url}</code> })}
              {tn('connect.httpToken', { cmd: <code className="font-mono">nodboard token --rotate</code> })}
            </p>
            <CopyBlock label={t('connect.claudeHttpLabel')} text={s.claudeHttp} />
            <CopyBlock label={t('connect.cursorHttpLabel')} text={s.cursorHttp} />
          </TabsContent>
          <TabsContent value="cli" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">{t('connect.cli')}</p>
            <CopyBlock label={t('connect.cliLabel')} text={s.cli} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
