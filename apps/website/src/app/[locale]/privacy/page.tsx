import { FileLock2, Globe, HardDrive } from 'lucide-react'
import type { Metadata } from 'next'
import { CodeBlock } from '@/components/copy-command'
import { DocsToc } from '@/components/docs-toc'
import { Container, Eyebrow } from '@/components/section'
import { site } from '@/config/site'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n'
import { pageMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const t = getDictionary(locale).privacy
  return pageMetadata({ locale, path: '/privacy/', title: t.metaTitle, description: t.description, og: 'privacy' })
}

const summaryIcons = [HardDrive, FileLock2, Globe]

const ping = JSON.stringify(
  { v: 1, event: 'install', installId: '5f0b0869-2f3c-480e-9a42-fe818d910566', appVersion: '0.2.0', os: 'macos', arch: 'arm64', locale: 'en-US' },
  null,
  2,
)

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const d = getDictionary(locale)
  const t = d.privacy
  const labels = { copy: d.common.copy, copied: d.common.copied }
  const sections = [
    { id: 'boards', label: t.boards.title },
    { id: 'agents', label: t.agents.title },
    { id: 'installs', label: t.installs.title },
    { id: 'downloads', label: t.downloads.title },
    { id: 'website', label: t.website.title },
    { id: 'storage', label: t.storage.title },
    { id: 'contact', label: t.contact.title },
  ]

  return (
    <>
      <section className="relative -mt-14 overflow-hidden pt-14">
        <div aria-hidden className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_30%,transparent_95%)]" />
        <Container className="pt-12 pb-14 sm:pt-20 sm:pb-20">
          <div className="max-w-3xl">
            <Eyebrow dot="var(--tk-green-accent)">{t.eyebrow}</Eyebrow>
            <h1 className="display mt-5 text-[2.25rem] leading-[1.1] font-semibold sm:text-5xl">{t.title}</h1>
            <p className="lede mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">{t.lede}</p>
            <p className="mt-4 text-[13px] text-muted-foreground">{t.updated}</p>
          </div>
          <ul className="mt-10 grid gap-3 sm:mt-12 sm:grid-cols-3">
            {t.summary.map((s, i) => {
              const Icon = summaryIcons[i]
              return (
                <li key={s.title} className="rounded-xl border border-border bg-card p-5">
                  <Icon className="size-5 text-foreground/70" aria-hidden strokeWidth={1.6} />
                  <h2 className="mt-4 text-[15px] font-semibold">{s.title}</h2>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              )
            })}
          </ul>
        </Container>
      </section>

      <section className="border-t border-border/70 bg-white py-16 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-[13rem_1fr] lg:gap-16 [&>*]:min-w-0">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <DocsToc title={t.toc} items={sections} />
          </aside>
          <div className="max-w-2xl space-y-14 text-[15.5px] leading-relaxed text-foreground/85">
            <Block id="boards" title={t.boards.title}>
              {t.boards.body.map((b) => (
                <p key={b}>{b}</p>
              ))}
            </Block>
            <Block id="agents" title={t.agents.title}>
              {t.agents.body.map((b) => (
                <p key={b}>{b}</p>
              ))}
            </Block>
            <Block id="installs" title={t.installs.title}>
              <p>{t.installs.body}</p>
              <CodeBlock code={ping} labels={labels} lang="json" title="POST /v1/events" />
              <h3 className="pt-2 text-[15.5px] font-semibold text-foreground">{t.installs.fieldsTitle}</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-[14px]">
                  <thead className="bg-background text-[12.5px] text-muted-foreground">
                    <tr>
                      {t.installs.headers.map((h) => (
                        <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.installs.fields.map((f) => (
                      <tr key={f.name} className="border-t border-border align-top">
                        <th scope="row" className="px-4 py-3 font-mono text-[13px] font-normal whitespace-nowrap text-foreground">
                          {f.name}
                        </th>
                        <td className="px-4 py-3 text-muted-foreground">{f.what}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="rounded-lg border-l-[3px] bg-background px-4 py-3" style={{ borderColor: 'var(--tk-green-accent)' }}>
                {t.installs.never}
              </p>
              <p>{t.installs.off}</p>
            </Block>
            <Block id="downloads" title={t.downloads.title}>
              <p>{t.downloads.body}</p>
            </Block>
            <Block id="website" title={t.website.title}>
              {t.website.body.map((b) => (
                <p key={b}>{b}</p>
              ))}
            </Block>
            <Block id="storage" title={t.storage.title}>
              {t.storage.body.map((b) => (
                <p key={b}>{b}</p>
              ))}
            </Block>
            <Block id="contact" title={t.contact.title}>
              <p>
                {t.contact.body}{' '}
                <a href={`mailto:${site.contactEmail}`} className="font-medium text-foreground underline underline-offset-4">
                  {site.contactEmail}
                </a>
              </p>
            </Block>
          </div>
        </Container>
      </section>
    </>
  )
}

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-20 space-y-4">
      <h2 id={id} className="headline text-2xl font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}
