import type { Site } from '@/config/site'

export default function privacyEn(s: Site) {
  return {
    metaTitle: 'Privacy',
    description: `What ${s.name} collects: an opt-in, anonymous install count and an anonymous download count. Your boards never leave your computer.`,
    eyebrow: 'Privacy',
    title: 'What we count, and what we never see.',
    lede: `${s.name} is local-first: your boards stay on your disk and there is no account. The only numbers we collect are an anonymous install count that is off until you turn it on, and an anonymous download count on this website.`,
    updated: 'Last updated September 26, 2026',
    toc: 'On this page',
    summary: [
      { title: 'Your boards', body: 'Stay on your computer. We run no server that receives them.' },
      { title: 'Install count', body: 'Opt-in. A random ID, version, OS and language — nothing else.' },
      { title: 'This website', body: 'No cookies, no analytics scripts, no third-party requests.' },
    ],
    boards: {
      title: 'Your boards and files',
      body: [
        `Boards are .nodboard files in ~/.nodboard (or wherever you set NODBOARD_HOME). The local core listens on 127.0.0.1 only and needs a per-install access token, so other machines and web pages can’t reach it.`,
        'There is no account and no sync service. Board content, file names and paths are never sent to us.',
      ],
    },
    agents: {
      title: 'Your agent',
      body: [
        `When you connect Claude Code, Cursor or another agent, it reads and writes boards through the local MCP server. What it reads may be sent to its model provider under that provider’s terms, like any file your agent opens.`,
        `${s.name} makes no model calls of its own. Agents and Skills ask before they reach the network or a secret, and every decision is in the activity log.`,
      ],
    },
    installs: {
      title: 'Anonymous install count (desktop app, opt-in)',
      body: 'Knowing roughly how many people use the app helps us decide what to build. It’s off until you switch on Help us count installs in the welcome tour or in Settings › Anonymous install count. When it’s on, the app sends this, and only this:',
      fieldsTitle: 'Field by field',
      headers: ['Field', 'What it is'],
      fields: [
        { name: 'event', what: 'install once, then active at most once per UTC day' },
        { name: 'installId', what: 'A random UUID created when you opt in. Turning the switch off deletes it, so a later opt-in can’t be linked to it.' },
        { name: 'appVersion', what: 'The app version, e.g. 0.2.0' },
        { name: 'os / arch', what: 'macos, windows or linux, and the CPU architecture' },
        { name: 'locale', what: 'Language and region only, e.g. en-US' },
      ],
      never: 'Never sent: your name, email, host or user names, file paths, board content, or anything derived from them.',
      off: 'NODBOARD_TELEMETRY=off or DO_NOT_TRACK=1 turn it off regardless of the switch. Builds without a counter endpoint send nothing and hide the switch.',
    },
    downloads: {
      title: 'Download count (this website)',
      body: 'When you click a download, the page sends the platform, architecture, file type and version, plus source: website. No cookie, ID or fingerprint is involved and nothing is stored in your browser. It isn’t sent at all when your browser has Do Not Track or Global Privacy Control turned on.',
    },
    website: {
      title: 'This website',
      body: [
        'No cookies, no analytics or advertising scripts, and no fonts or scripts from other domains. The site remembers the language you picked in your browser’s local storage; that value never leaves your device.',
        'Like any web server, the static host may keep standard access logs (IP address, page, time) for security and abuse prevention. We don’t use them for analytics.',
      ],
    },
    storage: {
      title: 'Where the counts go',
      body: [
        'Install and download events go to our counter service, which accepts only the fields above (anything else is rejected). It stores one row per install ID, event and UTC day. IP addresses are used in memory for rate limiting and never stored.',
        'We look at totals: installs by day, OS, version and language, and daily or weekly active installs. To have your rows deleted, email us the install ID shown under Exactly what’s sent in the app.',
      ],
    },
    contact: {
      title: 'Questions',
      body: 'Write to us any time:',
    },
  }
}

export type PrivacyDict = ReturnType<typeof privacyEn>
