// Bridge between the canvas (renderer) and the desktop shell.
const { contextBridge, ipcRenderer } = require('electron')

const features = ipcRenderer.sendSync('aifig:features') || {}

contextBridge.exposeInMainWorld('aifigDesktop', {
  platform: process.platform,
  // the core's access token (read by the shell from AIFIG_HOME); snippets never see it — they run in webviews
  // with their own preload
  token: ipcRenderer.sendSync('aifig:token') || undefined,
  snippetWebviews: true,
  onMenu(cb) {
    const listener = (_e, action, payload) => cb(action, payload)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  },
  reportState(state) {
    ipcRenderer.send('state', state)
  },
  setLocale(locale, pref) {
    ipcRenderer.send('locale', locale, pref)
  },
  // the built-in assistant is behind a build-time flag (off by default)
  ...(features.assistant
    ? {
        assistant: {
          get: () => ipcRenderer.invoke('assistant:get'),
          save: (settings) => ipcRenderer.invoke('assistant:save', settings),
        },
      }
    : {}),
})
