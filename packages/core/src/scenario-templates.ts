import type { TemplateStep } from './templates'

type L = (en: string, zh: string) => string

/**
 * Scenario templates: the starting board of each scenario skill, in its own block types (the skill is enabled
 * before these steps run). Same rules as the other templates: layout intents only, texts that are connected
 * later are unique on the board.
 */

const variantCss = `
*{box-sizing:border-box;margin:0}
body{font:14px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1c1c1f;background:#fafaf9;height:100vh;display:flex;flex-direction:column}
header{padding:18px 20px 12px}
h1{font-size:17px;font-weight:650;letter-spacing:-.01em}
.sub{color:#6b6b73;font-size:12.5px;margin-top:2px}
main{flex:1;padding:4px 20px 16px;display:flex;flex-direction:column;gap:12px;overflow:auto}
label{display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:550;color:#3a3a40}
input{font:inherit;padding:9px 11px;border:1px solid #d9d9de;border-radius:9px;background:#fff;outline:none}
input:focus{border-color:#6e56cf;box-shadow:0 0 0 3px #6e56cf26}
button{font:inherit;font-weight:600;border:0;border-radius:9px;padding:10px 14px;cursor:pointer}
button:focus-visible{outline:2px solid #6e56cf;outline-offset:2px}
.primary{background:#1c1c1f;color:#fff}.primary:disabled{opacity:.35;cursor:default}
.ghost{background:transparent;color:#55555c}
.row{display:flex;gap:8px;justify-content:space-between;align-items:center}
.card{background:#fff;border:1px solid #ececef;border-radius:12px;padding:12px}
.muted{color:#6b6b73;font-size:12.5px}
.done{color:#1a7f4b;font-weight:600}
`

function variantA(l: L) {
  return {
    html: `<header><h1>${l('Set up your workspace', '设置你的工作区')}</h1><p class="sub" id="step-label"></p><div class="bar"><i id="bar"></i></div></header>
<main id="panes">
<section data-step="0"><label>${l('Workspace name', '工作区名称')}<input id="ws" placeholder="${l('Acme research', 'Acme 研究组')}"></label><p class="muted">${l('You can rename it later.', '之后可以改名。')}</p></section>
<section data-step="1" hidden><label>${l('Invite teammates', '邀请同事')}<input id="mail" placeholder="name@company.com"></label><p class="muted">${l('Optional — skip if you work alone.', '可选 —— 一个人用可以跳过。')}</p></section>
<section data-step="2" hidden><div class="card"><b>${l('Connect Claude Code', '连接 Claude Code')}</b><p class="muted">${l('One click adds ai-figma to its MCP settings.', '一键写入它的 MCP 配置。')}</p></div><p class="done" id="ok" hidden>✓ ${l('Workspace ready', '工作区已就绪')}</p></section>
</main>
<footer class="row" style="padding:0 20px 18px"><button class="ghost" id="back">${l('Back', '上一步')}</button><button class="primary" id="next">${l('Continue', '继续')}</button></footer>`,
    css: `${variantCss}.bar{height:4px;background:#ececef;border-radius:4px;margin-top:12px;overflow:hidden}.bar i{display:block;height:100%;background:#6e56cf;transition:width .25s}`,
    js: `const labels=[${JSON.stringify(l('Step 1 of 3 · Name', '第 1 步，共 3 步 · 名称'))},${JSON.stringify(l('Step 2 of 3 · Team', '第 2 步，共 3 步 · 团队'))},${JSON.stringify(l('Step 3 of 3 · Agent', '第 3 步，共 3 步 · Agent'))}]
let step=0
const panes=[...document.querySelectorAll('[data-step]')],next=document.getElementById('next'),back=document.getElementById('back'),ws=document.getElementById('ws')
function render(){panes.forEach((p,i)=>p.hidden=i!==step);document.getElementById('step-label').textContent=labels[step];document.getElementById('bar').style.width=((step+1)/3*100)+'%';back.style.visibility=step?'visible':'hidden';next.disabled=step===0&&!ws.value.trim();next.textContent=step===2?${JSON.stringify(l('Finish', '完成'))}:${JSON.stringify(l('Continue', '继续'))}}
ws.addEventListener('input',render)
next.addEventListener('click',()=>{if(step<2){step++;render()}else{document.getElementById('ok').hidden=false;next.disabled=true}})
back.addEventListener('click',()=>{step=Math.max(0,step-1);render()})
render()`,
  }
}

