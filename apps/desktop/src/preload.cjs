// Bridge between the canvas (renderer) and the desktop shell.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aifigDesktop', {
  platform: process.platform,
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
  assistant: {
    get: () => ipcRenderer.invoke('assistant:get'),
    save: (settings) => ipcRenderer.invoke('assistant:save', settings),
  },
})
