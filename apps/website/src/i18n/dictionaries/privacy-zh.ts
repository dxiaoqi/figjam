import type { Site } from '@/config/site'
import type { PrivacyDict } from './privacy-en'

export default function privacyZh(s: Site): PrivacyDict {
  return {
    metaTitle: '隐私',
    description: `${s.name} 收集什么：一个需要你主动开启的匿名安装统计，以及匿名的下载计数。你的画板从不离开你的电脑。`,
    eyebrow: '隐私',
    title: '我们统计什么，以及永远看不到什么。',
    lede: `${s.name} 本地优先：画板留在你的磁盘上，也不需要账号。我们只收集两个数字：一个默认关闭、由你决定是否开启的匿名安装统计，以及本网站上的匿名下载计数。`,
    updated: '最后更新：2026 年 9 月 26 日',
    toc: '本页内容',
    summary: [
      { title: '你的画板', body: '留在你的电脑上。我们没有任何接收画板的服务器。' },
      { title: '安装统计', body: '需主动开启。随机 ID、版本、系统和语言，仅此而已。' },
      { title: '本网站', body: '不用 Cookie，没有统计脚本，不请求第三方资源。' },
    ],
    boards: {
      title: '你的画板和文件',
      body: [
        '画板是 ~/.aifig（或你设置的 AIFIG_HOME）里的 .aifig 文件。本地 Core 只监听 127.0.0.1，并且需要本机专属的访问令牌，其他电脑和网页都连不上它。',
        '没有账号，也没有同步服务。画板内容、文件名和路径从不会发给我们。',
      ],
    },
    agents: {
      title: '你的 Agent',
      body: [
        '连接 Claude Code、Cursor 或其他 Agent 后，它通过本地 MCP 服务读写画板。它读到的内容可能会按其模型服务商的条款发送给服务商——和它打开的任何文件一样。',
        `${s.name} 自己不调用任何模型。Agent 和 Skill 访问网络或密钥之前都会先问你，每个决定都记在活动日志里。`,
      ],
    },
    installs: {
      title: '匿名安装统计（桌面端，需主动开启）',
      body: '大致知道有多少人在用，能帮我们决定下一步做什么。它默认关闭，直到你在欢迎引导或「设置 › 匿名安装统计」里打开「帮我们统计安装量」。开启后，应用只发送下面这些内容：',
      fieldsTitle: '逐项说明',
      headers: ['字段', '含义'],
      fields: [
        { name: 'event', what: '首次发送 install，之后每个 UTC 日最多发送一次 active' },
        { name: 'installId', what: '开启时生成的随机 UUID。关闭开关会删除它，所以之后再次开启也无法与之前关联。' },
        { name: 'appVersion', what: '应用版本，例如 0.2.0' },
        { name: 'os / arch', what: 'macos、windows 或 linux，以及 CPU 架构' },
        { name: 'locale', what: '只有语言和地区，例如 zh-CN' },
      ],
      never: '从不发送：你的姓名、邮箱、主机名或用户名、文件路径、画板内容，以及任何由此推导出的信息。',
      off: '无论开关状态如何，设置 AIFIG_TELEMETRY=off 或 DO_NOT_TRACK=1 都会关闭它。没有配置统计服务的构建什么都不发送，也不显示这个开关。',
    },
    downloads: {
      title: '下载计数（本网站）',
      body: '点击下载时，页面会发送平台、架构、文件类型和版本，以及 source: website。不涉及 Cookie、ID 或指纹，也不会在你的浏览器里存任何东西。如果浏览器开启了「请勿追踪」或「全球隐私控制」，则完全不发送。',
    },
    website: {
      title: '本网站',
      body: [
        '不使用 Cookie，没有统计或广告脚本，也不从其他域名加载字体或脚本。网站会把你选择的语言存在浏览器的本地存储里，这个值不会离开你的设备。',
        '和所有网站服务器一样，静态托管服务可能会为安全和防滥用保留标准访问日志（IP 地址、页面、时间）。我们不用它做统计分析。',
      ],
    },
    storage: {
      title: '统计数据去了哪里',
      body: [
        '安装和下载事件会发到我们的统计服务。它只接受上面列出的字段（其他字段一律拒绝），每个安装 ID、事件和 UTC 日存一行。IP 地址只在内存中用于限流，从不存储。',
        '我们只看汇总：按日期、系统、版本和语言统计的安装量，以及日活和周活安装数。如需删除你的数据，把应用里「具体发送的内容」中显示的安装 ID 发邮件给我们即可。',
      ],
    },
    contact: {
      title: '有问题？',
      body: '随时写信给我们：',
    },
  }
}
