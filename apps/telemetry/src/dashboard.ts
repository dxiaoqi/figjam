// The admin dashboard: one static page. It asks for the admin token (kept in sessionStorage for this tab only)
// and draws /api/stats. No external scripts, fonts or trackers.
export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ai-figma · installs</title>
<style>
  :root { --bg:#FAFAF9; --card:#fff; --ink:#1C1917; --muted:#78716C; --line:#E7E5E4; --accent:#6E56CF; --accent2:#E8DEFF; --yellow:#F5D90A; --soft:#F5F5F4; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141416; --card:#1C1C1F; --ink:#F5F5F4; --muted:#A8A29E; --line:#2E2E32; --accent:#9E8CFC; --accent2:#3A3060; --soft:#232327; } }
  * { box-sizing: border-box; }
  body { margin:0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--ink); }
  header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 28px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:600; }
  .brand small { color:var(--muted); font-weight:400; }
  main { max-width:1180px; margin:0 auto; padding:24px 28px 48px; }
  .seg { display:inline-flex; background:var(--soft); border-radius:10px; padding:3px; gap:2px; }
  .seg button { border:0; background:none; color:var(--muted); font:inherit; font-size:13px; padding:5px 12px; border-radius:8px; cursor:pointer; }
  .seg button[aria-pressed=true] { background:var(--card); color:var(--ink); font-weight:500; box-shadow:0 1px 2px rgba(0,0,0,.08); }
  .ghost { border:1px solid var(--line); background:var(--card); color:var(--ink); border-radius:8px; padding:5px 10px; font:inherit; font-size:13px; cursor:pointer; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px; }
  .card .label { color:var(--muted); font-size:12.5px; }
  .card .value { font-size:28px; font-weight:600; letter-spacing:-.02em; margin-top:2px; font-variant-numeric: tabular-nums; }
  .card .sub { color:var(--muted); font-size:12px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px; }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:12px; }
  @media (max-width: 860px) { .grid2, .grid3 { grid-template-columns:1fr; } header, main { padding-left:16px; padding-right:16px; } }
  h2 { font-size:13.5px; font-weight:600; margin:0 0 10px; display:flex; justify-content:space-between; align-items:baseline; }
  h2 span { color:var(--muted); font-weight:400; font-size:12px; }
  svg.chart { width:100%; height:160px; display:block; }
  .axis { fill:var(--muted); font-size:10px; }
  .bars rect { fill:var(--accent); }
  .bars rect:hover { opacity:.75; }
  .list { display:flex; flex-direction:column; gap:6px; }
  .row { display:grid; grid-template-columns: 1fr auto; gap:8px; font-size:13px; position:relative; padding:4px 8px; border-radius:6px; overflow:hidden; }
  .row i { position:absolute; inset:0 auto 0 0; background:var(--accent2); border-radius:6px; z-index:0; }
  .row span, .row b { position:relative; z-index:1; font-variant-numeric: tabular-nums; }
  .row b { font-weight:500; }
  .empty { color:var(--muted); font-size:13px; padding:12px 0; }
  #gate { max-width:380px; margin:12vh auto; background:var(--card); border:1px solid var(--line); border-radius:20px; padding:28px; }
  #gate h1 { font-size:18px; margin:0 0 6px; }
  #gate p { color:var(--muted); margin:0 0 16px; font-size:13px; }
  #gate input { width:100%; padding:9px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg); color:var(--ink); font:inherit; }
  #gate button { margin-top:12px; width:100%; padding:9px; border:0; border-radius:10px; background:var(--ink); color:var(--bg); font:inherit; font-weight:500; cursor:pointer; }
  #gate .err { color:#DC2626; font-size:12.5px; margin-top:8px; min-height:1em; }
  .note { color:var(--muted); font-size:12px; margin-top:20px; }
  .tip { position:fixed; pointer-events:none; background:var(--ink); color:var(--bg); font-size:12px; padding:4px 8px; border-radius:6px; display:none; white-space:nowrap; }
