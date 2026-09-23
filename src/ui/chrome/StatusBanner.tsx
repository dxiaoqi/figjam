import { WifiOff } from 'lucide-react'
import { useProviderState } from '../board-context'

export function StatusBanner() {
  const { status } = useProviderState()
  if (status !== 'offline') return null
  return (
    <div className="pointer-events-auto absolute top-16 left-1/2 z-[400] -translate-x-1/2 animate-in fade-in slide-in-from-top-2">
      <div className="chrome flex items-center gap-2.5 rounded-full py-2 pr-4 pl-3 text-xs">
        <WifiOff className="size-3.5 text-red-500" />
        <span>
          Lost connection to the ai-figma core. Your edits are kept locally and will sync when it’s back — start it with{' '}
          <code className="rounded bg-muted px-1 font-mono">npm run core</code>.
        </span>
      </div>
    </div>
  )
}
