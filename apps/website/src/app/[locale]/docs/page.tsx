import type { Metadata } from 'next'
import { CodeBlock } from '@/components/copy-command'
import { DocsToc } from '@/components/docs-toc'
import { FramedShot } from '@/components/product-shot'
import { Container, Eyebrow } from '@/components/section'
import { commands } from '@/content/commands'
import { site } from '@/config/site'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n'
import { pageMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const m = getDictionary(locale).meta
  return pageMetadata({ locale, path: '/docs/', title: m.docs, description: m.docsDescription, og: 'docs' })
}

function H2({ id, n, children }: { id: string; n: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="headline flex scroll-mt-24 items-baseline gap-3 text-2xl font-semibold sm:text-[1.75rem]">
      <span className="font-mono text-[13px] font-normal text-muted-foreground">0{n}</span>
      {children}
    </h2>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-10 text-[16px] font-semibold text-foreground">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[15.5px] leading-7 text-foreground/75">{children}</p>
}

function Table({ headers, rows }: { headers: readonly string[]; rows: readonly (readonly React.ReactNode[])[] }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-border bg-white">
      <table className="w-full text-left text-[14px]">
        <thead className="border-b border-border bg-[#FBFBFA] text-[12.5px] text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/70 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? 'px-4 py-3 align-top font-medium whitespace-nowrap text-foreground' : 'px-4 py-3 align-top leading-relaxed text-foreground/75'}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[12.5px] text-foreground/85">{children}</code>
}

export default async function DocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = isLocale(raw) ? raw : 'zh'
  const t = getDictionary(locale)
  const d = t.docs
  const s = d.sections
  const labels = t.common
  const toc = [
    { id: 'install', label: s.install.title },
    { id: 'connect', label: s.connect.title },
    { id: 'tools', label: s.tools.title },
    { id: 'skills', label: s.skills.title },
  ]

  return (
    <>
      <section className="relative -mt-14 overflow-hidden border-b border-border/70 pt-14">
        <div aria-hidden className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_20%,transparent_100%)]" />
        <Container className="pt-16 pb-14 sm:pt-20">
          <Eyebrow dot="var(--tk-blue-accent)">{d.eyebrow}</Eyebrow>
          <h1 className="display mt-5 text-4xl font-semibold sm:text-5xl">{d.title}</h1>
          <p className="lede mt-5 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">
            {d.lede}{' '}
            <a href={site.repoUrl} target="_blank" rel="noreferrer" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              {d.readme} ↗
            </a>
          </p>
        </Container>
      </section>

      <Container className="grid gap-10 py-12 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16 lg:py-16">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <DocsToc items={toc} title={d.toc} />
        </aside>

        <article className="max-w-3xl min-w-0 space-y-20">
          <section aria-labelledby="install">
            <H2 id="install" n={1}>
              {s.install.title}
            </H2>
            <P>{s.install.body}</P>
            <CodeBlock code={commands.quickstart} labels={labels} className="mt-5" />
            <P>{s.install.open}</P>
            <H3>{s.install.processes}</H3>
            <Table headers={s.install.headers} rows={s.install.processRows.map((r) => [<Mono key="n">{r.name}</Mono>, <Mono key="p">{r.port}</Mono>, r.what])} />
            <H3>{s.install.desktop}</H3>
            <P>{s.install.desktopBody}</P>
            <CodeBlock code={commands.desktopAll} labels={labels} className="mt-5" />
            <P>{s.install.data}</P>
          </section>

          <section aria-labelledby="connect">
            <H2 id="connect" n={2}>
              {s.connect.title}
            </H2>
            <P>{s.connect.body}</P>
            <H3>{s.connect.oneClick}</H3>
            <P>{s.connect.oneClickBody}</P>
            <FramedShot name={locale === 'zh' ? 'connect-agent-zh' : 'connect-agent-en'} alt={t.home.steps.items[0].alt} bare className="mt-6" />
            <H3>{s.connect.claude}</H3>
            <CodeBlock code={commands.claude} labels={labels} className="mt-4" />
            <H3>{s.connect.cursor}</H3>
            <CodeBlock code={commands.cursor} lang="json" labels={labels} title="mcp.json" className="mt-4" />
            <H3>{s.connect.http}</H3>
            <P>{s.connect.httpBody}</P>
            <CodeBlock code={commands.http} labels={labels} className="mt-4" />
            <H3>{s.connect.skill}</H3>
            <P>{s.connect.skillBody}</P>
            <CodeBlock code={commands.skillCopy} labels={labels} className="mt-4" />
            <div className="mt-8 rounded-lg border-l-2 px-5 py-4" style={{ borderColor: 'var(--tk-agent-0)', background: 'color-mix(in srgb, var(--tk-orange-bg) 35%, white)' }}>
              <p className="text-[12.5px] font-medium text-muted-foreground">{s.connect.prompt}</p>
              <p className="mt-1 text-[15.5px] text-foreground">{s.connect.promptText}</p>
            </div>
          </section>

          <section aria-labelledby="tools">
            <H2 id="tools" n={3}>
              {s.tools.title}
            </H2>
            <P>{s.tools.body}</P>
            <Table
              headers={s.tools.headers}
              rows={s.tools.groups.map((g) => [
                g.group,
                <span key="t" className="font-mono text-[12.5px] leading-6 break-words text-foreground/80">
                  {g.tools}
                </span>,
              ])}
            />
            <H3>{s.tools.intents}</H3>
            <P>{s.tools.intentsBody}</P>
            <H3>{s.tools.cli}</H3>
            <CodeBlock code={commands.cli} labels={labels} className="mt-4" />
          </section>

          <section aria-labelledby="skills">
            <H2 id="skills" n={4}>
              {s.skills.title}
            </H2>
            <P>{s.skills.body}</P>
            <CodeBlock code={commands.skillTree} lang="md" labels={labels} className="mt-5" />
            <H3>{s.skills.frontmatter}</H3>
            <P>{s.skills.frontmatterBody}</P>
            <CodeBlock code={commands.skillMd} lang="md" title="competitor-kit/SKILL.md" labels={labels} className="mt-4" />
            <H3>{s.skills.blocks}</H3>
            <P>{s.skills.blocksBody}</P>
            <CodeBlock code={commands.blocksJson} lang="json" title="competitor-kit/canvas/blocks.json" labels={labels} className="mt-4" />
            <H3>{s.skills.levels}</H3>
            <Table headers={[s.skills.levels, '']} rows={s.skills.levelRows.map((r) => [<Mono key="l">{r.level}</Mono>, r.what])} />
            <H3>{s.skills.workflow}</H3>
            <CodeBlock code={commands.skillCli} labels={labels} className="mt-4" />
            <P>{s.skills.saveAs}</P>
            <FramedShot name="skills-library" alt={t.home.skills.alts.library} bare className="mt-6" />
          </section>
        </article>
      </Container>
    </>
  )
}
