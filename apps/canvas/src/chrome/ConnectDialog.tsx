import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBoard } from '../board-context'
import { mcpSnippets } from '../lib/core'

export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(`${label} copied`)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Clipboard is not available — select the text and copy it manually.')
    }
  }
  return (
    <div className="group relative">
      <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/60 p-3 pr-12 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all select-all">{text}</pre>
      <Button size="icon" variant="ghost" className="absolute top-1.5 right-1.5 size-8" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </Button>
    </div>
  )
}

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { health } = useBoard()
  const s = mcpSnippets(health?.bin ?? '/path/to/ai-figma/bin/aifig.mjs')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect an agent</DialogTitle>
          <DialogDescription>
            Agents drive this canvas through the local MCP server or the <code className="font-mono">aifig</code> CLI. Their edits appear live with a cursor
            and wait for your review.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="claude">
          <TabsList>
            <TabsTrigger value="claude">Claude Code</TabsTrigger>
            <TabsTrigger value="cursor">Cursor</TabsTrigger>
            <TabsTrigger value="cli">CLI</TabsTrigger>
          </TabsList>
          <TabsContent value="claude" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">Run once in your terminal:</p>
            <CopyBlock label="Claude Code command" text={s.claude} />
            <p className="text-sm text-muted-foreground">Then ask: “Put the three options we discussed on the ai-figma board as cards, grouped by risk.”</p>
          </TabsContent>
          <TabsContent value="cursor" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">
              Add to <code className="font-mono">~/.cursor/mcp.json</code> (or your project’s <code className="font-mono">.cursor/mcp.json</code>):
            </p>
            <CopyBlock label="Cursor MCP config" text={s.cursor} />
          </TabsContent>
          <TabsContent value="cli" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">Scripts and agents without MCP can use the CLI:</p>
            <CopyBlock label="CLI example" text={s.cli} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
