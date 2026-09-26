import type { ContentLanguage, TemplateId } from '@aifig/shared'

export interface TemplateStep {
  tool: 'create_blocks' | 'connect'
  args: Record<string, unknown>
}

type L = (en: string, zh: string) => string

/**
 * Template content as Canvas API calls: frames, layout intents and typed blocks only — no coordinates, so the
 * layout engine sizes and spaces everything exactly as it would for an agent. Texts that later steps connect
 * must be unique on the board.
 */
const BUILDERS: Record<TemplateId, (l: L) => TemplateStep[]> = {
  'research-synthesis': (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Evidence', '证据'),
        layout: 'grid',
        columns: 2,
        blocks: [
          { type: 'quote', text: l('“I spent the first hour just setting things up.”', '“光是把东西配好就花了我一个小时。”'), fields: { interviewee: 'P1', source: l('Interview', '访谈') } },
          { type: 'quote', text: l('“An empty board makes me freeze.”', '“面对空白画板我就不知道从哪下手。”'), fields: { interviewee: 'P2', source: l('Interview', '访谈') } },
          { type: 'quote', text: l('“I redo half of what the AI gives me.”', '“AI 给的东西我得重做一半。”'), fields: { interviewee: 'P3', source: l('Interview', '访谈') } },
          { type: 'quote', text: l('“Seeing it work step by step, I trust it more.”', '“能看到它一步步在做，我就更放心。”'), fields: { interviewee: 'P4', source: l('Survey', '问卷') } },
          { type: 'quote', text: l('“Templates would get me started faster.”', '“有模板的话我能更快上手。”'), fields: { interviewee: 'P5', source: l('Interview', '访谈') } },
          { type: 'quote', text: l('“I need to undo everything it did, in one go.”', '“我需要能一键撤销它做的所有事。”'), fields: { interviewee: 'P6', source: l('Support ticket', '工单') } },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Themes', '主题'),
        right_of: l('Evidence', '证据'),
        layout: 'cluster',
        blocks: [
          { type: 'insight', text: l('Setup cost kills momentum', '配置成本打断了节奏'), group: l('Getting started', '上手') },
          { type: 'insight', text: l('A blank canvas needs a first step', '空白画布需要一个起点'), group: l('Getting started', '上手') },
          { type: 'insight', text: l('Cleanup erases the time saved', '返工抵消了节省的时间'), group: l('Trust in AI', '对 AI 的信任') },
          { type: 'insight', text: l('Visible progress builds trust', '看得见的过程带来信任'), group: l('Trust in AI', '对 AI 的信任') },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Next steps', '下一步'),
        right_of: l('Themes', '主题'),
        layout: 'stack',
        blocks: [
          { kind: 'card', type: 'hypothesis', title: l('Templates halve time to first value', '模板能让首次见效的时间减半'), text: l('Measure time from install to first shared board.', '衡量从安装到第一次分享画板的时间。'), fields: { status: 'unverified', confidence: 'medium' } },
          { kind: 'card', type: 'hypothesis', title: l('Change sets remove cleanup work', '变更集能省去返工'), text: l('Compare edits after accepting agent output.', '对比接受 Agent 产出后的修改量。'), fields: { status: 'unverified', confidence: 'low' } },
          { kind: 'card', type: 'question', title: l('Which step do people skip first?', '大家最先跳过哪一步？'), text: l('Watch three first-run sessions.', '观察三次首次使用过程。') },
        ],
      },
    },
    {
      tool: 'connect',
      args: {
        connectors: [
          { from: l('“I spent the first hour just setting things up.”', '“光是把东西配好就花了我一个小时。”'), to: l('Setup cost kills momentum', '配置成本打断了节奏') },
          { from: l('“I redo half of what the AI gives me.”', '“AI 给的东西我得重做一半。”'), to: l('Cleanup erases the time saved', '返工抵消了节省的时间') },
        ],
      },
    },
  ],

  'competitor-analysis': (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Landscape', '竞争格局'),
        layout: 'grid',
        columns: 3,
        blocks: [
          { kind: 'card', title: l('Competitor A', '竞品 A'), text: l('**For:** design teams\n**Pricing:** per seat\n**Standout:** polish and templates', '**用户：**设计团队\n**定价：**按席位\n**亮点：**精致度与模板'), color: 'purple' },
          { kind: 'card', title: l('Competitor B', '竞品 B'), text: l('**For:** enterprises\n**Pricing:** annual contract\n**Standout:** integrations', '**用户：**大型企业\n**定价：**年度合同\n**亮点：**集成能力'), color: 'blue' },
          { kind: 'card', title: l('Competitor C', '竞品 C'), text: l('**For:** developers\n**Pricing:** open source\n**Standout:** extensibility', '**用户：**开发者\n**定价：**开源\n**亮点：**可扩展性'), color: 'teal' },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Strengths and gaps', '优势与短板'),
        below: l('Landscape', '竞争格局'),
        layout: 'cluster',
        blocks: [
          { text: l('Mature template library', '成熟的模板库'), group: l('Their strengths', '对手的优势'), color: 'green' },
          { text: l('Real-time collaboration', '实时协作'), group: l('Their strengths', '对手的优势'), color: 'green' },
          { text: l('Strong brand with teams', '在团队中口碑好'), group: l('Their strengths', '对手的优势'), color: 'green' },
          { text: l('AI output needs cleanup', 'AI 产出需要手动整理'), group: l('Their gaps', '对手的短板'), color: 'red' },
          { text: l('Cloud only, no local files', '只有云端，没有本地文件'), group: l('Their gaps', '对手的短板'), color: 'red' },
          { text: l('Agents can’t review changes', 'Agent 的修改无法审阅'), group: l('Their gaps', '对手的短板'), color: 'red' },
          { type: 'idea', text: l('Tidy agent output by default', '默认整理 Agent 产出'), group: l('Where we play', '我们的机会') },
          { type: 'idea', text: l('Local-first boards', '本地优先的画板'), group: l('Where we play', '我们的机会') },
          { type: 'idea', text: l('Review every agent edit', '每次 Agent 修改都可审阅'), group: l('Where we play', '我们的机会') },
        ],
      },
    },
    {
      tool: 'connect',
      args: {
        connectors: [
          { from: l('AI output needs cleanup', 'AI 产出需要手动整理'), to: l('Tidy agent output by default', '默认整理 Agent 产出') },
          { from: l('Cloud only, no local files', '只有云端，没有本地文件'), to: l('Local-first boards', '本地优先的画板') },
          { from: l('Agents can’t review changes', 'Agent 的修改无法审阅'), to: l('Review every agent edit', '每次 Agent 修改都可审阅') },
        ],
      },
    },
  ],

  'user-journey': (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Journey: the first week', '旅程：第一周'),
        layout: 'cluster',
        blocks: [
          { text: l('Hears about it from a teammate', '从同事那里听说'), group: l('1 · Discover', '1 · 发现'), color: 'blue' },
          { text: l('Curious, a bit skeptical', '好奇，但有点怀疑'), group: l('1 · Discover', '1 · 发现'), color: 'yellow' },
          { text: l('Unsure what it is for', '不确定它能做什么'), group: l('1 · Discover', '1 · 发现'), color: 'red' },
          { text: l('Installs and opens a board', '安装并打开画板'), group: l('2 · Set up', '2 · 设置'), color: 'blue' },
          { text: l('Wants to get going fast', '想快点开始'), group: l('2 · Set up', '2 · 设置'), color: 'yellow' },
          { text: l('Can’t find the MCP config', '找不到 MCP 配置'), group: l('2 · Set up', '2 · 设置'), color: 'red' },
          { text: l('Asks an agent for a first draft', '让 Agent 起草初稿'), group: l('3 · First value', '3 · 初次见效'), color: 'blue' },
          { text: l('Relieved it looks tidy', '看到排版整齐松了口气'), group: l('3 · First value', '3 · 初次见效'), color: 'yellow' },
          { text: l('Reviewing many changes is slow', '逐条审阅很多修改太慢'), group: l('3 · First value', '3 · 初次见效'), color: 'red' },
          { text: l('Shares a PNG with the team', '把 PNG 分享给团队'), group: l('4 · Share', '4 · 分享'), color: 'blue' },
          { text: l('Proud of the result', '对成果很满意'), group: l('4 · Share', '4 · 分享'), color: 'yellow' },
          { text: l('Teammates can’t comment', '同事无法评论'), group: l('4 · Share', '4 · 分享'), color: 'red' },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Opportunities', '机会点'),
        below: l('Journey: the first week', '旅程：第一周'),
        layout: 'row',
        blocks: [
          { type: 'idea', text: l('Explain the value in one screen', '一屏讲清价值') },
          { type: 'idea', text: l('One-click agent setup', '一键接入 Agent') },
          { type: 'idea', text: l('Accept a whole change set at once', '整组接受变更') },
          { type: 'idea', text: l('Invite teammates to comment', '邀请同事评论') },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Legend', '图例'),
        right_of: l('Journey: the first week', '旅程：第一周'),
        layout: 'stack',
        blocks: [{ kind: 'card', title: l('How to read it', '怎么看'), text: l('- **Blue** — what they do\n- **Yellow** — how they feel\n- **Red** — where it hurts', '- **蓝色** —— 用户的行为\n- **黄色** —— 用户的感受\n- **红色** —— 痛点'), color: 'gray' }],
      },
    },
  ],

  brainstorm: (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Prompt', '题目'),
        layout: 'row',
        blocks: [
          { kind: 'card', type: 'question', title: l('How might we help new teams get value in their first ten minutes?', '怎样让新团队在最初十分钟内就有收获？'), text: l('Go wide first. No idea is too small or too wild.', '先求多，再求好。再小再离谱的想法都欢迎。') },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Ideas', '想法'),
        below: l('Prompt', '题目'),
        layout: 'cluster',
        blocks: [
          { type: 'idea', text: l('Pre-filled example board', '预置示例画板'), group: l('Quick wins', '速赢') },
          { type: 'idea', text: l('Keyboard cheat sheet', '快捷键速查'), group: l('Quick wins', '速赢') },
          { type: 'idea', text: l('Sample prompts for agents', 'Agent 提示词示例'), group: l('Quick wins', '速赢') },
          { type: 'idea', text: l('Agent drafts the first board', 'Agent 起草第一块画板'), group: l('Big bets', '大赌注') },
          { type: 'idea', text: l('Import from other whiteboards', '从其他白板导入'), group: l('Big bets', '大赌注') },
          { type: 'idea', text: l('Guided research workflow', '引导式研究流程'), group: l('Big bets', '大赌注') },
          { type: 'idea', text: l('Voice notes become stickies', '语音笔记变便签'), group: l('Wild cards', '奇思妙想') },
          { type: 'idea', text: l('A board that tidies itself', '会自己整理的画板'), group: l('Wild cards', '奇思妙想') },
          { type: 'idea', text: l('Replay how the board grew', '回放画板的成长过程'), group: l('Wild cards', '奇思妙想') },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Shortlist', '入选'),
        right_of: l('Ideas', '想法'),
        layout: 'stack',
        blocks: [
          { kind: 'card', type: 'todo', title: l('Prototype the example board', '做出示例画板原型'), text: l('Test with three new users.', '找三位新用户试用。'), fields: { owner: l('Alex', '小林'), done: false } },
          { kind: 'card', type: 'todo', title: l('Write five sample prompts', '写五条提示词示例'), text: l('Cover research, planning and retros.', '覆盖研究、规划和复盘场景。'), fields: { owner: l('Sam', '阿杰'), done: false } },
        ],
      },
    },
  ],

  'meeting-notes': (l) => [
    {
      tool: 'create_blocks',
      args: {
        frame: l('Agenda', '议程'),
        layout: 'stack',
        blocks: [
          { kind: 'card', title: l('1 · Goals for this week', '1 · 本周目标'), text: l('5 min', '5 分钟'), color: 'gray' },
          { kind: 'card', title: l('2 · Updates', '2 · 进展同步'), text: l('15 min', '15 分钟'), color: 'gray' },
          { kind: 'card', title: l('3 · Decisions needed', '3 · 待决事项'), text: l('10 min', '10 分钟'), color: 'gray' },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Notes', '记录'),
        right_of: l('Agenda', '议程'),
        layout: 'grid',
        columns: 2,
        blocks: [
          { text: l('Beta signups doubled after the launch post', '发布文章后内测报名翻倍') },
          { text: l('Onboarding drop-off is at agent setup', '新手流失集中在接入 Agent 这一步') },
          { type: 'question', text: l('Do we support Windows at launch?', '首发是否支持 Windows？') },
          { text: l('Design review moved to Thursday', '设计评审改到周四') },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Decisions', '决定'),
        right_of: l('Notes', '记录'),
        layout: 'stack',
        blocks: [
          { type: 'insight', text: l('Ship one-click agent setup first', '优先上线一键接入 Agent') },
          { type: 'insight', text: l('Windows follows in the next release', 'Windows 下个版本跟进') },
        ],
      },
    },
    {
      tool: 'create_blocks',
      args: {
        frame: l('Action items', '待办'),
        right_of: l('Decisions', '决定'),
        layout: 'stack',
        blocks: [
          { kind: 'card', type: 'todo', title: l('Draft the setup flow', '起草接入流程'), text: l('By Friday', '周五前'), fields: { owner: l('Mia', '小美'), done: false } },
          { kind: 'card', type: 'todo', title: l('Check Windows installer', '检查 Windows 安装包'), text: l('Next sprint', '下个迭代'), fields: { owner: l('Leo', '阿乐'), done: false } },
          { kind: 'card', type: 'todo', title: l('Share notes with the team', '把纪要发给团队'), text: l('Today', '今天'), fields: { owner: l('You', '你'), done: true } },
        ],
      },
    },
    {
      tool: 'connect',
      args: {
        connectors: [{ from: l('Onboarding drop-off is at agent setup', '新手流失集中在接入 Agent 这一步'), to: l('Ship one-click agent setup first', '优先上线一键接入 Agent') }],
      },
    },
  ],
}

export function templateSteps(id: TemplateId, language: ContentLanguage = 'en'): TemplateStep[] {
  return BUILDERS[id]((en, zh) => (language === 'zh-CN' ? zh : en))
}