</style>
</head>
<body>
<header>
  <div class="brand">
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><rect x="7" y="7" width="11" height="11" rx="2" fill="#FFF1B8"/><rect x="14" y="14" width="11" height="11" rx="3" fill="#E8DEFF"/></svg>
    ai-figma <small>installs &amp; downloads</small>
  </div>
  <div style="display:flex;gap:8px;align-items:center" id="controls" hidden>
    <div class="seg" role="group" aria-label="Range">
      <button data-days="7">7 days</button><button data-days="30">30 days</button><button data-days="90">90 days</button>
    </div>
    <button class="ghost" id="signout">Sign out</button>
  </div>
</header>

<form id="gate" hidden>
  <h1>Admin sign-in</h1>
  <p>Paste the <code>ADMIN_TOKEN</code> this service was started with. It stays in this tab only.</p>
  <input id="token" type="password" autocomplete="current-password" placeholder="Admin token" aria-label="Admin token" required>
  <button type="submit">Show dashboard</button>
  <div class="err" id="err" role="alert"></div>
</form>

<main id="dash" hidden>
  <section class="cards" id="cards"></section>
  <section class="grid2">
    <div class="card"><h2>New installs per day <span id="r1"></span></h2><div id="c-installs"></div></div>
    <div class="card"><h2>Daily active installs <span id="r2"></span></h2><div id="c-dau"></div></div>
  </section>
  <section class="grid2">
    <div class="card"><h2>Downloads per day <span id="r3"></span></h2><div id="c-downloads"></div></div>
    <div class="card"><h2>Downloads by file <span>in range</span></h2><div id="l-dlp" class="list"></div></div>
  </section>
  <section class="grid3">
    <div class="card"><h2>Installs by OS <span>in range</span></h2><div id="l-os" class="list"></div></div>
    <div class="card"><h2>Installs by version <span>in range</span></h2><div id="l-ver" class="list"></div></div>
    <div class="card"><h2>Active by version <span>last 7 days</span></h2><div id="l-aver" class="list"></div></div>
  </section>
  <section class="grid2">
    <div class="card"><h2>Installs by locale <span>in range</span></h2><div id="l-loc" class="list"></div></div>
    <div class="card"><h2>Installs by architecture <span>in range</span></h2><div id="l-arch" class="list"></div></div>
  </section>
  <p class="note">Counts come from opt-in, anonymous pings: a random install ID, app version, OS, architecture and locale. No IP addresses or content are stored. Days are UTC.</p>
</main>
<div class="tip" id="tip"></div>

