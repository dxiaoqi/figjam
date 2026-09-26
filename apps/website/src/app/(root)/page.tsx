import { LOCALE_STORAGE_KEY, defaultLocale } from '@/i18n/config'

const redirect = `(function(){var l='${defaultLocale}';try{var s=localStorage.getItem('${LOCALE_STORAGE_KEY}');if(s==='en'||s==='zh')l=s}catch(e){}location.replace('/'+l+'/'+location.hash)})()`

export default function RootRedirect() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: redirect }} />
      <noscript>
        <meta httpEquiv="refresh" content={`0;url=/${defaultLocale}/`} />
      </noscript>
      <main className="flex min-h-dvh items-center justify-center gap-6 text-sm text-muted-foreground">
        <a href="/zh/">简体中文</a>
        <a href="/en/">English</a>
      </main>
    </>
  )
}
