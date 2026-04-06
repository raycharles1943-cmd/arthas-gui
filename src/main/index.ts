import electron, { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
const { app, shell, BrowserWindow, ipcMain, dialog } = electron
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // 在开发模式下，让应用自己决定是否打开 DevTools（通过用户设置）
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.arthas.gui')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC handlers
  ipcMain.handle('toggle-devtools', (_, open: boolean) => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      if (open) {
        mainWindow.webContents.openDevTools()
      } else {
        mainWindow.webContents.closeDevTools()
      }
    }
  })

  ipcMain.handle('list-java-processes', async () => {
    try {
      // Try different approaches to find jps
      let jpsPath = 'jps'
      
      try {
        // First try running jps directly (works if it's in PATH)
        const { stdout: testOutput } = await execAsync('jps -l')
        if (testOutput) {
          // jps is in PATH, use it directly
        }
      } catch (e) {
        // jps not in PATH, try to find it through java home
        try {
          const { stdout: javaHomeOut } = await execAsync('java -XshowSettings:properties -version 2>&1 | findstr "java.home"')
          const javaHomeMatch = javaHomeOut.match(/java\.home\s*=\s*(.+)/)
          if (javaHomeMatch) {
            const javaHome = javaHomeMatch[1]
            jpsPath = join(javaHome, 'bin', 'jps.exe')
          }
        } catch (e2) {
          // Try where java as fallback
          try {
            const { stdout: javaPathOut } = await execAsync('where java')
            const javaPath = javaPathOut.split('\r\n')[0]
            if (javaPath) {
              jpsPath = join(javaPath, '..', 'jps.exe')
            }
          } catch (e3) {
            throw new Error('Java executable not found')
          }
        }
      }

      const { stdout } = await execAsync(`"${jpsPath}" -l`)
      const lines = stdout.split('\n').filter(line => line.trim())
      return lines.map(line => {
        const [pid, ...rest] = line.trim().split(' ')
        return { pid, name: rest.join(' ') || 'Unknown' }
      }).filter(p => p.name !== 'sun.tools.jps.Jps' && p.name !== 'Unknown')
    } catch (error) {
      console.error('Failed to list java processes:', error)
      return []
    }
  })

  ipcMain.handle('attach-arthas', async (_, pid: string) => {
    console.log(`[Main Process] Received request to attach Arthas to PID: ${pid}`);
    try {
      // In dev mode, resources is in the project root
      // In production, use process.resourcesPath to get the correct resources directory
      let arthasPath = join(process.resourcesPath, 'arthas-boot.jar')
      
      if (is.dev) {
        arthasPath = join(process.cwd(), 'resources', 'arthas-boot.jar')
      }

      console.log(`[Main Process] Checking Arthas boot jar at: ${arthasPath}`);
      
      // Check if the file exists
      const fs = require('fs');
      if (!fs.existsSync(arthasPath)) {
        const errorMessage = `Arthas boot jar not found at: ${arthasPath}`;
        console.error(`[Main Process] ${errorMessage}`);
        return { success: false, message: errorMessage };
      }
      
      // Check if java is available
      try {
        await execAsync('java -version');
        console.log('[Main Process] Java is available');
      } catch (e) {
        const errorMessage = 'Java is not installed or not in PATH';
        console.error(`[Main Process] ${errorMessage}`);
        return { success: false, message: errorMessage };
      }
      
      const command = `java -jar "${arthasPath}" ${pid}`
      console.log(`[Main Process] Executing command: ${command}`);
      
      const child = exec(command)

      return new Promise((resolve) => {
        let output = ''
        let errorOutput = ''
        let resolved = false

        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true
            console.warn('[Main Process] Arthas attach timed out after 30s')
            resolve({ success: false, message: 'Attach timeout' })
          }
        }, 30000)

        child.stdout?.on('data', (data) => {
          const str = data.toString();
          output += str;
          console.log(`[Main Process] Arthas STDOUT: ${str.trim()}`);
          
          if (!resolved && (
              output.includes('Arthas server already bind') || 
              output.includes('Attach success') || 
              output.includes('arthas-shell') ||
              output.includes('[arthas@') ||
              output.includes('wiki      https://arthas.aliyun.com/doc')
          )) {
            resolved = true
            clearTimeout(timeoutId)
            console.log('[Main Process] Arthas attach detected success via stdout.');
            resolve({ success: true, message: 'Attached successfully' })
          }
        })

        child.stderr?.on('data', (data) => {
          const str = data.toString();
          errorOutput += str;
          console.error(`[Main Process] Arthas STDERR: ${str.trim()}`);
          
          if (str.includes('Error') || str.includes('Exception')) {
            console.error('[Main Process] Arthas attach detected error via stderr.');
          }
        })

        child.on('close', (code) => {
          console.log(`[Main Process] Arthas process closed with code: ${code}`);
          if (!resolved) {
            resolved = true
            clearTimeout(timeoutId)
            if (code !== 0 && !output.includes('Attach success')) {
              const errorMessage = `Arthas exited with code ${code}. Error: ${errorOutput || 'No error output'}`;
              console.error(`[Main Process] ${errorMessage}`);
              resolve({ success: false, message: errorMessage });
            }
          }
        });
      })
    } catch (error: any) {
      const errorMessage = `Attach error exception: ${error.message || 'Unknown error'}`;
      console.error(`[Main Process] ${errorMessage}`);
      return { success: false, message: errorMessage }
    }
  })

  ipcMain.handle('arthas-api-request', async (_, payload: { action: string, command: string }) => {
    console.log(`[Main Process] Proxying Arthas API request: ${payload.command}`);
    try {
      const response = await axios.post('http://127.0.0.1:8563/api', payload, {
        timeout: 30000
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error('[Main Process] Arthas API request failed:', error.message);
      return { success: false, message: error.message };
    }
  })

  ipcMain.handle('open-file-dialog', async (_, options: { title?: string, filters?: any[], defaultPath?: string }) => {
    try {
      const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      
      const result = await dialog.showOpenDialog(mainWindow || undefined, {
        title: options.title || '选择文件',
        filters: options.filters || [
          { name: 'All Files', extensions: ['*'] }
        ],
        defaultPath: options.defaultPath,
        properties: ['openFile', 'dontAddToRecent']
      })
      
      if (result.canceled) {
        return { success: false, canceled: true }
      }
      
      return { success: true, filePath: result.filePaths[0] }
    } catch (error: any) {
      console.error('[Main Process] File dialog failed:', error.message)
      return { success: false, message: error.message }
    }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
