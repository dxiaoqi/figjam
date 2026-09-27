// Native menu and dialog strings for the desktop shell. The canvas owns the language choice and reports it
// over IPC; before it loads, the OS language decides. Keys mirror apps/canvas/src/i18n (add both locales).
const en = {
  file: 'File',
  newBoard: 'New Board…',
  open: 'Open…',
  openRecent: 'Open Recent',
  clearRecent: 'Clear Recent',
  noRecent: 'No recent boards',
  saveAs: 'Save As…',
  versionHistory: 'Version History…',
  export: 'Export',
  settings: 'Settings…',
  assistantSettings: 'Assistant Settings…',
  activity: 'Activity & Permissions…',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  duplicate: 'Duplicate',
  selectAll: 'Select All',
  view: 'View',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  zoom100: 'Zoom to 100%',
  zoomFit: 'Zoom to Fit',
  commentMode: 'Comment Mode',
  toggleMinimap: 'Toggle Minimap',
  appearance: 'Appearance',
  matchSystem: 'Match System',
  light: 'Light',
  dark: 'Dark',
  language: 'Language',
  window: 'Window',
  help: 'Help',
  connectAgent: 'Connect an Agent…',
  openBoardsFolder: 'Open Boards Folder',
  openBoard: 'Open board',
  saveBoardAs: 'Save board as',
  boardFile: 'ai-figma board',
  openFailed: 'Couldn’t open the board',
  saveFailed: 'Couldn’t save the board',
  startFailed: 'ai-figma couldn’t start',
  board: 'Board',
}

const zhCN = {
  file: '文件',
  newBoard: '新建画板…',
  open: '打开…',
  openRecent: '最近打开',
  clearRecent: '清除最近记录',
  noRecent: '没有最近的画板',
  saveAs: '另存为…',
  versionHistory: '版本历史…',
  export: '导出',
  settings: '设置…',
  assistantSettings: '内置助手设置…',
  activity: '活动与权限…',
  edit: '编辑',
  undo: '撤销',
  redo: '重做',
  duplicate: '创建副本',
  selectAll: '全选',
  view: '显示',
  zoomIn: '放大',
  zoomOut: '缩小',
  zoom100: '缩放至 100%',
  zoomFit: '缩放至全部',
  commentMode: '评论模式',
  toggleMinimap: '显示/隐藏小地图',
  appearance: '外观',
  matchSystem: '跟随系统',
  light: '浅色',
  dark: '深色',
  language: '语言',
  window: '窗口',
  help: '帮助',
  connectAgent: '连接 Agent…',
  openBoardsFolder: '打开画板文件夹',
  openBoard: '打开画板',
  saveBoardAs: '画板另存为',
  boardFile: 'ai-figma 画板',
  openFailed: '无法打开画板',
  saveFailed: '无法保存画板',
  startFailed: 'ai-figma 无法启动',
  board: '画板',
}

export const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
]

const dicts = { en, 'zh-CN': zhCN }

/** First supported language in the OS preference list. */
export function systemLocale(langs = []) {
  for (const l of langs) {
    if (/^zh/i.test(l)) return 'zh-CN'
    if (/^en/i.test(l)) return 'en'
  }
  return 'en'
}

export function translator(locale) {
  const d = dicts[locale] ?? en
  return (key) => d[key] ?? en[key] ?? key
}
