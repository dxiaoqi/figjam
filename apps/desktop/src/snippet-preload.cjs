// Preload for inline web snippets running in a <webview> (sandboxed, context-isolated). The snippet's only
// channel to the canvas: messages relayed to the embedding page, which validates every one of them.
const { contextBridge, ipcRenderer } = require('electron')

const listeners = []
ipcRenderer.on('aifig', (_e, msg) => {
  for (const fn of listeners) fn(msg)
})

contextBridge.exposeInMainWorld('aifigHost', {
  send(msg) {
    ipcRenderer.sendToHost('aifig', msg)
  },
  onMessage(fn) {
    if (typeof fn === 'function') listeners.push(fn)
  },
})
