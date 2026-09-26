import type { Site } from '@/config/site'
import type { ScenariosDict } from './scenarios-en'

export default function scenariosZh(s: Site): ScenariosDict {
  return {
    eyebrow: '场景',
    title: 'Agent 本来就在做的事，摊在你看得见、查得了的地方。',
    lede: '每个场景都是一个 Skill：块类型、布局，外加一套 Agent 照着走的工作流。阅读、提取、整理交给 Agent；你审阅画板，决定什么留下。',
    lead: '从这里开始',
    open: '看看怎么做',
    all: '全部场景',
    page: {
      metaTitle: '用 Claude Code 或 Cursor 做{title}',
      problem: '问题在哪',
      how: 'Agent 怎么做',
      howLede: '工作流写在 Skill 的 SKILL.md 里，每个 Agent 都按同样的步骤走，并在关键处停下来等你。',
      agent: 'Agent',
      you: '你',
      blocks: '画板上的块',
      blocksLede: 'Skill 提供的语义块，各有字段、颜色和卡片布局。Agent 负责填写，每个字段你都能改。',
      shot: '画板长这样',
      illustration: '示意图',
      illustrationNote: '这个 Skill 产出的画板示意，用产品自己的设计令牌绘制。',
      tryIt: '动手试试',
      tryLede: '三步，大约两分钟。你需要 Claude Code 或 Cursor。',
      install: {
        title: '安装并连接',
        body: `下载 ${s.name}，打开「帮助 › 连接 Agent」。确认后，它会把 MCP 服务加到 Claude Code 和 Cursor 里。`,
        cta: '下载',
      },
      enable: {
        title: '启用 Skill',
        body: '打开一块画板，点右上角的拼图图标（Skill），启用 {skill}。也可以在终端里：',
      },
      paste: {
        title: '把这段话粘贴到 Claude Code',
        body: '在需要 Agent 阅读的文件夹里运行。它会写入一个变更集，然后等你审阅。',
      },
      promptTitle: '提示词',
      others: '其他场景',
      breadcrumb: '面包屑导航',
    },
    items: {
      architecture: {
        title: '架构设计与代码理解',
        short: '架构与代码',
        tagline: '动代码之前，先把代码库画出来。',
        summary: 'Agent 读仓库，把模块、调用关系和接口契约画到画板上。你修正这张图，它再照着图去实现。',
        problem: {
          body: '新接手的仓库、一次重构、一场故障复盘。系统的形状散落在几十个目录和少数几个人的脑子里，一大段生成的文字也看不出来。你需要把模块、调用和契约并排摆开——并在任何代码改动之前，先把图纠正过来。',
          points: ['生成的总结是线性的，系统不是', '手画的架构图，下一次合并后就过时', 'Agent 理解错了，往往要等看到它写的代码才发现'],
        },
        steps: [
          { title: '读仓库', body: 'Agent 用它自己的工具走读代码：入口、依赖、路由、数据结构和配置。', you: false },
          { title: '画出模块与调用', body: '模块、服务、数据存储和外部依赖变成语义块，用调用关系连起来，按流程布局。', you: false },
          { title: '标注接口契约', body: '接口、请求体和事件标在连线上；待定的决策记成 ADR 块，风险钉在它所在的位置。', you: false },
          { title: '审阅这张图', body: '所有内容作为一个变更集到达。拒绝一条画错的连线并写明原因，或在模块上留批注——Agent 读到后重画。', you: true },
          { title: '照图实现', body: '图对了，再让 Agent 按图实现。遇到故障复盘，这个 Skill 还附带复盘时间线模板。', you: false },
        ],
        blocks: [
          { name: '模块', body: '职责清楚的一个包或目录。' },
          { name: '服务', body: '会运行的东西：进程、Worker 或函数。' },
          { name: '接口契约', body: '接口、事件或 API，以及它的数据格式。' },
          { name: '数据存储', body: '数据库、队列、缓存或对象存储。' },
          { name: '外部依赖', body: '系统调用的第三方 API 或 SaaS。' },
          { name: '决策（ADR）', body: '背景、所做的选择和当前状态。' },
          { name: '风险', body: '可能出什么问题、有多严重、谁来负责。' },
        ],
        board: {
          title: 'checkout-service — 架构',
          frames: [
            {
              title: '模块与调用',
              items: [
                { block: 0, title: 'api/routes', meta: 'HTTP 入口 · 14 个路由' },
                { block: 1, title: 'PaymentService', meta: '扣款、退款' },
                { block: 3, title: 'ledger', meta: 'Postgres · 只追加' },
                { block: 4, title: 'Stripe API', meta: '扣款 + Webhook' },
              ],
            },
            {
              title: '契约与风险',
              items: [
                { block: 2, title: 'POST /v1/charges', meta: '必须带 Idempotency-Key' },
                { block: 5, title: 'ADR-7：事件走 outbox', meta: '已采纳' },
                { block: 6, title: 'Webhook 重试导致重复记账', meta: '高 · 支付组' },
              ],
            },
          ],
        },
        prompt: `使用 ${s.name} 的 arch-kit skill（get_skill "arch-kit"）。\n读这个仓库，把它画到画板上：模块、服务、数据存储和外部依赖，它们之间的调用关系，以及每条连线上的接口契约。\n把风险和待定决策标成 ADR 块。\n全部放进一个变更集，在我审阅之前不要改任何代码。`,
        shotAlt: '架构画板：模块、服务、数据存储和 Stripe 由调用关系相连，旁边是接口契约、一条 ADR 和一个风险',
      },
      'user-research': {
        title: '用户研究综合',
        short: '用户研究',
        tagline: '从访谈稿到洞察，每一条都能追溯。',
        summary: 'Agent 摘出用户原话并标明出处，做亲和聚类，起草洞察。你修正聚类；每条结论都连着是谁说的。',
        problem: {
          body: '六场访谈，四十页笔记。关键的原话埋在里面，亲和聚类要花一整天；等报告做完，已经没人说得清哪句话出自哪位受访者。',
          points: ['综合太慢，于是常被跳过', '总结丢掉了背后的证据', '聚类结果取决于谁来贴便签'],
        },
        steps: [
          { title: '读访谈稿', body: 'Agent 从你指定的文件夹里读取访谈笔记或逐字稿。', you: false },
          { title: '摘原话并标出处', body: '原话变成「用户原话」块，带受访者和时间戳；每场访谈旁边各有一个「访谈」块。', you: false },
          { title: '亲和聚类', body: '用聚类布局把原话按主题分组，相近的证据放在一起。', you: false },
          { title: '提炼洞察与机会点', body: '每条洞察都连着支撑它的原话；机会点和假设从洞察中长出来。', you: false },
          { title: '修正综合结果', body: '挪一条原话、合并两个主题、拒绝一条说过头的洞察。Agent 会读你写的原因。', you: true },
          { title: '导出研究报告', body: '画板导出为 Markdown 研究报告，按主题组织，每句原话都有引用。', you: false },
        ],
        blocks: [
          { name: '访谈', body: '一场访谈：受访者、角色、日期。' },
          { name: '用户原话', body: '原话、谁说的、什么时候说的。' },
          { name: '洞察', body: '证据意味着什么，把握有多大。' },
          { name: '机会点', body: '值得解决的需求，连着洞察。' },
          { name: '假设', body: '可以验证的判断，带状态。' },
        ],
        board: {
          title: '新手引导访谈 — 综合',
          frames: [
            {
              title: '证据',
              items: [
                { block: 0, title: 'P3 · 产品设计师', meta: '45 分钟 · 9 月 12 日' },
                { block: 1, title: '“面对空白画布，我就不知道从哪下手。”', meta: 'P3 · 12:40' },
                { block: 1, title: '“我是手动把笔记搬进 PPT 的。”', meta: 'P5 · 31:05' },
              ],
            },
            {
              title: '综合',
              items: [
                { block: 2, title: '开头是最难的一步', meta: '6 人中有 4 人' },
                { block: 3, title: '从需求说明直接生成画板', meta: '关联 3 条原话' },
                { block: 4, title: '起步画板能让首张便签的时间减半', meta: '未验证' },
              ],
            },
          ],
        },
        prompt: `使用 ${s.name} 的 research-kit skill（get_skill "research-kit"）。\n读 ./interviews 里的访谈稿，在画板上做综合：摘出用户原话并标明受访者和时间戳，按主题聚类，再加上洞察和机会点，并连到支撑它们的原话。\n放进一个变更集，方便我审阅。`,
        shotAlt: '研究画板：左边是访谈和用户原话，右边是洞察、机会点和假设',
      },
      'product-discovery': {
        title: '产品探索与方案设计',
        short: '产品探索',
        tagline: '从拥挤的市场，到一份 PRD 大纲。',
        summary: 'Agent 搭好竞品矩阵、机会-方案树和优先级矩阵。拍板的是你；最后它导出 PRD 大纲。',
        problem: {
          body: '竞品调研在一份文档里，机会点在另一份，路线图又在第三份。把它们串起来的推理——为什么押这个、不押那个——在标签页之间丢掉了。',
          points: ['市场扫描几周就过时', '优先级靠争论，而不是摆出来看', 'PRD 总是从一张白纸开始'],
        },
        steps: [
          { title: '画出市场', body: '竞品卡片带上细分市场、定位和价格，排成定位矩阵。', you: false },
          { title: '长出机会-方案树', body: '从市场和你的笔记里提炼机会点，下面挂候选方案和实验。', you: false },
          { title: '排优先级', body: '方案放进「影响 × 投入」矩阵，每个都对应一个指标。', you: false },
          { title: '由你拍板', body: '接受、拒绝或重新排序。你在卡片上的批注就是 Agent 的下一份任务说明。', you: true },
          { title: '导出 PRD 大纲', body: '选定的方案连同需求和指标，导出为 Markdown PRD 大纲。', you: false },
        ],
        blocks: [
          { name: '竞品', body: '细分市场、定位、价格、链接。' },
          { name: '机会', body: '一个用户需求，以及覆盖面。' },
          { name: '方案', body: '回应某个机会的一种做法。' },
          { name: '实验', body: '怎么验证，要多久。' },
          { name: '指标', body: '成功时会变化的数字，以及目标值。' },
          { name: '需求', body: '必须有还是最好有，写进 PRD。' },
        ],
        board: {
          title: '团队白板 — 产品探索',
          frames: [
            {
              title: '市场',
              items: [
                { block: 0, title: 'FigJam', meta: '主流 · $5/席位' },
                { block: 0, title: 'Miro', meta: '高端 · 企业' },
                { block: 1, title: '现在的白板 Agent 写不进去', meta: '覆盖面大' },
              ],
            },
            {
              title: '押注',
              items: [
                { block: 2, title: '原生支持 MCP 的画布', meta: '回应 2 个机会' },
                { block: 3, title: '和 5 个团队做人工陪跑测试', meta: '2 周' },
                { block: 4, title: '含 Agent 编辑的画板数', meta: '目标：每队每周 3 块' },
              ],
            },
          ],
        },
        prompt: `使用 ${s.name} 的 product-kit skill（get_skill "product-kit"）。\n在画板上把团队白板的主要竞品排成定位矩阵，据此搭一棵机会-方案树，再把方案放进「影响 × 投入」矩阵，每个方案配一个指标。\n放进一个变更集；我审阅之后，为我保留的方案导出 PRD 大纲。`,
        shotAlt: '产品探索画板：一个 Frame 里是竞品卡片和机会点，另一个里是方案、实验和指标',
      },
      'prototype-wall': {
        title: 'AI 原型墙',
        short: '原型墙',
        tagline: '几个能用的方向，并排摆开。',
        summary: 'Agent 在画板上并排生成几个可交互的 HTML 方案。你就地批注；它反复迭代，直到你选定一个。',
        problem: {
          body: '在对话里让 Agent 做界面，一次只能得到一个答案。要比较几个方向，就得截图、开标签页、来回找上下文——反馈也离它针对的东西很远。',
          points: ['一次一个方案，看不出取舍', '反馈和设计本身是分开的', '做了决定，却没留下痕迹'],
        },
        steps: [
          { title: '并排生成方案', body: 'Agent 写出几个可交互的 HTML/CSS/JS 片段，排成一行——每个都在断网的沙箱里运行。', you: false },
          { title: '就地批注', body: '双击试用某个方案，然后把评审意见和批注钉在它旁边。', you: true },
          { title: '迭代', body: 'Agent 读你的意见并修改片段；每次改动都以可审阅的差异呈现。', you: false },
          { title: '选定方案', body: '用一个「决策」块记下选择，连到胜出的方案和背后的意见。', you: true },
        ],
        blocks: [
          { name: '方案', body: '可交互的网页片段，就地运行。' },
          { name: '评审意见', body: '钉在某个方案上的反馈。' },
          { name: '决策', body: '选了什么，为什么。' },
        ],
        board: {
          title: '定价页 — 原型墙',
          frames: [
            {
              title: '方案',
              items: [
                { block: 0, title: 'A · 三档套餐', meta: 'HTML 片段 · 就地运行' },
                { block: 0, title: 'B · 用量滑块', meta: 'HTML 片段' },
                { block: 0, title: 'C · 计算器优先', meta: 'HTML 片段' },
              ],
            },
            {
              title: '评审',
              items: [
                { block: 1, title: '滑块把免费档藏起来了', meta: '针对 B' },
                { block: 1, title: '对团队用户最清楚', meta: '针对 C' },
                { block: 2, title: '上线 C，保留 A 的免费档', meta: '9 月 26 日决定' },
              ],
            },
          ],
        },
        prompt: `使用 ${s.name} 的 prototype-kit skill（get_skill "prototype-kit"）。\n在画板上并排做三个可交互的定价页方案（网页片段）：三档套餐、用量滑块、计算器优先。\n等我的评审意见，再修改我批注过的方案。`,
        shotAlt: '原型墙：三个定价页方案排成一行，旁边是评审意见和一条决策',
      },
      'literature-review': {
        title: '文献综述',
        short: '文献综述',
        tagline: '一张论证地图，每个论点都有出处。',
        summary: 'Agent 读论文，抽出论点和证据并标注引用，搭成论证地图。你来核对；它导出综述大纲。',
        problem: {
          body: '二十篇 PDF，高亮散在三个应用里，初稿全凭记忆引用。争论的结构——谁主张什么、依据哪些证据、谁持反对意见——从来没有出现在同一页上。',
          points: ['笔记丢了页码', '反面证据很容易漏掉', '大纲看不出论证的结构'],
        },
        steps: [
          { title: '读论文', body: 'Agent 读取你指定文件夹里的 PDF 或笔记。', you: false },
          { title: '抽取论点与证据', body: '论点、证据和反驳各成一块，都标明来自哪篇论文的哪一页或哪一节。', you: false },
          { title: '构建论证地图', body: '证据支持或反驳论点，论点回应你的研究问题——都用带关系的连线表示。', you: false },
          { title: '核对地图', body: '拒绝论文里其实没有的论点，补上漏掉的反驳。你接受之前，一切都不算数。', you: true },
          { title: '导出大纲', body: '地图导出为 Markdown 综述大纲，按研究问题分组，附带引用。', you: false },
        ],
        blocks: [
          { name: '文献', body: '作者、年份、发表处、研究方法。' },
          { name: '论点', body: '某篇论文主张的观点。' },
          { name: '证据', body: '一项结果，附页码或章节。' },
          { name: '反驳', body: '反对的声音，以及出处。' },
          { name: '研究问题', body: '这篇综述要回答的问题。' },
        ],
        board: {
          title: '远程结对编程 — 综述',
          frames: [
            {
              title: '来源',
              items: [
                { block: 0, title: 'Smith et al. 2024', meta: 'CSCW · n = 48' },
                { block: 0, title: 'Chen & Ruiz 2025', meta: 'ICSE · 实地研究' },
                { block: 4, title: '异步评审会影响学习吗？', meta: 'RQ2' },
              ],
            },
            {
              title: '论证',
              items: [
                { block: 1, title: '远程结对不会提高缺陷率', meta: '2 篇论文' },
                { block: 2, title: '缺陷 −3%，95% 置信区间', meta: 'Smith 2024，第 7 页' },
                { block: 3, title: '样本偏资深工程师', meta: 'Chen 2025，§5' },
              ],
            },
          ],
        },
        prompt: `使用 ${s.name} 的 lit-kit skill（get_skill "lit-kit"）。\n读 ./papers 里的论文，在画板上搭一张论证地图：各个论点、支持和反对它的证据（标明页码或章节），以及它们回应的研究问题。\n放进一个变更集供我审阅，然后导出综述大纲。`,
        shotAlt: '文献画板：左边是论文和一个研究问题，右边是一个论点、它的证据和一条反驳',
      },
    },
  }
}
