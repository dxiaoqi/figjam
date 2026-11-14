// Bridge between the canvas (renderer) and the desktop shell.
const { contextBridge, ipcRenderer } = require('electron')

const features = ipcRenderer.sendSync('nodboard:features') || {}

contextBridge.exposeInMainWorld('nodboardDesktop', {
  platform: process.platform,
  // the core's access token (read by the shell from NODBOARD_HOME); snippets never see it — they run in webviews
  // with their own preload
  token: ipcRenderer.sendSync('nodboard:token') || undefined,
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
  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:folder', defaultPath),
  savePath: (opts) => ipcRenderer.invoke('dialog:save', opts),
  revealPath: (file) => ipcRenderer.send('shell:reveal', file),
  // the built-in assistant is behind a build-time flag (off by default)
  ...(features.assistant
    ? {
        assistant: {
          get: () => ipcRenderer.invoke('assistant:get'),
          save: (settings) => ipcRenderer.invoke('assistant:save', settings),
        },
      }
    : {}),
  telemetry: {
    status: () => ipcRenderer.invoke('telemetry:status'),
    set: (granted) => ipcRenderer.invoke('telemetry:set', granted === true),
  },
})
