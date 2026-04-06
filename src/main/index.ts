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

/**
 * 查找Arthas资源文件路径
 * 在生产环境下，electron-builder可能会将资源文件放在不同位置
 */
function findResourceFile(filename: string): string {
  const fs = require('fs');
  const path = require('path');
  
  if (!is.dev) {
    console.log(`[Resource Finder] 在生产环境中查找文件: ${filename}`);
    
    // 基本目录检查
    const resourcesDir = process.resourcesPath;
    console.log(`[Resource Finder] 基本资源目录: ${resourcesDir}`);
    
    // 常见打包路径（优先级顺序）
    const possiblePaths = [
      // 1. electron-builder的标准打包路径
      path.join(resourcesDir, 'resources', filename),
      
      // 2. 直接放在resourcesPath下
      path.join(resourcesDir, filename),
      
      // 3. app子目录
      path.join(resourcesDir, 'app', 'resources', filename),
      
      // 4. 上级目录
      path.join(resourcesDir, '..', 'resources', filename),
    ];
    
    // 调试：列出目录内容
    try {
      const dirContents = fs.readdirSync(resourcesDir);
      console.log(`[Resource Finder] 资源目录内容: ${JSON.stringify(dirContents)}`);
    } catch (e) {
      console.log(`[Resource Finder] 无法读取资源目录: ${e.message}`);
    }
    
    // 查找文件
    for (const p of possiblePaths) {
      console.log(`[Resource Finder] 尝试路径: ${p}`);
      if (fs.existsSync(p)) {
        console.log(`[Resource Finder] ✅ 找到文件: ${p}`);
        return p;
      }
    }
    
    // 如果没有找到，返回最可能的路径并记录错误
    const fallbackPath = path.join(resourcesDir, 'resources', filename);
    console.warn(`[Resource Finder] ⚠️ 未找到文件，使用回退路径: ${fallbackPath}`);
    return fallbackPath;
  } else {
    // 开发模式：从项目根目录的resources文件夹获取
    const devPath = path.join(process.cwd(), 'resources', filename);
    console.log(`[Resource Finder] 开发模式路径: ${devPath}`);
    return devPath;
  }
}

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
      console.log('[Main Process] Raw jps output:', lines)
      
      const processes = lines.map(line => {
        const [pid, ...rest] = line.trim().split(' ')
        const name = rest.join(' ') || 'Unknown'
        
        // 识别不同类型的Java进程
        let displayName = name
        let type = 'unknown'
        
        if (name.includes('org.springframework.boot.loader')) {
          displayName = 'Spring Boot Application'
          type = 'spring-boot'
        } else if (name.includes('com.intellij.idea.Main')) {
          displayName = 'IntelliJ IDEA'
          type = 'idea'
        } else if (name.includes('sun.tools.jps.Jps')) {
          displayName = 'jps tool'
          type = 'jps-tool'
        } else if (name.endsWith('.jar')) {
          displayName = `JAR: ${name.split('/').pop()?.split('\\').pop() || name}`
          type = 'jar'
        } else if (name.includes('.')) {
          // 可能是主类名
          const className = name.split('.').pop()
          displayName = `Application: ${className}`
          type = 'application'
        }
        
        return { 
          pid, 
          name,          // 原始名称（用于Arthas连接）
          displayName,   // 友好显示名称
          type           // 进程类型
        }
      })
      
      console.log('[Main Process] Processed process list:', processes)
      
      // 过滤掉不相关的进程
      return processes.filter(p => 
        p.type !== 'jps-tool' && 
        p.type !== 'unknown' &&
        !p.name.includes('sun.tools.jps.Jps') &&
        !p.name.includes('jdk.jcmd/sun.tools.jps.Jps')
      )
    } catch (error) {
      console.error('Failed to list java processes:', error)
      return []
    }
  })

  ipcMain.handle('attach-arthas', async (_, pid: string) => {
    console.log(`[Main Process] Received request to attach Arthas to PID: ${pid}`);
    try {
      // 使用资源查找函数定位Arthas jar文件
      const arthasPath = findResourceFile('arthas-boot.jar');
      console.log(`[Main Process] Using Arthas jar at: ${arthasPath}`);
      
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
      
      const command = `java -jar "${arthasPath}" ${pid} --attach-only`
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
          
          // 检测成功的关键词
          const successKeywords = [
            'Arthas server already bind',
            'Attach success',
            'arthas-shell',
            '[arthas@',
            'wiki      https://arthas.aliyun.com/doc',
            'target process already listen port',
            'skip attach',
            'already using port',
            'Process already using port'
          ];
          
          const hasSuccess = successKeywords.some(keyword => output.includes(keyword));
          
          if (!resolved && hasSuccess) {
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
            
            // 检测是否已经成功连接
            const successIndicators = [
              'target process already listen port 3658',
              'skip attach',
              'already using port',
              'Arthas server already bind',
              'Attach success'
            ];
            
            const hasSuccessIndication = successIndicators.some(indicator => output.includes(indicator));
            
            if (code !== 0 && !hasSuccessIndication) {
              const errorMessage = `Arthas exited with code ${code}. Error: ${errorOutput || 'No error output'}`;
              console.error(`[Main Process] ${errorMessage}`);
              resolve({ success: false, message: errorMessage });
            } else {
              // 即使退出码不为0，但只要检测到成功指示，也算成功
              console.log('[Main Process] Arthas attach completed successfully (with non-zero exit code)');
              resolve({ success: true, message: 'Attached successfully' });
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
