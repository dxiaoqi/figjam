'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function CopyButton({ text, labels, className }: { text: string; labels: { copy: string; copied: string }; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? labels.copied : labels.copy}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground',
        className,
      )}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {copied ? labels.copied : ''}
      </span>
    </button>
  )
}

/** A terminal-style code block with a copy button. Lines starting with "#" render as comments. */
export function CodeBlock({
  code,
  labels,
  lang = 'bash',
  title,
  className,
}: {
  code: string
  labels: { copy: string; copied: string }
  lang?: 'bash' | 'json' | 'md'
  title?: string
  className?: string
}) {
  const copyText = lang === 'bash' ? code.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n') : code
  return (
    <div className={cn('group relative overflow-hidden rounded-lg border border-border bg-[#FBFBFA]', className)}>
      {title && (
        <div className="flex h-9 items-center border-b border-border px-3.5 font-mono text-[11.5px] text-muted-foreground">{title}</div>
      )}
      <CopyButton text={copyText} labels={labels} className={cn('absolute right-2', title ? 'top-1' : 'top-2')} />
      <pre className="overflow-x-auto px-4 py-3.5 pr-12 font-mono text-[12.5px] leading-6 text-stone-800">
        <code>
          {code.split('\n').map((line, i) => (
            <span key={i} className={cn('block', line.trim().startsWith('#') && lang !== 'md' ? 'text-stone-400' : undefined)}>
              {lang === 'bash' && line && !line.trim().startsWith('#') && !/^\s/.test(line) ? (
                <>
                  <span className="text-stone-400 select-none">$ </span>
                  {line}
                </>
              ) : (
                line || '\u00a0'
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