function variantB(l: L) {
  const items = [l('Name your workspace', '给工作区命名'), l('Invite a teammate', '邀请一位同事'), l('Connect an agent', '连接一个 Agent')]
  return {
    html: `<header class="row"><div><h1>${l('Get started', '开始使用')}</h1><p class="sub">${l('Three things, any order.', '三件事，顺序随意。')}</p></div><svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="#ececef" stroke-width="4"/><circle id="ring" cx="18" cy="18" r="15" fill="none" stroke="#1a7f4b" stroke-width="4" stroke-linecap="round" stroke-dasharray="94.2" stroke-dashoffset="94.2" transform="rotate(-90 18 18)"/></svg></header>
<main>${items.map((t, i) => `<label class="card item"><span class="row" style="justify-content:flex-start;gap:10px"><input type="checkbox" data-i="${i}"><span>${t}</span></span></label>`).join('')}<p class="muted" id="count"></p></main>`,
    css: `${variantCss}.item{flex-direction:row;cursor:pointer;font-weight:500}.item input{width:18px;height:18px;padding:0;accent-color:#1a7f4b}.item:has(input:checked) span span{text-decoration:line-through;color:#8a8a92}`,
    js: `const boxes=[...document.querySelectorAll('input[type=checkbox]')]
function render(){const n=boxes.filter(b=>b.checked).length;document.getElementById('ring').style.strokeDashoffset=String(94.2*(1-n/boxes.length));document.getElementById('count').textContent=n===boxes.length?${JSON.stringify(l('All set — your workspace is ready.', '全部完成 —— 工作区已就绪。'))}:${JSON.stringify(l('{n} of 3 done', '已完成 {n} / 3'))}.replace('{n}',n)}
boxes.forEach(b=>b.addEventListener('change',render))
render()`,
  }
}

function variantC(l: L) {
  return {
    html: `<header><h1>${l('Setup assistant', '设置向导')}</h1><p class="sub">${l('Answer a few questions.', '回答几个问题即可。')}</p></header>
<main id="log" aria-live="polite"></main>
<footer id="replies" class="row" style="padding:0 20px 18px;flex-wrap:wrap;justify-content:flex-start"></footer>`,
    css: `${variantCss}.msg{max-width:82%;padding:9px 12px;border-radius:14px;background:#fff;border:1px solid #ececef}.me{align-self:flex-end;background:#1c1c1f;color:#fff;border-color:#1c1c1f}.chip{background:#fff;border:1px solid #d9d9de;color:#1c1c1f;font-weight:550;padding:8px 12px;border-radius:999px}`,
    js: `const script=[
{q:${JSON.stringify(l('What will you use the canvas for first?', '你最先想用画布做什么？'))},a:[${JSON.stringify(l('Architecture', '架构设计'))},${JSON.stringify(l('User research', '用户研究'))},${JSON.stringify(l('Prototypes', '原型'))}]},
{q:${JSON.stringify(l('Which agent do you use?', '你用哪个 Agent？'))},a:['Claude Code','Cursor',${JSON.stringify(l('Other', '其他'))}]},
{q:${JSON.stringify(l('Done — I set up a board and connected your agent.', '好了 —— 已为你建好画板并连接 Agent。'))},a:[]}]
const log=document.getElementById('log'),replies=document.getElementById('replies')
let i=0
function say(t,me){const d=document.createElement('p');d.className='msg'+(me?' me':'');d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight}
function ask(){say(script[i].q);replies.replaceChildren(...script[i].a.map(a=>{const b=document.createElement('button');b.className='chip';b.textContent=a;b.addEventListener('click',()=>{say(a,true);i++;ask()});return b}))}
ask()`,
  }
}

