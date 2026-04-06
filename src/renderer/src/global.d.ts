export {};

declare global {
  interface Window {
    api: {
      listJavaProcesses: () => Promise<any>
      attachArthas: (pid: string) => Promise<any>
      arthasApiRequest: (payload: any) => Promise<any>
      toggleDevTools: (open: boolean) => Promise<void>
      openFileDialog: (options?: { 
        title?: string, 
        filters?: { name: string, extensions: string[] }[], 
        defaultPath?: string 
      }) => Promise<{ 
        success: boolean, 
        canceled?: boolean,
        filePath?: string,
        message?: string 
      }>
      onArthasLog: (callback: (log: string) => void) => void
      removeAllArthasLogListeners: () => void
    }
  }
}