<script>
(() => {
  const $ = (id) => document.getElementById(id)
  const KEY = 'aifig-telemetry-token'
  let days = Number(localStorage.getItem('aifig-telemetry-days')) || 30
  const fmt = (n) => Number(n).toLocaleString('en-US')
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
  const OS = { macos: 'macOS', windows: 'Windows', linux: 'Linux', other: 'Other' }

  function showGate(msg) {
    $('dash').hidden = true; $('controls').hidden = true; $('gate').hidden = false
    $('err').textContent = msg || ''
    $('token').focus()
  }

  async function load() {
    const token = sessionStorage.getItem(KEY)
    if (!token) return showGate()
    const r = await fetch('/api/stats?days=' + days, { headers: { authorization: 'Bearer ' + token } }).catch(() => null)
    if (!r) return showGate('Could not reach the service.')
    if (r.status === 401) { sessionStorage.removeItem(KEY); return showGate('That token was not accepted.') }
    const s = await r.json()
    if (!s.ok) return showGate(s.error || 'Something went wrong.')
    $('gate').hidden = true; $('dash').hidden = false; $('controls').hidden = false
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days)))
    render(s)
  }

  function card(label, value, sub) {
    return '<div class="card"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub) + '</div></div>'
  }

  function bars(el, series, color) {
    const W = 560, H = 160, pad = 22, n = series.length
    const max = Math.max(1, ...series.map((d) => d.n))
    const bw = (W - pad) / n
    let out = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img"><g class="bars">'
    series.forEach((d, i) => {
      const h = Math.max(d.n ? 2 : 0, (d.n / max) * (H - 28))
      out += '<rect x="' + (pad + i * bw + bw * 0.15).toFixed(1) + '" y="' + (H - 16 - h).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5"' + (color ? ' style="fill:' + color + '"' : '') + ' data-tip="' + d.day + ': ' + fmt(d.n) + '"/>'
    })
    out += '</g><text class="axis" x="0" y="10">' + fmt(max) + '</text><text class="axis" x="0" y="' + (H - 18) + '">0</text>'
    out += '<text class="axis" x="' + pad + '" y="' + (H - 2) + '">' + series[0].day.slice(5) + '</text><text class="axis" x="' + W + '" y="' + (H - 2) + '" text-anchor="end">' + series[n - 1].day.slice(5) + '</text></svg>'
    el.innerHTML = out
  }

  function list(el, rows, label) {
    if (!rows.length) { el.innerHTML = '<div class="empty">No data yet</div>'; return }
    const max = Math.max(...rows.map((r) => r.n))
    const total = rows.reduce((s, r) => s + r.n, 0)
    el.innerHTML = rows.map((r) => '<div class="row"><i style="width:' + (r.n / max * 100).toFixed(1) + '%"></i><span>' + esc(label ? label(r.k) : r.k) + '</span><b>' + fmt(r.n) + ' <span style="color:var(--muted);font-weight:400">' + Math.round(r.n / total * 100) + '%</span></b></div>').join('')
  }

  function render(s) {
    const t = s.totals
    const conv = 'new installs ÷ downloads, in range'
    $('cards').innerHTML = [
      card('Total installs', fmt(t.installs), fmt(t.installsInRange) + ' in the last ' + s.range.days + ' days'),
      card('Active today', fmt(t.dauToday), 'distinct installs, UTC day'),
      card('Active, 7 days', fmt(t.active7), 'distinct installs'),
      card('Active, 30 days', fmt(t.active30), 'distinct installs'),
      card('Downloads', fmt(t.downloads), fmt(t.downloadsInRange) + ' in range'),
      card('Installs per download', t.downloadsInRange ? Math.round(t.installsInRange / t.downloadsInRange * 100) + '%' : '—', conv),
    ].join('')
    const range = s.range.since + ' → ' + s.range.until
    $('r1').textContent = range; $('r2').textContent = range; $('r3').textContent = range
    bars($('c-installs'), s.installsByDay)
    bars($('c-dau'), s.dauByDay, '#2F9E77')
    bars($('c-downloads'), s.downloadsByDay, '#D97757')
    list($('l-os'), s.installsByOs, (k) => OS[k] || k)
    list($('l-ver'), s.installsByVersion)
    list($('l-aver'), s.activeByVersion)
    list($('l-loc'), s.installsByLocale)
    list($('l-arch'), s.installsByArch)
    list($('l-dlp'), s.downloadsByPlatform, (k) => k.replace(/^(\\w+)/, (m) => OS[m] || m))
  }

  $('gate').addEventListener('submit', (e) => {
    e.preventDefault()
    sessionStorage.setItem(KEY, $('token').value.trim())
    $('token').value = ''
    load()
  })
  $('signout').addEventListener('click', () => { sessionStorage.removeItem(KEY); showGate() })
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    days = Number(b.dataset.days); localStorage.setItem('aifig-telemetry-days', String(days)); load()
  }))
  const tip = $('tip')
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]')
    if (!t) { tip.style.display = 'none'; return }
    tip.textContent = t.getAttribute('data-tip'); tip.style.display = 'block'
    tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 28) + 'px'
  })
  load()
})()
</script>
</body>
</html>`