export const SCENARIO_BUILDERS: Record<'architecture-map' | 'incident-review' | 'interview-synthesis' | 'product-discovery' | 'prototype-wall' | 'literature-review', (l: L) => TemplateStep[]> = {
  'architecture-map': (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Modules', '模块'),
        layout: 'cluster',
        blocks: [
          { type: 'arch-kit.module', title: 'web', text: l('The customer-facing app: sign-in, dashboard, billing pages.', '面向客户的应用：登录、控制台、账单页面。'), group: 'UI', fields: { path: 'apps/web', layer: 'ui', language: 'TypeScript' } },
          { type: 'arch-kit.service', title: 'api-server', text: l('HTTP API; routes requests to the domain modules.', 'HTTP API，把请求分发给领域模块。'), group: 'API', fields: { runtime: 'Node 22', port: '8080', layer: 'api' } },
          { type: 'arch-kit.module', title: 'auth', text: l('Sessions, passwords, SSO.', '会话、密码、单点登录。'), group: l('Domain', '领域'), fields: { path: 'packages/auth', layer: 'domain', language: 'TypeScript' } },
          { type: 'arch-kit.module', title: 'billing', text: l('Plans, invoices and Stripe webhooks.', '套餐、发票和 Stripe 回调。'), group: l('Domain', '领域'), fields: { path: 'packages/billing', layer: 'domain', language: 'TypeScript', status: 'changing' } },
          { type: 'arch-kit.datastore', title: 'Postgres', text: l('Single primary, daily backups.', '单主库，每日备份。'), group: l('Data', '数据'), fields: { engine: 'Postgres 16', holds: l('Users, sessions, invoices', '用户、会话、发票') } },
          { type: 'arch-kit.external', title: 'Stripe', text: l('Payments and invoicing.', '支付与开票。'), group: l('Data', '数据'), fields: { kind: 'service', version: '2026-06' } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Contracts', '接口契约'),
        right_of: l('Modules', '模块'),
        layout: 'stack',
        blocks: [
          { type: 'arch-kit.interface', title: 'POST /api/login', text: l('Returns a session cookie.', '返回会话 Cookie。'), fields: { kind: 'http', signature: '{email, password} → 204 + Set-Cookie', auth: l('None', '无') } },
          { type: 'arch-kit.interface', title: 'GET /api/invoices', text: l('Invoices of the signed-in account.', '当前账号的发票列表。'), fields: { kind: 'http', signature: '→ Invoice[]', auth: 'Session' } },
          { type: 'arch-kit.interface', title: 'invoice.paid', text: l('Stripe webhook; marks the invoice paid.', 'Stripe 回调，把发票标记为已付。'), fields: { kind: 'event', signature: 'Stripe-Signature header', stability: 'experimental' } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Decisions and risks', '决策与风险'),
        right_of: l('Contracts', '接口契约'),
        layout: 'stack',
        blocks: [
          { type: 'arch-kit.decision', title: l('All state in one Postgres', '所有状态放在同一个 Postgres'), text: l('Simple ops now; revisit past 1k req/s.', '现在运维简单；超过 1k 请求/秒再评估。'), fields: { status: 'accepted', date: '2026-03' } },
          { type: 'arch-kit.decision', title: l('Split billing into its own service', '把账单拆成独立服务'), text: l('Deploy billing without touching auth.', '账单发布不再牵动登录。'), fields: { status: 'proposed', date: '2026-09' } },
          { type: 'arch-kit.risk', text: l('Webhooks are not retried', '回调失败不会重试'), fields: { severity: 'high', likelihood: 'medium', mitigation: l('Idempotent handler + retry queue', '幂等处理 + 重试队列') } },
        ],
      },
    },
    {
      tool: 'connect',
      args: {
        connectors: [
          { from: 'web', to: 'POST /api/login' },
          { from: 'api-server', to: 'auth' },
          { from: 'api-server', to: 'billing' },
          { from: 'auth', to: 'Postgres' },
          { from: 'billing', to: 'Stripe' },
          { from: 'billing', to: 'GET /api/invoices' },
          { from: l('Split billing into its own service', '把账单拆成独立服务'), to: 'billing' },
          { from: l('Webhooks are not retried', '回调失败不会重试'), to: 'invoice.paid' },
        ],
      },
    },
  ],

  'incident-review': (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Timeline · login outage', '时间线 · 登录故障'),
        layout: 'timeline',
        blocks: [
          { type: 'arch-kit.event', text: l('Deploy 4812 ships a new session cache', '发布 4812 上线了新的会话缓存'), date: '14:02', fields: { time: '2026-09-12 14:02', phase: 'trigger', actor: 'CI' } },
          { type: 'arch-kit.event', text: l('Login errors climb to 18%', '登录错误率升到 18%'), date: '14:09', fields: { time: '2026-09-12 14:09', phase: 'impact' } },
          { type: 'arch-kit.event', text: l('Latency alert pages on-call', '延迟告警呼叫值班'), date: '14:15', fields: { time: '2026-09-12 14:15', phase: 'detect', actor: l('On-call', '值班') } },
          { type: 'arch-kit.event', text: l('Rollback of deploy 4812', '回滚发布 4812'), date: '14:24', fields: { time: '2026-09-12 14:24', phase: 'respond', actor: l('On-call', '值班') } },
          { type: 'arch-kit.event', text: l('Errors back under 0.5%', '错误率回落到 0.5% 以下'), date: '14:31', fields: { time: '2026-09-12 14:31', phase: 'recover' } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Contributing factors', '促成因素'),
        below: l('Timeline · login outage', '时间线 · 登录故障'),
        layout: 'row',
        blocks: [
          { type: 'arch-kit.risk', text: l('Cache keys shared across tenants', '缓存键在租户之间共享'), fields: { severity: 'high', likelihood: 'low' } },
          { type: 'arch-kit.risk', text: l('No canary for auth changes', '登录相关改动没有金丝雀发布'), fields: { severity: 'medium', likelihood: 'medium' } },
          { type: 'arch-kit.risk', text: l('Alerts watch latency, not errors', '告警只看延迟，不看错误率'), fields: { severity: 'medium', likelihood: 'high' } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Follow-ups', '后续行动'),
        right_of: l('Contributing factors', '促成因素'),
        layout: 'stack',
        blocks: [
          { type: 'arch-kit.decision', title: l('Canary every auth deploy', '登录改动一律金丝雀发布'), text: l('5% of traffic for 15 minutes.', '5% 流量观察 15 分钟。'), fields: { status: 'proposed', deciders: l('Platform team', '平台组') } },
          { type: 'arch-kit.decision', title: l('Page on error rate', '按错误率告警'), text: l('Alert at 2% login errors over 3 minutes.', '3 分钟内登录错误率超过 2% 即告警。'), fields: { status: 'proposed', deciders: l('On-call', '值班') } },
        ],
      },
    },
    {
      tool: 'connect',
      args: {
        connectors: [
          { from: l('No canary for auth changes', '登录相关改动没有金丝雀发布'), to: l('Canary every auth deploy', '登录改动一律金丝雀发布') },
          { from: l('Alerts watch latency, not errors', '告警只看延迟，不看错误率'), to: l('Page on error rate', '按错误率告警') },
        ],
      },
    },
  ],

  'interview-synthesis': (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Interviews', '访谈'),
        layout: 'row',
        blocks: [
          { type: 'research-kit.interview', title: l('P1 · Staff engineer', 'P1 · 资深工程师'), text: l('Runs three agents a day; hates re-explaining context.', '每天用三个 Agent；最烦反复交代上下文。'), fields: { participant: 'P1', role: l('Staff engineer', '资深工程师'), date: '2026-09-08', segment: l('Agent power user', 'Agent 重度用户') } },
          { type: 'research-kit.interview', title: l('P2 · Product designer', 'P2 · 产品设计师'), text: l('Reviews AI output before every handoff.', '每次交付前都要审一遍 AI 产出。'), fields: { participant: 'P2', role: l('Product designer', '产品设计师'), date: '2026-09-09', segment: l('Design lead', '设计负责人') } },
          { type: 'research-kit.interview', title: l('P3 · Founder', 'P3 · 创始人'), text: l('Wants decisions and their reasons in one place.', '希望决策和理由集中在一处。'), fields: { participant: 'P3', role: l('Founder', '创始人'), date: '2026-09-10', segment: l('Small team', '小团队') } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Quotes by theme', '按主题的原话'),
        below: l('Interviews', '访谈'),
        layout: 'cluster',
        blocks: [
          { type: 'research-kit.quote', text: l('“Every new chat, I paste the same architecture notes.”', '“每开一个新对话，我都要贴一遍同样的架构说明。”'), group: l('Lost context', '上下文丢失'), fields: { participant: 'P1', source: l('Interview', '访谈'), ref: 'p1.md:14', theme: l('Lost context', '上下文丢失') } },
          { type: 'research-kit.quote', text: l('“The agent forgets what we decided yesterday.”', '“Agent 记不住我们昨天定下的事。”'), group: l('Lost context', '上下文丢失'), fields: { participant: 'P3', source: l('Interview', '访谈'), ref: 'p3.md:22', theme: l('Lost context', '上下文丢失') } },
          { type: 'research-kit.quote', text: l('“I keep a doc just to brief the AI.”', '“我专门留了一份文档给 AI 交代背景。”'), group: l('Lost context', '上下文丢失'), fields: { participant: 'P2', source: l('Interview', '访谈'), ref: 'p2.md:31', theme: l('Lost context', '上下文丢失') } },
          { type: 'research-kit.quote', text: l('“I read every line before it goes to the team.”', '“发给团队前我每一行都要看。”'), group: l('Review burden', '审阅负担'), fields: { participant: 'P2', source: l('Interview', '访谈'), ref: 'p2.md:9', theme: l('Review burden', '审阅负担'), sentiment: 'negative' } },
          { type: 'research-kit.quote', text: l('“Big diffs from an agent — I just skim and hope.”', '“Agent 一改就是一大片，我只能扫一眼碰运气。”'), group: l('Review burden', '审阅负担'), fields: { participant: 'P1', source: l('Interview', '访谈'), ref: 'p1.md:40', theme: l('Review burden', '审阅负担'), sentiment: 'negative' } },
          { type: 'research-kit.quote', text: l('“If I could accept parts of it, I would use it more.”', '“要是能只接受一部分，我会用得更多。”'), group: l('Review burden', '审阅负担'), fields: { participant: 'P3', source: l('Interview', '访谈'), ref: 'p3.md:47', theme: l('Review burden', '审阅负担') } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Insights', '洞察'),
        right_of: l('Quotes by theme', '按主题的原话'),
        layout: 'stack',
        blocks: [
          { type: 'research-kit.insight', title: l('Context doesn’t survive between sessions', '上下文在会话之间留不住'), text: l('People rebuild the same briefing by hand every day.', '大家每天都在手动重建同一份背景说明。'), fields: { theme: l('Lost context', '上下文丢失'), confidence: 'high', evidence: 3, participants: 3 } },
          { type: 'research-kit.insight', title: l('Review is the bottleneck, not generation', '瓶颈在审阅，不在生成'), text: l('All-or-nothing changes make people skim.', '要么全收要么全拒，逼得人只能草草扫过。'), fields: { theme: l('Review burden', '审阅负担'), confidence: 'high', evidence: 3, participants: 3 } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Opportunities', '机会点'),
        right_of: l('Insights', '洞察'),
        layout: 'stack',
        blocks: [
          { type: 'research-kit.opportunity', title: l('HMW keep shared context on the board?', '怎样把共享上下文留在画板上？'), fields: { impact: 'high', effort: 'medium' } },
          { type: 'research-kit.opportunity', title: l('HMW review agent work item by item?', '怎样逐条审阅 Agent 的工作？'), fields: { impact: 'high', effort: 'low' } },
          { kind: 'card', type: 'hypothesis', title: l('Item-level review doubles acceptance', '逐条审阅能让接受率翻倍'), text: l('Compare accepted items before and after.', '对比上线前后被接受的条目数。'), fields: { status: 'unverified', confidence: 'medium' } },
        ],
      },
    },
    {
      tool: 'connect',
      args: {
        connectors: [
          { from: l('“Every new chat, I paste the same architecture notes.”', '“每开一个新对话，我都要贴一遍同样的架构说明。”'), to: l('Context doesn’t survive between sessions', '上下文在会话之间留不住') },
          { from: l('“If I could accept parts of it, I would use it more.”', '“要是能只接受一部分，我会用得更多。”'), to: l('Review is the bottleneck, not generation', '瓶颈在审阅，不在生成') },
          { from: l('Context doesn’t survive between sessions', '上下文在会话之间留不住'), to: l('HMW keep shared context on the board?', '怎样把共享上下文留在画板上？') },
          { from: l('Review is the bottleneck, not generation', '瓶颈在审阅，不在生成'), to: l('HMW review agent work item by item?', '怎样逐条审阅 Agent 的工作？') },
        ],
      },
    },
  ],

  'product-discovery': (l) => {
    const feature = (competitor: string, capability: string, status: 'has' | 'partial' | 'missing', note: string) => ({
      type: 'product-kit.feature',
      text: note,
      row: capability,
      col: competitor,
      fields: { competitor, capability, status },
    })
    const cap = [l('Local files', '本地文件'), l('Agent review', 'Agent 审阅'), l('Templates', '模板')]
    return [
      {
        tool: 'create_blocks',
        args: {
          frame: l('Competitor matrix', '竞品矩阵'),
          layout: 'matrix',
          blocks: [
            feature(l('Whiteboard A', '白板 A'), cap[0], 'missing', l('Cloud only', '仅云端')),
            feature(l('Whiteboard A', '白板 A'), cap[1], 'partial', l('Whole-board undo only', '只能整板撤销')),
            feature(l('Whiteboard A', '白板 A'), cap[2], 'has', l('Large template library', '模板库丰富')),
            feature(l('Canvas SDK B', '画布 SDK B'), cap[0], 'has', l('Bring your own storage', '存储自行接入')),
            feature(l('Canvas SDK B', '画布 SDK B'), cap[1], 'missing', l('No agent API', '没有 Agent 接口')),
            feature(l('Canvas SDK B', '画布 SDK B'), cap[2], 'missing', l('Build your own', '需要自己搭')),
            feature(l('Notes app C', '笔记应用 C'), cap[0], 'has', l('Markdown files on disk', '本地 Markdown 文件')),
            feature(l('Notes app C', '笔记应用 C'), cap[1], 'missing', l('AI edits apply directly', 'AI 修改直接生效')),
            feature(l('Notes app C', '笔记应用 C'), cap[2], 'partial', l('Page templates only', '只有页面模板')),
          ],
        },
      },
      {
        tool: 'create_blocks',
        args: {
          frame: l('Opportunities', '机会'),
          right_of: l('Competitor matrix', '竞品矩阵'),
          layout: 'stack',
          blocks: [
            { type: 'product-kit.opportunity', title: l('“I can’t trust what the agent changed”', '“我没法信任 Agent 改了什么”'), text: l('Nobody offers item-level review.', '没有产品支持逐条审阅。'), fields: { segment: l('Teams using coding agents', '使用编码 Agent 的团队'), evidence: l('6 of 8 interviews', '8 场访谈中 6 场提到'), size: 'large' } },
            { type: 'product-kit.opportunity', title: l('“My boards live in someone’s cloud”', '“我的画板都在别人的云上”'), text: l('Sensitive work stays off whiteboards.', '敏感工作不敢放上白板。'), fields: { segment: l('Security-minded teams', '重视安全的团队'), evidence: l('4 of 8 interviews', '8 场访谈中 4 场提到'), size: 'medium' } },
          ],
        },
      },
      {
        tool: 'create_blocks',
        args: {
          frame: l('Solutions · priority', '方案 · 优先级'),
          right_of: l('Opportunities', '机会'),
          layout: 'matrix',
          blocks: [
            { type: 'product-kit.solution', title: l('Change sets with per-item accept', '可逐条接受的变更集'), row: 'high', col: 'low', fields: { impact: 'high', effort: 'low', confidence: 'high', status: 'committed' } },
            { type: 'product-kit.solution', title: l('Local-first files', '本地优先的文件'), row: 'high', col: 'medium', fields: { impact: 'high', effort: 'medium', confidence: 'medium' } },
            { type: 'product-kit.solution', title: l('Agent activity replay', 'Agent 操作回放'), row: 'medium', col: 'high', fields: { impact: 'medium', effort: 'high', confidence: 'low' } },
          ],
        },
      },
      {
        tool: 'create_blocks',
        args: {
          frame: l('Experiments', '实验'),
          below: l('Opportunities', '机会'),
          layout: 'row',
          blocks: [
            { type: 'product-kit.experiment', title: l('Review prototype with 5 teams', '找 5 个团队试用审阅原型'), fields: { assumption: l('People review more when they can pick items', '能挑着接受时，大家会审得更多'), method: l('Clickable prototype', '可点击原型'), status: 'running' } },
            { type: 'product-kit.metric', text: l('Accepted agent items / week', '每周被接受的 Agent 条目'), fields: { baseline: '40', target: '100', kind: 'north star' } },
            { type: 'product-kit.metric', text: l('Rejected change sets', '被整组拒绝的变更集'), fields: { baseline: '35%', target: '15%', kind: 'guardrail' } },
          ],
        },
      },
      {
        tool: 'create_blocks',
        args: {
          frame: l('PRD · requirements', 'PRD · 需求'),
          right_of: l('Experiments', '实验'),
          layout: 'cluster',
          blocks: [
            { type: 'product-kit.requirement', title: l('Accept or reject each item', '每一条都能接受或拒绝'), group: 'must', fields: { priority: 'must', area: l('Review', '审阅') } },
            { type: 'product-kit.requirement', title: l('Keyboard review (J/K, A/R)', '键盘审阅（J/K、A/R）'), group: 'must', fields: { priority: 'must', area: l('Review', '审阅') } },
            { type: 'product-kit.requirement', title: l('Reason on reject', '拒绝时填写理由'), group: 'should', fields: { priority: 'should', area: l('Review', '审阅') } },
            { type: 'product-kit.requirement', title: l('Auto-accept per agent', '按 Agent 自动接受'), group: 'could', fields: { priority: 'could', area: l('Trust', '信任') } },
          ],
        },
      },
      {
        tool: 'connect',
        args: {
          connectors: [
            { from: l('“I can’t trust what the agent changed”', '“我没法信任 Agent 改了什么”'), to: l('Change sets with per-item accept', '可逐条接受的变更集') },
            { from: l('“I can’t trust what the agent changed”', '“我没法信任 Agent 改了什么”'), to: l('Agent activity replay', 'Agent 操作回放') },
            { from: l('“My boards live in someone’s cloud”', '“我的画板都在别人的云上”'), to: l('Local-first files', '本地优先的文件') },
            { from: l('Change sets with per-item accept', '可逐条接受的变更集'), to: l('Review prototype with 5 teams', '找 5 个团队试用审阅原型') },
          ],
        },
      },
    ]
  },

  'prototype-wall': (l) => {
    const variants = [
      { label: 'A', name: l('Guided wizard', '分步向导'), approach: l('Three steps with a progress bar', '三步走，带进度条'), why: l('Lowest effort per screen; clear sense of progress.', '每屏负担最小，进度一目了然。'), code: variantA(l) },
      { label: 'B', name: l('Checklist', '任务清单'), approach: l('One page, any order', '一页完成，顺序随意'), why: l('Everything visible; power users finish fastest.', '全部可见，熟手最快完成。'), code: variantB(l) },
      { label: 'C', name: l('Chat setup', '对话式设置'), approach: l('Questions with quick replies', '一问一答，快捷回复'), why: l('Feels personal; adapts to the answers.', '更有人情味，能按回答调整。'), code: variantC(l) },
    ]
    const frame = (v: (typeof variants)[number]) => `${v.label} · ${v.name}`
    const steps: TemplateStep[] = [
      {
        tool: 'create_blocks',
        args: {
          frame: l('Brief', '需求简报'),
          layout: 'stack',
          blocks: [
            { type: 'prototype-kit.brief', title: l('First-run setup', '首次设置流程'), text: l('New users should reach a working board with their agent connected, without reading docs.', '新用户不看文档，也能进入可用的画板并接好 Agent。'), fields: { audience: l('First-time users', '首次使用的用户'), success: l('Done in under 2 minutes', '2 分钟内完成'), constraints: l('No new backend', '不新增后端') } },
          ],
        },
      },
    ]
    variants.forEach((v, i) => {
      steps.push({
        tool: 'create_blocks',
        args: {
          frame: frame(v),
          right_of: i ? frame(variants[i - 1]) : l('Brief', '需求简报'),
          layout: 'stack',
          blocks: [{ type: 'prototype-kit.variant', title: v.name, text: v.why, fields: { label: v.label, approach: v.approach, round: 1 } }],
        },
      })
      steps.push({ tool: 'create_snippet', args: { inside: frame(v), title: frame(v), width: 360, height: 480, ...v.code } })
    })
    steps.push(
      {
        tool: 'create_blocks',
        args: {
          frame: l('Feedback', '评审意见'),
          below: frame(variants[1]),
          layout: 'cluster',
          blocks: [
            { type: 'prototype-kit.feedback', text: l('Progress bar is reassuring', '进度条让人安心'), group: 'A', fields: { variant: 'A', verdict: 'keep', author: l('Design review', '设计评审') } },
            { type: 'prototype-kit.feedback', text: l('Fastest to finish', '完成得最快'), group: 'B', fields: { variant: 'B', verdict: 'keep', author: l('Usability test', '可用性测试') } },
            { type: 'prototype-kit.feedback', text: l('Slow when you know what you want', '明确目标时反而慢'), group: 'C', fields: { variant: 'C', verdict: 'change', author: l('Usability test', '可用性测试') } },
          ],
        },
      },
      {
        tool: 'create_blocks',
        args: {
          frame: l('Decision', '决定'),
          right_of: l('Feedback', '评审意见'),
          layout: 'stack',
          blocks: [{ type: 'prototype-kit.decision', title: l('Checklist, with the wizard’s progress bar', '用任务清单，加上向导的进度条'), text: l('Round 2 merges B and A.', '第 2 轮合并 B 与 A。'), fields: { chosen: 'B + A', status: 'proposed' } }],
        },
      },
      {
        tool: 'connect',
        args: {
          connectors: [
            { from: l('First-run setup', '首次设置流程'), to: variants[0].name },
            { from: l('Slow when you know what you want', '明确目标时反而慢'), to: l('Checklist, with the wizard’s progress bar', '用任务清单，加上向导的进度条') },
          ],
        },
      },
    )
    return steps
  },

  'literature-review': (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Research questions', '研究问题'),
        layout: 'row',
        blocks: [
          { type: 'lit-kit.question', title: l('Do AI coding assistants make developers faster?', 'AI 编程助手能让开发更快吗？'), fields: { rq: 'RQ1', status: 'contested' } },
          { type: 'lit-kit.question', title: l('How do developers work with them?', '开发者是怎样使用它们的？'), fields: { rq: 'RQ2', status: 'partly answered' } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Papers', '文献'),
        below: l('Research questions', '研究问题'),
        layout: 'timeline',
        blocks: [
          { type: 'lit-kit.paper', title: 'Grounded Copilot: How Programmers Interact with Code-Generating Models', text: l('Two interaction modes: acceleration and exploration.', '两种交互模式：加速与探索。'), date: '2023', fields: { authors: 'Barke, James, Polikarpova', year: '2023', venue: 'OOPSLA', method: 'field study', cite: 'barke2023' } },
          { type: 'lit-kit.paper', title: 'The Impact of AI on Developer Productivity: Evidence from GitHub Copilot', text: l('Controlled experiment with GitHub Copilot on one task.', '针对单个任务的 GitHub Copilot 对照实验。'), date: '2023', fields: { authors: 'Peng et al.', year: '2023', venue: 'arXiv', method: 'experiment', cite: 'peng2023' } },
          { type: 'lit-kit.paper', title: 'Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity', text: l('Randomized trial on real issues in mature repositories.', '在成熟仓库的真实任务上做的随机对照试验。'), date: '2025', fields: { authors: 'METR', year: '2025', venue: 'arXiv', method: 'experiment', cite: 'metr2025' } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Argument map', '论证地图'),
        right_of: l('Papers', '文献'),
        layout: 'matrix',
        blocks: [
          { type: 'lit-kit.evidence', text: l('Copilot group finished the task 55.8% faster', 'Copilot 组完成任务快 55.8%'), row: 'RQ1', col: l('Evidence', '证据'), fields: { cite: 'peng2023', loc: 'Abstract', strength: 'strong', rq: 'RQ1' } },
          { type: 'lit-kit.claim', title: l('Speed-ups hold on small, well-specified tasks', '小而明确的任务上确有提速'), row: 'RQ1', col: l('Claims', '论点'), fields: { rq: 'RQ1', consensus: 'contested', sources: 2 } },
          { type: 'lit-kit.counter', text: l('Experienced developers took 19% longer with AI', '资深开发者用 AI 反而多花 19% 时间'), row: 'RQ1', col: l('Counter-evidence', '反驳'), fields: { cite: 'metr2025', loc: 'Abstract', kind: 'opposing result', rq: 'RQ1' } },
          { type: 'lit-kit.gap', text: l('Few studies of multi-file agent tasks', '很少有研究覆盖跨文件的 Agent 任务'), row: 'RQ1', col: l('Gaps', '空白'), fields: { rq: 'RQ1', priority: 'high' } },
          { type: 'lit-kit.evidence', text: l('Acceleration when they know what to write; exploration when unsure', '知道要写什么时加速，不确定时探索'), row: 'RQ2', col: l('Evidence', '证据'), fields: { cite: 'barke2023', loc: 'Abstract', strength: 'moderate', rq: 'RQ2' } },
          { type: 'lit-kit.claim', title: l('Developers alternate between accelerating and exploring', '开发者在“加速”和“探索”之间切换'), row: 'RQ2', col: l('Claims', '论点'), fields: { rq: 'RQ2', consensus: 'moderate', sources: 1 } },
        ],
      },
    },
    {
      tool: 'connect',
      args: {
        connectors: [
          { from: l('Copilot group finished the task 55.8% faster', 'Copilot 组完成任务快 55.8%'), to: l('Speed-ups hold on small, well-specified tasks', '小而明确的任务上确有提速') },
          { from: l('Experienced developers took 19% longer with AI', '资深开发者用 AI 反而多花 19% 时间'), to: l('Speed-ups hold on small, well-specified tasks', '小而明确的任务上确有提速') },
          { from: l('Acceleration when they know what to write; exploration when unsure', '知道要写什么时加速，不确定时探索'), to: l('Developers alternate between accelerating and exploring', '开发者在“加速”和“探索”之间切换') },
        ],
      },
    },
  ],
}
