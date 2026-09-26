import { FramedShot } from '@/components/product-shot'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ShotName } from '@/lib/media'

export function ShotTabs({ tabs, shots, alts, title }: { tabs: readonly string[]; shots: readonly ShotName[]; alts: readonly string[]; title?: string }) {
  return (
    <Tabs defaultValue="0" className="gap-6">
      <TabsList className="mx-auto h-9 max-w-full rounded-full bg-black/[0.04] p-1">
        {tabs.map((label, i) => (
          <TabsTrigger key={label} value={String(i)} className="min-w-0 rounded-full px-2.5 text-[13px] data-[state=active]:shadow-sm sm:px-3.5">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {shots.map((name, i) => (
        <TabsContent key={name} value={String(i)} className="animate-in fade-in-0 duration-300">
          <FramedShot name={name} alt={alts[i]} title={title} />
        </TabsContent>
      ))}
    </Tabs>
  )
}
