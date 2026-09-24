// Tries to get out of the sandbox; reports what happened through the only allowed channel (its own state).
const r = {}
const settle = (k, p) => p.then(() => (r[k] = 'allowed'), () => (r[k] = 'blocked'))
try { r.parentDocument = parent.document && parent.document.body ? 'allowed' : 'blocked' } catch { r.parentDocument = 'blocked' }
try { r.parentStorage = parent.localStorage ? 'allowed' : 'blocked' } catch { r.parentStorage = 'blocked' }
try { r.parentEditor = parent.editor ? 'allowed' : 'blocked' } catch { r.parentEditor = 'blocked' }
try { localStorage.setItem('x', '1'); r.ownStorage = 'allowed' } catch { r.ownStorage = 'blocked' }
try { document.cookie = 'a=1'; r.cookie = document.cookie.includes('a=1') ? 'allowed' : 'blocked' } catch { r.cookie = 'blocked' }
try { const w = window.open('https://example.com/'); r.popup = w ? 'allowed' : 'blocked' } catch { r.popup = 'blocked' }
try { top.location.href = 'https://example.com/pwned'; r.topNavigation = 'attempted' } catch { r.topNavigation = 'blocked' }
const img = new Promise((ok, no) => { const i = new Image(); i.onload = ok; i.onerror = no; i.src = 'http://127.0.0.1:47821/api/health?img' })
const script = new Promise((ok, no) => { const s = document.createElement('script'); s.onload = ok; s.onerror = no; s.src = 'http://127.0.0.1:47820/src/main.tsx'; document.head.appendChild(s) })
const frame = new Promise((ok, no) => { const f = document.createElement('iframe'); f.onload = () => { try { f.contentDocument.body; ok() } catch { no() } }; f.src = 'http://127.0.0.1:47820/'; document.body.appendChild(f); setTimeout(no, 1500) })
Promise.allSettled([
  settle('fetchCore', fetch('http://127.0.0.1:47821/api/boards')),
  settle('fetchInternet', fetch('https://example.com/')),
  settle('xhr', new Promise((ok, no) => { const x = new XMLHttpRequest(); x.onload = ok; x.onerror = no; try { x.open('GET', 'http://127.0.0.1:47821/api/health'); x.send() } catch (e) { no(e) } })),
  settle('websocket', new Promise((ok, no) => { try { const ws = new WebSocket('ws://127.0.0.1:47821/sync/x'); ws.onopen = ok; ws.onerror = no } catch (e) { no(e) } })),
  settle('image', img),
  settle('externalScript', script),
  settle('nestedFrame', frame),
]).then(async () => {
  const big = 'x'.repeat(20000)
  r.oversizeState = await aifig.setState({ big }).then(() => 'allowed', () => 'blocked')
  r.neighbors = (await aifig.requestPermission('neighbors')).status
  r.network = (await aifig.requestPermission('network')).status
  await aifig.setState(r)
  document.body.textContent = JSON.stringify(r)
})
