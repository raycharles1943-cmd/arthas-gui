import { useState, useEffect, useRef } from 'react'
import { Monitor, RefreshCw, Play, Search, AlertCircle, CheckCircle2, LayoutDashboard, Activity, Search as SearchIcon, Terminal, Settings, LogOut, History, Zap, ClipboardList } from 'lucide-react'
import { Dashboard } from './components/Dashboard'
import { Threads } from './components/Threads'
import { ClassSearch } from './components/ClassSearch'
import { Diagnostics } from './components/Diagnostics'
import { RequestMonitor } from './components/RequestMonitor'
import { Environment } from './components/Environment'
import { Logger } from './components/Logger'
import { TimeTunnel } from './components/TimeTunnel'
import { HotSwap } from './components/HotSwap'
import { I18nProvider, useI18n } from './utils/i18n.tsx'
import { usePersistentState } from './utils/usePersistentState'

interface JavaProcess {
  pid: string
  name: string
  displayName?: string
  type?: string
}

type TabType = 'dashboard' | 'threads' | 'monitor' | 'classes' | 'watch' | 'tt' | 'hotswap' | 'env' | 'logger' | 'settings'

function AppContent() {
  const { t, language, setLanguage } = useI18n()
  const [processes, setProcesses] = useState<JavaProcess[]>([])
  const [loading, setLoading] = useState(false)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [connectedPid, setConnectedPid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [debugMode, setDebugMode] = usePersistentState('debugMode', false)
  const [apiReady, setApiReady] = useState(false)
  const debugModeApplied = useRef(false)

  const fetchProcesses = async () => {
    setLoading(true)
    setError(null)
    console.log('[Renderer Process] Fetching java processes...');
    try {
      // @ts-ignore (exposed via preload)
      const list = await window.api.listJavaProcesses()
      console.log('[Renderer Process] Received processes:', list);
      setProcesses(list)
      if (list.length === 0) {
        console.warn('[Renderer Process] No java processes returned from main process. Check main process logs for errors.');
      }
    } catch (err) {
      console.error('[Renderer Process] Error fetching processes:', err);
      setError(t('app.error.failed.processes'))
    } finally {
      setLoading(false)
    }
  }

  const handleAttach = async (pid: string) => {
    setAttaching(pid)
    setError(null)
    console.log(`[Renderer Process] Requesting attach to PID: ${pid}`);
    try {
      // @ts-ignore
      const result = await window.api.attachArthas(pid)
      console.log(`[Renderer Process] Received attach result:`, result);
      if (result && result.success) {
        setConnectedPid(pid)
      } else {
        const errorMsg = result?.message || 'Failed to attach Arthas (No error message)'
        console.error(`[Renderer Process] Attach failed:`, errorMsg);
        setError(errorMsg)
      }
    } catch (err) {
      console.error(`[Renderer Process] Error while calling attachArthas API:`, err);
      setError('Error while attaching: ' + err)
    } finally {
      setAttaching(null)
    }
  }

  useEffect(() => {
    fetchProcesses()
  }, [])

  // 检查 API 可用性
  useEffect(() => {
    const checkApi = () => {
      console.log('App 加载完成，检查 window.api 可用性:', {
        api: typeof window.api,
        toggleDevTools: typeof window.api?.toggleDevTools,
        listJavaProcesses: typeof window.api?.listJavaProcesses,
        attachArthas: typeof window.api?.attachArthas
      })
      
      if (window.api && typeof window.api.toggleDevTools === 'function') {
        setApiReady(true)
        console.log('✅ API 可用')
      } else {
        console.log('❌ API 不可用，preload 可能未正确加载')
      }
    }
    
    // 延迟检查，确保所有脚本已加载
    setTimeout(checkApi, 100)
  }, [])

  // 在应用启动时检查调试模式状态（仅执行一次）
  useEffect(() => {
    if (!debugModeApplied.current && debugMode) {
      debugModeApplied.current = true
      const applyDebugMode = async () => {
        try {
          // @ts-ignore
          await window.api.toggleDevTools(true)
        } catch (err) {
          console.error('启动调试模式失败:', err)
        }
      }
      applyDebugMode()
    }
  }, [debugMode])

  // 处理调试模式开关
  const handleDebugModeToggle = async (enabled: boolean) => {
    setDebugMode(enabled)
    try {
      console.log('切换调试模式:', enabled, 'window.api:', window.api)
      console.log('toggleDevTools 是否存在:', typeof window.api?.toggleDevTools)
      
      // 检查 API 是否存在
      if (window.api && typeof window.api.toggleDevTools === 'function') {
        await window.api.toggleDevTools(enabled)
      } else {
        console.warn('toggleDevTools API 不可用，这可能是因为：')
        console.warn('1. 预加载脚本未正确编译')
        console.warn('2. 应用需要重启以加载新的预加载脚本')
        console.warn('3. 请尝试重新启动开发服务器或完整重新构建应用')
        
        if (enabled) {
          alert('调试模式已启用，但需要重启应用才能使自动打开/关闭开发者工具功能生效\n\n在重启前，你可以手动按 F12 打开开发者工具。')
        } else {
          alert('调试模式已禁用，但需要重启应用才能使自动打开/关闭开发者工具功能完全生效\n\n在重启前，你可以手动关闭开发者工具。')
        }
      }
    } catch (err) {
      console.error('切换调试模式失败:', err)
      console.error('完整的错误信息:', err)
      alert(`切换调试模式失败: ${err.message}\n\n请检查控制台查看更多信息。`)
    }
  }

  const filteredProcesses = processes.filter(p => {
    const searchLower = search.toLowerCase()
    const nameMatch = p.name.toLowerCase().includes(searchLower)
    const displayNameMatch = p.displayName ? p.displayName.toLowerCase().includes(searchLower) : false
    const pidMatch = p.pid.includes(search)
    
    return nameMatch || displayNameMatch || pidMatch
  })

  if (connectedPid) {
    const process = processes.find(p => p.pid === connectedPid)
    const processName = process?.displayName || process?.name || 'Java Process'
    
    return (
      <div className="flex h-screen bg-gray-100 overflow-hidden font-sans">
        {/* Sidebar */}
        <aside className="w-64 bg-[#0d1117] text-gray-300 flex flex-col shrink-0 border-r border-white/5">
          <div className="p-6 flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg text-white shadow-lg shadow-blue-500/20">
              <Monitor size={20} />
            </div>
            <h1 className="text-lg font-bold text-white tracking-tight">{t('app.title')}</h1>
          </div>
          
          <div className="px-4 py-3 bg-white/5 mx-4 rounded-xl mb-6">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{t('app.attached.pid')}</p>
            <p className="text-sm font-mono text-blue-400 font-bold truncate" title={processName}>{connectedPid} · {processName}</p>
          </div>

          <nav className="flex-1 px-3 space-y-1">
            <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={18} />} label={t('app.dashboard')} />
            <NavItem active={activeTab === 'threads'} onClick={() => setActiveTab('threads')} icon={<Activity size={18} />} label={t('app.threads')} />
            <NavItem active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} icon={<Zap size={18} />} label={t('app.monitor')} />
            <NavItem active={activeTab === 'classes'} onClick={() => setActiveTab('classes')} icon={<SearchIcon size={18} />} label={t('app.classes')} />
            <NavItem active={activeTab === 'watch'} onClick={() => setActiveTab('watch')} icon={<Terminal size={18} />} label={t('app.watch')} />
            <NavItem active={activeTab === 'tt'} onClick={() => setActiveTab('tt')} icon={<History size={18} />} label={t('app.tt')} />
            <NavItem active={activeTab === 'hotswap'} onClick={() => setActiveTab('hotswap')} icon={<Zap size={18} />} label={t('app.hotswap')} />
            <NavItem active={activeTab === 'env'} onClick={() => setActiveTab('env')} icon={<Settings size={18} />} label={t('app.env')} />
            <NavItem active={activeTab === 'logger'} onClick={() => setActiveTab('logger')} icon={<ClipboardList size={18} />} label={t('app.logger')} />
            <div className="h-px bg-white/5 my-4 mx-3" />
            <NavItem active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings size={18} />} label={t('app.settings')} />
          </nav>

          <div className="p-4 mt-auto">
            <button 
              onClick={() => setConnectedPid(null)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 transition-all border border-red-500/20"
            >
              <LogOut size={16} />
              {t('app.detach')}
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">
          <div className="flex-1 overflow-hidden relative">
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'threads' && <Threads />}
            {activeTab === 'monitor' && <RequestMonitor connectedPid={connectedPid} />}
            {activeTab === 'classes' && <ClassSearch />}
            {activeTab === 'watch' && <Diagnostics />}
            {activeTab === 'tt' && <TimeTunnel />}
            {activeTab === 'hotswap' && <HotSwap />}
            {activeTab === 'env' && <Environment />}
            {activeTab === 'logger' && <Logger />}
            {activeTab === 'settings' && (
              <div className="p-8 max-w-2xl mx-auto space-y-6">
                <h2 className="text-2xl font-bold text-gray-800">{t('app.settings.title')}</h2>
                <div className="space-y-4">
                  <div className="p-6 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
                    <p className="text-sm text-gray-500">{t('app.settings.configuration')}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">{t('app.settings.language')}</label>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setLanguage('zh')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${language === 'zh' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                      >
                        {t('app.settings.language.zh')}
                      </button>
                      <button
                        onClick={() => setLanguage('en')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${language === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                      >
                        {t('app.settings.language.en')}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">{t('app.settings.debugMode')}</label>
                        <p className="text-xs text-gray-500 mt-1">{t('app.settings.debugMode.description')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!apiReady && (
                          <div className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
                            {t('app.settings.debugMode.restart')}
                          </div>
                        )}
                        <button
                          onClick={() => handleDebugModeToggle(!debugMode)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${debugMode ? 'bg-blue-600' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${debugMode ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b">
        <div className="flex items-center gap-2">
          <Monitor className="text-blue-600" />
          <h1 className="text-xl font-bold">{t('app.title')}</h1>
        </div>
        <button 
          onClick={fetchProcesses}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} size={18} />
          {t('app.refresh')}
        </button>
      </header>

      <main className="flex-1 p-6 overflow-hidden">
        <div className="max-w-4xl mx-auto">
          {error && (
            <div className="flex items-center gap-3 p-4 mb-6 text-red-700 bg-red-50 border border-red-100 rounded-lg">
              <AlertCircle size={20} />
              <p>{error}</p>
            </div>
          )}

          <div className="mb-6 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder={t('app.search.placeholder')}
              className="w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white shadow-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 px-6 py-3 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <div className="col-span-2">PID</div>
              <div className="col-span-8">{t('app.process.name')}</div>
              <div className="col-span-2 text-right">{t('app.action')}</div>
            </div>
            
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {loading ? (
                <div className="p-12 text-center text-gray-400">{t('app.loading')}</div>
              ) : filteredProcesses.length === 0 ? (
                <div className="p-12 text-center text-gray-400">{t('app.no.processes')}</div>
              ) : (
                filteredProcesses.map(proc => (
                  <div key={proc.pid} className="grid grid-cols-12 px-6 py-4 items-center hover:bg-blue-50 transition-colors">
                    <div className="col-span-2 font-mono text-gray-600">{proc.pid}</div>
                    <div className="col-span-8 font-medium text-gray-800 truncate pr-4" title={proc.name}>
                      {proc.displayName || proc.name}
                    </div>
                    <div className="col-span-2 text-right">
                      <button 
                        onClick={() => handleAttach(proc.pid)}
                        disabled={attaching === proc.pid}
                        className="flex items-center gap-2 ml-auto px-4 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
                      >
                        {attaching === proc.pid ? <RefreshCw className="animate-spin" size={14} /> : <Play size={14} />}
                        {t('app.connect')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
      
      <footer className="px-6 py-4 bg-white border-t text-center text-xs text-gray-400">
        {t('app.footer')}
      </footer>
    </div>
  )
}

function NavItem({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
        active 
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' 
          : 'text-gray-400 hover:text-white hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  )
}

export default App
