import { Check, CircleAlert, Loader2, PlugZap, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { detectAgents, installAgent, testAgent, type AgentId, type AgentStatus } from '../lib/agents'
import { useT } from '../i18n'

const tilde = (p: string) => p.replace(/^(\/Users|\/home)\/[^/]+|^[A-Z]:\\Users\\[^\\]+/, '~')

function AgentMark({ id }: { id: AgentId }) {
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold text-white', id === 'claude' ? 'bg-[#D97757]' : 'bg-neutral-900 dark:bg-neutral-700')}>
      {id === 'claude' ? 'C' : '⌘'}
    </span>
  )
}

type Result = { kind: 'ok' | 'error' | 'info'; text: string; detail?: string }

function AgentRow({ agent, onChange }: { agent: AgentStatus; onChange: (a: AgentStatus) => void }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'write' | 'test' | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const name = t(agent.id === 'claude' ? 'setup.claude.name' : 'setup.cursor.name')
  const file = tilde(agent.configFile)

  const write = async () => {
    setBusy('write')
    try {
      const r = await installAgent(agent.id)
      onChange(r.status)
      setResult({ kind: r.changed ? 'ok' : 'info', text: t(r.changed ? 'setup.done' : 'setup.unchanged', { agent: name }), detail: r.backup ? t('setup.backupAt', { file: tilde(r.backup) }) : undefined })
      setConfirming(false)
    } catch (e) {
      setResult({ kind: 'error', text: t('setup.failed', { error: (e as Error).message }) })
    } finally {
      setBusy(null)
    }
  }
  const test = async () => {
    setBusy('test')
    try {
      const r = await testAgent(agent.id)
      setResult(r.ok ? { kind: 'ok', text: t('setup.testOk', { count: r.tools }), detail: t('setup.restart', { agent: name }) } : { kind: 'error', text: t('setup.testFailed', { error: r.error }) })
    } catch (e) {
      setResult({ kind: 'error', text: t('setup.testFailed', { error: (e as Error).message }) })
    } finally {
      setBusy(null)
    }
  }

  const pill =
    agent.state === 'configured'
      ? { cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300', text: t('setup.configured') }
      : !agent.installed
        ? { cls: 'bg-muted text-muted-foreground', text: t('setup.notFound') }
        : agent.state === 'different'
          ? { cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', text: t('setup.configuredOther') }
          : { cls: 'bg-muted text-muted-foreground', text: t('setup.notConfigured') }

  return (
    <div className="rounded-2xl border bg-background/60 p-3" data-agent-setup={agent.id} data-agent-state={agent.state}>
      <div className="flex items-center gap-3">
        <AgentMark id={agent.id} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium">{name}</span>
            <span className={cn('rounded-full px-2 py-px text-[11px] leading-5 font-medium', pill.cls)}>{pill.text}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground" title={agent.configFile}>
            {t(agent.id === 'claude' ? 'setup.claude.where' : 'setup.cursor.where', { file })}
          </div>
        </div>
        {agent.installed && !confirming && (
          <div className="flex shrink-0 gap-1.5">
            {agent.state === 'configured' ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={test} disabled={!!busy} data-agent-test>
                {busy === 'test' ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                {t(busy === 'test' ? 'setup.testing' : 'setup.test')}
              </Button>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={() => setConfirming(true)} disabled={!!busy || !!agent.error} data-agent-install>
                {t(agent.state === 'different' ? 'setup.update' : 'setup.setUp')}
              </Button>
            )}
          </div>
        )}
      </div>
      {!agent.installed && <p className="mt-2 pl-12 text-xs text-muted-foreground">{t('setup.notInstalledHint', { agent: name })}</p>}
      {agent.error && (
        <p className="mt-2 flex gap-1.5 pl-12 text-xs text-red-600 dark:text-red-400">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">
            {t('setup.unreadable', { file })} <span className="break-all opacity-70">{agent.error}</span>
          </span>
        </p>
      )}
      {confirming && (
        <div className="mt-3 ml-12 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed animate-in fade-in slide-in-from-top-1 duration-150" data-agent-confirm>
          <div className="text-[13px] font-medium">{t('setup.confirmTitle', { agent: name })}</div>
          <p className="mt-1 text-muted-foreground">{t('setup.confirmBody', { file })}</p>
          <p className="text-muted-foreground">{t(agent.configExists ? 'setup.confirmBackup' : 'setup.confirmNew')}</p>
          <div className="mt-2.5 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={!!busy}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={write} disabled={!!busy} data-agent-confirm-write>
              {busy === 'write' && <Loader2 className="size-3.5 animate-spin" />}
              {t(busy === 'write' ? 'setup.writing' : 'setup.confirmWrite', { agent: name })}
            </Button>
          </div>
        </div>
      )}
      {result && (
        <div
          className={cn('mt-2.5 ml-12 flex gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed', result.kind === 'error' ? 'bg-red-500/8 text-red-700 dark:text-red-300' : 'bg-emerald-500/8 text-emerald-800 dark:text-emerald-200')}
          data-agent-result={result.kind}
        >
          {result.kind === 'error' ? <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> : <Check className="mt-0.5 size-3.5 shrink-0" />}
          <div className="min-w-0">
            <div>{result.text}</div>
            {result.detail && <div className="break-all opacity-75">{result.detail}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/** Detected agents with one-click MCP setup and a connection test. */
export function AgentSetup({ className }: { className?: string }) {
  const t = useT()
  const [agents, setAgents] = useState<AgentStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      setAgents(await detectAgents())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  if (error)
    return (
      <div className={cn('flex items-center justify-between gap-3 rounded-2xl border p-3 text-xs text-muted-foreground', className)}>
        {t('setup.detectFailed', { error })}
        <Button size="icon" variant="ghost" className="size-7" onClick={load} aria-label={t('offline.retry')}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
    )
  if (!agents)
    return (
      <div className={cn('flex items-center gap-2 rounded-2xl border p-3 text-xs text-muted-foreground', className)}>
        <Loader2 className="size-3.5 animate-spin" /> {t('setup.detecting')}
      </div>
    )
  return (
    <div className={cn('flex flex-col gap-2', className)} data-agent-list>
      {agents.map((a) => (
        <AgentRow key={a.id} agent={a} onChange={(next) => setAgents((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null)} />
      ))}
    </div>
  )
}
