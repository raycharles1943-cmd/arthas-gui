import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { contextBridge, ipcRenderer } = require('electron')

// Custom APIs for renderer
const api = {
  listJavaProcesses: () => ipcRenderer.invoke('list-java-processes'),
  attachArthas: (pid: string) => ipcRenderer.invoke('attach-arthas', pid),
  arthasApiRequest: (payload: any) => ipcRenderer.invoke('arthas-api-request', payload),
  toggleDevTools: (open: boolean) => ipcRenderer.invoke('toggle-devtools', open),
  openFileDialog: (options?: { title?: string, filters?: any[], defaultPath?: string }) => 
    ipcRenderer.invoke('open-file-dialog', options || {}),

  onArthasLog: (callback: (log: string) => void) =>
    ipcRenderer.on('arthas-log', (_event, log: string) => callback(log)),
  removeAllArthasLogListeners: () => ipcRenderer.removeAllListeners('arthas-log')
}

// 我们暂时移除对 @electron-toolkit/preload 的依赖，因为它可能包含不兼容的 ESM 导出
const electronAPI = {
  ipcRenderer: {
    send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, func: (...args: any[]) => void) => {
      const subscription = (_event: any, ...args: any[]) => func(...args)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    }
  }
}


// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in d.ts)
  window.electron = electronAPI
  // @ts-ignore (define in d.ts)
  window.api = api
}
