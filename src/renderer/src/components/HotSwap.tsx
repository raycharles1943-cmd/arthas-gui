import { useState, useEffect } from 'react'
import { arthas } from '../utils/arthas'
import { 
  Zap, FileCode, Play, Trash2, RefreshCw, AlertCircle, CheckCircle, 
  Info, Upload, Layers, FolderOpen, Download, Copy, Check, X, 
  Clock, FileText, Terminal, Settings, Eye, EyeOff, Grid, List,
  ChevronRight, ChevronDown, Star, History, Save, FolderInput,
  FileSearch, ArrowRight, AlertTriangle, Shield
} from 'lucide-react'

export function HotSwap() {
  const [javaPath, setJavaPath] = useState('')
  const [classPath, setClassPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [retransforms, setRetransforms] = useState<any[]>([])
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, msg: string, details?: string }>({ type: null, msg: '' })
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  
  // 新增状态
  const [recentFiles, setRecentFiles] = useState<any[]>([])
  const [outputDir, setOutputDir] = useState('/tmp/arthas-mc')
  const [mcOptions, setMcOptions] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'compile' | 'retransform' | 'history'>('compile')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [expandedRetransform, setExpandedRetransform] = useState<string | null>(null)
  const [selectedRetransforms, setSelectedRetransforms] = useState<Set<string>>(new Set())
  const [compilationStats, setCompilationStats] = useState<any>(null)
  const [progress, setProgress] = useState<{ step: number, status: string, details?: string } | null>(null)

  const fetchRetransforms = async () => {
    try {
      const results = await arthas.retransformList()
      const res = results.find(r => r.type === 'retransform')
      setRetransforms(res?.retransformClasses || [])
    } catch (err) {
      console.error('Failed to fetch retransform list')
    }
  }

  // 解析Java编译错误，提供友好的错误信息和解决方案
  const parseJavaCompilationError = (errorMessage: string) => {
    let shortMessage = 'Java编译错误'
    let fullDetails = errorMessage
    let solution = '请检查Java源代码语法'
    console.log(`errorMessage：${JSON.stringify(errorMessage)}`)
    // 检测常见的Java编译错误类型
    if (errorMessage.includes('未在默认构造器中初始化')) {
      shortMessage = '成员变量未初始化'
      const match = errorMessage.match(/变量\s+(\w+)\s+未在默认构造器中初始化/)
      const variableName = match ? match[1] : '未知变量'
      
      fullDetails = `${errorMessage}\n\n问题分析：类中的成员变量 "${variableName}" 在默认构造函数中没有初始化，但类没有提供显式的构造函数来初始化它。`
      solution = `解决方案：
1. 在类中添加显式构造函数来初始化 ${variableName}：
   public YourClassName() {
       this.${variableName} = null; // 或合适的初始值
   }

2. 或者直接在声明时初始化变量：
   private ProductService ${variableName} = null;

3. 如果 ${variableName} 是必需的依赖，考虑使用依赖注入或工厂模式。`
    }
    
    if (errorMessage.includes('cannot find symbol')) {
      shortMessage = '找不到符号/类'
      fullDetails = `${errorMessage}\n\n问题分析：Java编译器找不到引用的类、方法或变量。`
      solution = `解决方案：
1. 检查类名、方法名或变量名是否拼写正确
2. 确保所有引用的类都在classpath中
3. 检查是否需要导入包：添加 import 语句
4. 如果是第三方库，请确保依赖已正确配置`
    }
    
    if (errorMessage.includes('package does not exist')) {
      shortMessage = '包不存在'
      fullDetails = `${errorMessage}\n\n问题分析：引用的Java包在classpath中不存在。`
      solution = `解决方案：
1. 检查包名是否拼写正确
2. 确保对应的jar文件或目录在classpath中
3. 如果是Maven/Gradle项目，检查依赖是否正确声明`
    }
    
    if (errorMessage.includes('illegal start of expression')) {
      shortMessage = '表达式语法错误'
      fullDetails = `${errorMessage}\n\n问题分析：Java语法错误，可能是缺少分号、括号不匹配或语句位置不正确。`
      solution = `解决方案：
1. 检查错误行附近的语法
2. 确保所有语句以分号结尾（声明和初始化除外）
3. 检查括号是否匹配：{}、()、[]
4. 检查是否有拼写错误或保留字误用`
    }
    
    if (errorMessage.includes('missing return statement')) {
      shortMessage = '缺少return语句'
      fullDetails = `${errorMessage}\n\n问题分析：方法声明了返回类型，但某些代码路径没有return语句。`
      solution = `解决方案：
1. 在所有代码路径（包括if/else分支）都添加return语句
2. 如果方法不应该返回值，将返回类型改为void
3. 检查是否有异常抛出但没有return语句`
    }
    
    if (errorMessage.includes('unreported exception')) {
      shortMessage = '未处理的异常'
      fullDetails = `${errorMessage}\n\n问题分析：调用了抛出checked异常的方法，但没有在方法签名中声明或捕获异常。`
      solution = `解决方案：
1. 在方法签名中添加throws声明
   public void yourMethod() throws ExceptionName

2. 或者使用try-catch块捕获异常
   try {
       // 可能抛出异常的代码
   } catch (ExceptionName e) {
       // 处理异常
   }`
    }
    
    // 通用编译错误
    if (errorMessage.includes('Compilation Error')) {
      shortMessage = 'Java编译错误'
      
      // 提取具体的错误信息
      const errorLines = errorMessage.split('\n')
      const specificErrors = errorLines.filter(line => 
        line.includes('line:') || line.includes('error:') || line.includes('message:')
      )
      
      if (specificErrors.length > 0) {
        fullDetails = `编译错误详情：\n${specificErrors.join('\n')}\n\n完整错误信息：\n${errorMessage}`
        
        solution = `通用解决方案：
1. 打开Java源代码文件，检查错误行号附近的代码
2. 确保所有变量已正确声明和初始化
3. 检查方法签名和调用是否匹配
4. 验证导入语句是否正确
5. 确保使用正确的Java版本语法`
      }
    }
    
    return {
      shortMessage,
      fullDetails: `${fullDetails}\n\n${solution}\n\n提示：您可以在浏览器控制台（按F12）查看更详细的错误信息。`,
      solution
    }
  }

  const handleMc = async () => {
    if (!javaPath) return
    setLoading(true)
    setStatus({ type: null, msg: '' })
    setProgress({ step: 1, status: 'Compiling...', details: javaPath.split('/').pop() })
    try {
      // In a real scenario, mc outputDir should be handled carefully
      setProgress({ step: 1, status: 'Calling MC command...' })
      const res = await arthas.mc(javaPath, outputDir || '/tmp/arthas-mc', mcOptions)
      console.log(`res：${JSON.stringify(res)}`)
      setProgress({ step: 2, status: 'Processing response...' })
      const mcRes = res.find(r => r.type === 'status')
      if (mcRes && mcRes.statusCode === 0) {
        const classFile = mcRes.classFiles?.[0] || `${outputDir || '/tmp/arthas-mc'}/${javaPath.split('/').pop().replace('.java', '.class')}`
        setStatus({ type: 'success', msg: `Successfully compiled to: ${classFile}` })
        setClassPath(classFile)
        setProgress({ step: 3, status: 'Compilation completed!', details: `Output: ${classFile}` })
      } else {
        // 提取详细的错误信息
        const errorMsg = mcRes?.message || mcRes?.error || 'Unknown compilation error'
        const errorDetails = mcRes?.details || mcRes?.stackTrace || (mcRes ? JSON.stringify(mcRes, null, 2) : JSON.stringify(res, null, 2))
        
        // 解析错误信息，提供更友好的提示
        const friendlyError = parseJavaCompilationError(errorMsg)
        
        setStatus({ 
          type: 'error', 
          msg: `编译失败: ${friendlyError.shortMessage}`,
          details: `${friendlyError.fullDetails}\n\n原始错误信息:\n${errorDetails}`
        })
        setShowErrorDetails(false) // 重置错误详情展开状态
        setProgress({ 
          step: 3, 
          status: 'Compilation failed', 
          details: `${friendlyError.shortMessage} - 点击查看详情和解决方案`
        })
        
        // 在控制台输出完整错误信息以便调试
        console.error('MC Compilation Error:', {
          javaPath,
          outputDir: outputDir || '/tmp/arthas-mc',
          mcOptions,
          mcResponse: res,
          mcResult: mcRes,
          errorDetails,
          friendlyError
        })
      }
    } catch (err: any) {
      setStatus({ type: 'error', msg: err.message })
      setProgress({ step: 3, status: 'Error occurred', details: err.message })
    } finally {
      setTimeout(() => {
        setProgress(null)
        setLoading(false)
      }, 2000)
    }
  }

  const handleRetransform = async () => {
    const targetPath = classPath || javaPath // User might provide class path directly
    if (!targetPath) return
    
    setLoading(true)
    setStatus({ type: null, msg: '' })
    setProgress({ step: 1, status: 'Applying retransform...', details: targetPath.split('/').pop() })
    try {
      setProgress({ step: 2, status: 'Executing retransform command...' })
      const res = await arthas.retransform(targetPath)
      setProgress({ step: 3, status: 'Processing response...' })
      const rtRes = res.find(r => r.type === 'status')
      if (rtRes && rtRes.statusCode === 0) {
        setStatus({ type: 'success', msg: 'Retransform success! Code updated.' })
        fetchRetransforms()
        setProgress({ step: 4, status: 'Retransform applied successfully!', details: 'Code hot-swapped at runtime' })
      } else {
        // 提取详细的错误信息
        const errorMsg = rtRes?.message || rtRes?.error || 'Unknown retransform error'
        const errorDetails = rtRes?.details || rtRes?.stackTrace || (rtRes ? JSON.stringify(rtRes, null, 2) : JSON.stringify(res, null, 2))
        
        setStatus({ 
          type: 'error', 
          msg: `Retransform failed: ${errorMsg}`,
          details: errorDetails
        })
        setShowErrorDetails(false)
        setProgress({ 
          step: 4, 
          status: 'Retransform failed', 
          details: `${errorMsg} - Click error message for details`
        })
        
        console.error('Retransform Error:', {
          targetPath,
          retransformResponse: res,
          retransformResult: rtRes,
          errorDetails
        })
      }
    } catch (err: any) {
      const errorDetails = err.stack || JSON.stringify(err, null, 2)
      setStatus({ 
        type: 'error', 
        msg: `Retransform error: ${err.message}`,
        details: errorDetails
      })
      setShowErrorDetails(false)
      setProgress({ 
        step: 4, 
        status: 'Error occurred', 
        details: `${err.message} - Click error message for details`
      })
      
      console.error('Retransform Exception:', {
        targetPath,
        error: err,
        errorDetails
      })
    } finally {
      setTimeout(() => {
        setProgress(null)
        setLoading(false)
      }, 2000)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await arthas.retransformDelete(id)
      fetchRetransforms()
    } catch (err) {
      alert('Delete failed')
    }
  }

  const handleReadAll = async () => {
    setLoading(true)
    try {
      await arthas.retransformReadAll()
      setStatus({ type: 'success', msg: 'All retransforms re-applied successfully!' })
      fetchRetransforms()
    } catch (err: any) {
      setStatus({ type: 'error', msg: `Failed to reapply retransforms: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }

  // 新增功能函数
  const handleBrowseJavaFile = async () => {
    try {
      const result = await window.api.openFileDialog({
        title: 'Select Java file',
        filters: [{ name: 'Java Files', extensions: ['java'] }]
      })
      if (result.success && result.filePath) {
        setJavaPath(result.filePath)
        addToRecentFiles(result.filePath, 'java')
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Failed to browse file' })
    }
  }

  const handleBrowseClassFile = async () => {
    try {
      const result = await window.api.openFileDialog({
        title: 'Select Class file',
        filters: [{ name: 'Class Files', extensions: ['class'] }]
      })
      if (result.success && result.filePath) {
        setClassPath(result.filePath)
        addToRecentFiles(result.filePath, 'class')
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Failed to browse file' })
    }
  }

  const addToRecentFiles = (path: string, type: 'java' | 'class') => {
    const newFile = { path, type, timestamp: Date.now() }
    setRecentFiles(prev => {
      const filtered = prev.filter(f => f.path !== path)
      return [newFile, ...filtered].slice(0, 10)
    })
  }

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath(null), 2000)
  }

  const toggleSelectRetransform = (id: string) => {
    const newSelected = new Set(selectedRetransforms)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedRetransforms(newSelected)
  }

  const handleBatchDelete = async () => {
    if (selectedRetransforms.size === 0) {
      setStatus({ type: 'error', msg: 'Please select retransforms to delete' })
      return
    }

    if (!confirm(`Delete ${selectedRetransforms.size} selected retransform(s)?`)) return

    try {
      const deletions = Array.from(selectedRetransforms).map(id => 
        arthas.retransformDelete(id)
      )
      await Promise.all(deletions)
      setStatus({ type: 'success', msg: `Deleted ${selectedRetransforms.size} retransform(s)` })
      setSelectedRetransforms(new Set())
      fetchRetransforms()
    } catch (err: any) {
      setStatus({ type: 'error', msg: `Failed to delete: ${err.message}` })
    }
  }

  const handleExportConfig = () => {
    const config = {
      timestamp: new Date().toISOString(),
      totalRetransforms: retransforms.length,
      retransforms: retransforms.map(rt => ({
        id: rt.id,
        className: rt.className,
        classLoader: rt.classLoader,
        timestamp: rt.timestamp
      }))
    }
    
    const dataStr = JSON.stringify(config, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `hotswap-config-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    
    setStatus({ type: 'success', msg: 'Configuration exported successfully' })
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const handleQuickHotSwap = async () => {
    try {
      // 1. 选择Java文件
      const result = await window.api.openFileDialog({
        title: 'Select Java file for Hot Swap',
        filters: [{ name: 'Java Files', extensions: ['java'] }]
      })
      
      if (!result.success || !result.filePath) {
        if (!result.canceled) {
          setStatus({ type: 'error', msg: 'File selection canceled or failed' })
        }
        return
      }
      
      const selectedJavaPath = result.filePath
      setJavaPath(selectedJavaPath)
      addToRecentFiles(selectedJavaPath, 'java')
      
      setStatus({ type: null, msg: '' })
      setProgress({ step: 1, status: 'Starting Quick Hot Swap...', details: selectedJavaPath.split('/').pop() })
      
      // 2. 编译
      setProgress({ step: 2, status: 'Compiling with MC...' })
      const compileRes = await arthas.mc(selectedJavaPath, outputDir || '/tmp/arthas-mc', mcOptions)
      console.log(`compileRes:"${JSON.stringify(compileRes)}"`);
      const mcRes = compileRes.find(r => r.type === 'mc')
      
      if (!mcRes || !mcRes.success) {
        // 提取详细的错误信息
        const errorMsg = mcRes?.message || mcRes?.error || 'Unknown compilation error'
        const errorDetails = mcRes?.details || mcRes?.stackTrace || (mcRes ? JSON.stringify(mcRes, null, 2) : JSON.stringify(compileRes, null, 2))
        
        // 解析错误信息，提供更友好的提示
        const friendlyError = parseJavaCompilationError(errorMsg)
        
        setStatus({ 
          type: 'error', 
          msg: `编译失败: ${friendlyError.shortMessage}`,
          details: `${friendlyError.fullDetails}\n\n原始错误信息:\n${errorDetails}`
        })
        setShowErrorDetails(false)
        setProgress({ 
          step: 4, 
          status: 'Quick Hot Swap failed', 
          details: `${friendlyError.shortMessage} - 点击查看详情和解决方案`
        })
        setTimeout(() => setProgress(null), 3000)
        
        console.error('Quick Hot Swap MC Compilation Error:', {
          selectedJavaPath,
          outputDir: outputDir || '/tmp/arthas-mc',
          mcOptions,
          compileRes,
          mcResult: mcRes,
          errorDetails,
          friendlyError
        })
        return
      }
      
      const classFile = mcRes.classFiles?.[0] || `${outputDir || '/tmp/arthas-mc'}/${selectedJavaPath.split('/').pop().replace('.java', '.class')}`
      setClassPath(classFile)
      
      // 3. 重转换
      setProgress({ step: 3, status: 'Applying retransform...' })
      const retransformRes = await arthas.retransform(classFile)
      const rtRes = retransformRes.find(r => r.type === 'retransform')
      
      if (rtRes && rtRes.success) {
        setStatus({ type: 'success', msg: `Quick Hot Swap successful! File: ${selectedJavaPath.split('/').pop()}` })
        setProgress({ step: 4, status: 'Quick Hot Swap completed!', details: 'Code updated at runtime 🚀' })
        fetchRetransforms()
      } else {
        setStatus({ type: 'error', msg: 'Retransform failed' })
        setProgress({ step: 4, status: 'Quick Hot Swap failed', details: 'Retransform unsuccessful' })
      }
    } catch (err: any) {
      setStatus({ type: 'error', msg: `Quick Hot Swap error: ${err.message}` })
      setProgress({ step: 4, status: 'Error occurred', details: err.message })
    } finally {
      setTimeout(() => {
        setProgress(null)
      }, 3000)
    }
  }

  useEffect(() => {
    fetchRetransforms()
    // Load recent files from localStorage
    const savedRecent = localStorage.getItem('arthas-hotswap-recent-files')
    if (savedRecent) {
      try {
        setRecentFiles(JSON.parse(savedRecent))
      } catch (e) {
        console.error('Failed to load recent files:', e)
      }
    }
  }, [])

  useEffect(() => {
    if (recentFiles.length > 0) {
      localStorage.setItem('arthas-hotswap-recent-files', JSON.stringify(recentFiles))
    }
  }, [recentFiles])

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Navigation Tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 p-4 border-b bg-white">
        <button
          onClick={() => setActiveTab('compile')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium ${activeTab === 'compile' ? 'bg-yellow-50 text-yellow-600' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <FileCode size={16} />
          Compile & Retransform
        </button>
        <button
          onClick={() => setActiveTab('retransform')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium ${activeTab === 'retransform' ? 'bg-green-50 text-green-600' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Layers size={16} />
          Active Retransforms ({retransforms.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium ${activeTab === 'history' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <History size={16} />
          Recent Files
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'compile' && (
          <div className="grid grid-cols-2 h-full">
            {/* Left: Compile Section */}
            <div className="border-r bg-white p-6 overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Zap size={24} className="text-yellow-500" fill="currentColor" />
                  <h2 className="text-xl font-bold text-gray-800">Hot Swap Workflow</h2>
                </div>
                <button
                  onClick={handleQuickHotSwap}
                  disabled={loading}
                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-medium shadow-lg shadow-purple-500/30 hover:shadow-purple-500/40 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Zap size={16} />
                  Quick Hot Swap
                </button>
              </div>

              {/* Step 1: Memory Compile */}
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full bg-yellow-500 text-white text-xs flex items-center justify-center">1</div>
                  <h3 className="font-bold text-gray-700">Memory Compile</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Java Source File
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="relative">
                          <input
                            type="text"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                            placeholder="Select or enter Java file path"
                            value={javaPath}
                            onChange={(e) => setJavaPath(e.target.value)}
                          />
                          {javaPath && (
                            <button
                              onClick={() => handleCopyPath(javaPath)}
                              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                              {copiedPath === javaPath ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={handleBrowseJavaFile}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
                      >
                        <FolderOpen size={16} />
                        Browse
                      </button>
                    </div>
                    {classPath && (
                      <div className="flex items-center gap-1 mt-1 text-xs">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-gray-600">
                          Ready for retransform: {classPath.split('/').pop()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">Output Directory</label>
                      <span className="text-xs text-gray-500">Optional</span>
                    </div>
                    <input
                      type="text"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                      placeholder="/tmp/arthas-mc"
                      value={outputDir}
                      onChange={(e) => setOutputDir(e.target.value)}
                    />
                  </div>

                  <button
                    onClick={handleMc}
                    disabled={loading || !javaPath}
                    className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg font-medium shadow-lg shadow-yellow-500/30 hover:shadow-yellow-500/40 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <>
                        <Play size={18} />
                        Compile with MC
                      </>
                    )}
                  </button>

                  <div className="border-t pt-4">
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 mb-3"
                    >
                      <Settings size={14} />
                      {showAdvanced ? 'Hide MC Options' : 'Show MC Options'}
                      <ChevronRight size={14} className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                    </button>

                    {showAdvanced && (
                      <div className="space-y-3 bg-gray-50 p-3 rounded-lg border">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-medium text-gray-600">Additional MC Options</label>
                            <span className="text-xs text-gray-500">Optional</span>
                          </div>
                          <input
                            type="text"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                            placeholder='-c "javac options" / -O optimize / etc.'
                            value={mcOptions}
                            onChange={(e) => setMcOptions(e.target.value)}
                          />
                          <p className="text-xs text-gray-500 mt-2">
                            Add extra MC compiler options. Example: <code className="bg-gray-200 px-1 rounded">-c "-parameters"</code>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 2: Retransform */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full bg-green-500 text-white text-xs flex items-center justify-center">2</div>
                  <h3 className="font-bold text-gray-700">Apply Retransform</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Compiled Class File
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="relative">
                          <input
                            type="text"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            placeholder="Select or enter class file path"
                            value={classPath}
                            onChange={(e) => setClassPath(e.target.value)}
                          />
                          {classPath && (
                            <button
                              onClick={() => handleCopyPath(classPath)}
                              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                              {copiedPath === classPath ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={handleBrowseClassFile}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
                      >
                        <FolderOpen size={16} />
                        Browse
                      </button>
                    </div>
                    {classPath && (
                      <div className="flex items-center gap-1 mt-1 text-xs">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-gray-600">
                          Ready for retransform: {classPath.split('/').pop()}
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRetransform}
                    disabled={loading || (!classPath && !javaPath)}
                    className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-medium shadow-lg shadow-green-500/30 hover:shadow-green-500/40 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <>
                        <Upload size={18} />
                        Apply Retransform
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Status & Recent Files */}
            <div className="bg-gray-50 p-6 overflow-y-auto">
              {/* Status Messages */}
              {progress && (
                <div className="mb-6">
                  <div className="p-4 rounded-xl border bg-blue-50 border-blue-200 text-blue-800">
                    <div className="flex items-start gap-3">
                      <RefreshCw size={20} className="text-blue-600 mt-0.5 flex-shrink-0 animate-spin" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium">In Progress: Step {progress.step}/4</p>
                          <span className="text-xs font-medium bg-blue-200 text-blue-700 px-2 py-0.5 rounded-full">
                            {Math.round((progress.step / 4) * 100)}%
                          </span>
                        </div>
                        <p className="text-sm mb-1">{progress.status}</p>
                        {progress.details && (
                          <p className="text-xs text-blue-600 break-all font-mono bg-blue-100 px-2 py-1 rounded mt-2">
                            {progress.details}
                          </p>
                        )}
                        <div className="w-full bg-blue-100 rounded-full h-1.5 mt-2">
                          <div 
                            className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" 
                            style={{ width: `${(progress.step / 4) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!progress && status.type && (
                <div className="mb-6">
                  <div className={`p-4 rounded-xl border ${status.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="flex items-start gap-3">
                      {status.type === 'success' ? (
                        <CheckCircle size={20} className="text-green-600 mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={20} className="text-red-600 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-medium mb-1">{status.type === 'success' ? 'Success' : 'Error'}</p>
                        <p className="text-sm break-all mb-2">{status.msg}</p>
                        
                        {/* 错误详情展开按钮 */}
                        {status.type === 'error' && status.details && (
                          <div className="mt-3">
                            <button
                              onClick={() => setShowErrorDetails(!showErrorDetails)}
                              className="flex items-center gap-2 text-xs font-medium text-red-700 hover:text-red-800"
                            >
                              <ChevronRight size={12} className={`transition-transform ${showErrorDetails ? 'rotate-90' : ''}`} />
                              {showErrorDetails ? 'Hide Error Details' : 'Show Error Details'}
                            </button>
                            
                            {showErrorDetails && (
                              <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-medium text-red-700">Error Details:</span>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(status.details || '')
                                      setCopiedPath('error-details')
                                      setTimeout(() => setCopiedPath(null), 2000)
                                    }}
                                    className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1"
                                  >
                                    {copiedPath === 'error-details' ? <Check size={12} /> : <Copy size={12} />}
                                    Copy
                                  </button>
                                </div>
                                <pre className="text-xs font-mono text-red-800 whitespace-pre-wrap break-all bg-red-100 p-2 rounded overflow-auto max-h-64">
                                  {status.details}
                                </pre>
                                <p className="text-xs text-red-600 mt-2">
                                  Check the browser console (F12 → Console) for even more detailed logs.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => setStatus({ type: null, msg: '' })}
                          className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
                        >
                          <X size={16} />
                        </button>
                        {status.type === 'error' && (
                          <button
                            onClick={() => console.error('Full error context:', { status, javaPath, classPath, outputDir, mcOptions })}
                            className="text-xs text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
                            title="Log full error to console"
                          >
                            <Terminal size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    {classPath && (
                      <div className="flex items-center gap-1 mt-1 text-xs">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-gray-600">
                          Ready for retransform: {classPath.split('/').pop()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Recent Files */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-700 flex items-center gap-2">
                    <History size={16} />
                    Recent Files
                  </h3>
                  <span className="text-xs text-gray-500">{recentFiles.length} files</span>
                </div>
                
                {recentFiles.length === 0 ? (
                  <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
                    <FileText size={32} className="text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No recent files</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentFiles.slice(0, 5).map((file, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded-lg border cursor-pointer hover:bg-white ${file.type === 'java' ? 'border-yellow-100 bg-yellow-50' : 'border-green-100 bg-green-50'}`}
                        onClick={() => {
                          if (file.type === 'java') setJavaPath(file.path)
                          else setClassPath(file.path)
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {file.type === 'java' ? (
                              <FileCode size={14} className="text-yellow-600" />
                            ) : (
                              <Layers size={14} className="text-green-600" />
                            )}
                            <span className="text-sm font-medium text-gray-700 truncate">
                              {file.path.split('/').pop() || file.path}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(file.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-1">{file.path}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Workflow Guide */}
              <div className="mb-6 border border-gray-200 bg-white rounded-xl p-4">
                <div className="flex items-center gap-2 text-gray-700 font-bold text-sm mb-3">
                  <ArrowRight size={16} />
                  Complete Workflow Guide
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-yellow-500 text-white text-xs flex items-center justify-center mt-0.5">
                      1
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">Select Java File</p>
                      <p className="text-xs text-gray-500">
                        Use the <span className="font-mono bg-gray-100 px-1 rounded">Browse</span> button to select your modified .java file
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-yellow-500 text-white text-xs flex items-center justify-center mt-0.5">
                      2
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">Compile with MC</p>
                      <p className="text-xs text-gray-500">
                        Click <span className="font-mono bg-yellow-100 px-2 py-0.5 rounded">Compile with MC</span> to compile in memory
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-green-500 text-white text-xs flex items-center justify-center mt-0.5">
                      3
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">Apply Retransform</p>
                      <p className="text-xs text-gray-500">
                        Click <span className="font-mono bg-green-100 px-2 py-0.5 rounded">Apply Retransform</span> to hot-swap the changes at runtime
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center mt-0.5">
                      4
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">Monitor Status</p>
                      <p className="text-xs text-gray-500">
                        Watch the <span className="text-blue-600 font-medium">Active Retransforms</span> tab to see what's currently hot-swapped
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Hot Swap Rules */}
              <div className="border border-blue-100 bg-blue-50 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-2 text-blue-700 font-bold text-sm mb-3">
                  <Shield size={16} />
                  Hot Swap Limitations
                </div>
                <ul className="space-y-2 text-sm text-blue-600">
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-orange-500 mt-0.5 flex-shrink-0" />
                    <span>Cannot add new methods or fields</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-orange-500 mt-0.5 flex-shrink-0" />
                    <span>Only method body modifications are allowed</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-orange-500 mt-0.5 flex-shrink-0" />
                    <span>Class must already be loaded by JVM</span>
                  </li>
                </ul>
              </div>

              {/* Debug & Logs Section */}
              <div className="border border-gray-200 bg-gray-50 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-2 text-gray-700 font-bold text-sm mb-3">
                  <Terminal size={16} />
                  Debug & Logs
                </div>
                <div className="space-y-3 text-sm text-gray-600">
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full bg-yellow-500 mt-1.5 flex-shrink-0"></div>
                    <div>
                      <p className="font-medium">当出现错误时：</p>
                      <ul className="space-y-1 mt-1 pl-2">
                        <li>• 点击错误消息上的 <span className="font-mono bg-gray-200 px-1 rounded">Show Error Details</span></li>
                        <li>• 复制错误详情以便调试</li>
                        <li>• 检查浏览器控制台（按 <span className="font-mono bg-gray-200 px-1 rounded">F12</span> → Console）</li>
                      </ul>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                    <div>
                      <p className="font-medium">常见MC错误：</p>
                      <ul className="space-y-1 mt-1 pl-2">
                        <li>• Java源代码语法错误</li>
                        <li>• 缺少依赖/导入语句</li>
                        <li>• 输出目录权限无效</li>
                        <li>• Java编译器不在PATH中</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* Java 编译错误解决指南 */}
              <div className="border border-purple-100 bg-purple-50 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-2 text-purple-700 font-bold text-sm mb-3">
                  <FileCode size={16} />
                  针对您遇到的错误："变量 productService 未在默认构造器中初始化"
                </div>
                <div className="space-y-4 text-sm text-purple-600">
                  <div>
                    <p className="font-medium mb-2">问题原因：</p>
                    <p className="mb-1">
                      类包含未初始化的成员变量 <code className="bg-purple-200 px-1 rounded">productService</code>，
                      但没有提供显式构造函数来初始化它。
                    </p>
                  </div>
                  
                  <div>
                    <p className="font-medium mb-2">解决方案（选其一）：</p>
                    <div className="space-y-2 ml-2">
                      <div className="flex items-start gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-sm">方案1: 添加构造函数</p>
                          <pre className="text-xs font-mono bg-purple-100 p-2 rounded mt-1 overflow-auto">
{`public class YourClassName {
    private ProductService productService;
    
    // 添加默认构造函数初始化变量
    public YourClassName() {
        this.productService = null; // 或合适的初始值
    }
}`}
                          </pre>
                        </div>
                      </div>
                      
                      <div className="flex items-start gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-sm">方案2: 声明时初始化</p>
                          <pre className="text-xs font-mono bg-purple-100 p-2 rounded mt-1 overflow-auto">
{`public class YourClassName {
    private ProductService productService = null;
    // 或使用合适的初始值
    // private ProductService productService = new ProductServiceImpl();
}`}
                          </pre>
                        </div>
                      </div>
                      
                      <div className="flex items-start gap-2">
                        <div className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-sm">方案3: 使用依赖注入</p>
                          <pre className="text-xs font-mono bg-purple-100 p-2 rounded mt-1 overflow-auto">
{`public class YourClassName {
    private final ProductService productService;
    
    // 通过构造函数注入
    public YourClassName(ProductService productService) {
        this.productService = productService;
    }
}`}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <p className="font-medium mb-2">快速修复步骤：</p>
                    <ol className="space-y-1 ml-2 pl-3 list-decimal">
                      <li>打开您的Java源代码文件</li>
                      <li>找到 <code className="bg-purple-200 px-1 rounded">productService</code> 的声明位置</li>
                      <li>选择上述任一方案修改代码</li>
                      <li>保存文件并重新编译</li>
                    </ol>
                  </div>
                </div>
              </div>

              {/* 更多Java编译错误指南 */}
              <div className="border border-yellow-100 bg-yellow-50 rounded-xl p-4">
                <div className="flex items-center gap-2 text-yellow-700 font-bold text-sm mb-3">
                  <AlertTriangle size={16} />
                  其他常见Java编译错误速查
                </div>
                <div className="space-y-3 text-sm text-yellow-600">
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                    <div>
                      <p className="font-medium">找不到符号 (cannot find symbol)</p>
                      <ul className="space-y-1 mt-1 pl-2">
                        <li>• 检查拼写错误</li>
                        <li>• 确认导入语句正确</li>
                        <li>• 确保依赖在classpath中</li>
                      </ul>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                    <div>
                      <p className="font-medium">语法错误 (illegal start of expression)</p>
                      <ul className="space-y-1 mt-1 pl-2">
                        <li>• 检查缺少的分号</li>
                        <li>• 验证括号匹配 {}、()、[]</li>
                        <li>• 确认语句位置正确</li>
                      </ul>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 flex-shrink-0"></div>
                    <div>
                      <p className="font-medium">缺少return语句 (missing return statement)</p>
                      <ul className="space-y-1 mt-1 pl-2">
                        <li>• 检查所有if/else分支都有return</li>
                        <li>• 或将返回类型改为void</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'retransform' && (
          <div className="h-full p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-gray-800">Active Retransforms</h2>
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full">
                  {retransforms.length} active
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                {selectedRetransforms.size > 0 && (
                  <div className="flex items-center gap-2 mr-4 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                    <span className="text-sm font-medium text-blue-700">{selectedRetransforms.size} selected</span>
                    <button
                      onClick={handleBatchDelete}
                      className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-1"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                )}
                <button
                  onClick={handleExportConfig}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
                >
                  <Download size={16} />
                  Export
                </button>
                <button
                  onClick={handleReadAll}
                  className="px-3 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 flex items-center gap-2"
                >
                  <RefreshCw size={16} />
                  Apply All
                </button>
                <button
                  onClick={fetchRetransforms}
                  className="p-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  <RefreshCw size={18} />
                </button>
              </div>
            </div>

            {retransforms.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center bg-white rounded-2xl border-2 border-dashed border-gray-200">
                <Layers size={48} className="text-gray-300 mb-4" />
                <p className="text-lg font-medium text-gray-500 mb-2">No active retransforms</p>
                <p className="text-sm text-gray-400">Apply a retransform to see it listed here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {retransforms.map((rt) => (
                  <div
                    key={rt.id}
                    className={`bg-white border rounded-xl p-4 hover:shadow-md transition-all ${selectedRetransforms.has(rt.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
                    onClick={() => toggleSelectRetransform(rt.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`flex items-center justify-center w-6 h-6 rounded-full border ${selectedRetransforms.has(rt.id) ? 'bg-blue-500 border-blue-500' : 'bg-white border-gray-300'}`}>
                          {selectedRetransforms.has(rt.id) && (
                            <Check size={12} className="text-white" />
                          )}
                        </div>
                        <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                          <CheckCircle size={18} />
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-700">{rt.className}</h4>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-gray-500 font-mono">ID: {rt.id}</span>
                            <span className="text-xs text-gray-500">Loader: {rt.classLoader}</span>
                            {rt.timestamp && (
                              <span className="text-xs text-gray-500">Applied: {formatDate(rt.timestamp)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(rt.id)
                        }}
                        className="p-2 text-red-400 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    {classPath && (
                      <div className="flex items-center gap-1 mt-1 text-xs">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-gray-600">
                          Ready for retransform: {classPath.split('/').pop()}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="h-full p-6 overflow-y-auto">
            <div className="max-w-2xl mx-auto">
              <h2 className="text-xl font-bold text-gray-800 mb-6">Recently Used Files</h2>
              
              {recentFiles.length === 0 ? (
                <div className="text-center py-12">
                  <FileSearch size={48} className="text-gray-300 mx-auto mb-4" />
                  <p className="text-lg text-gray-500 mb-2">No recent files</p>
                  <p className="text-sm text-gray-400">Start compiling or retransforming to build your history</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentFiles.map((file, index) => (
                    <div
                      key={index}
                      className="p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${file.type === 'java' ? 'bg-yellow-50 text-yellow-600' : 'bg-green-50 text-green-600'}`}>
                          {file.type === 'java' ? <FileCode size={20} /> : <Layers size={20} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="font-medium text-gray-800 truncate">{file.path.split('/').pop() || file.path}</h4>
                            <span className="text-xs text-gray-500">{new Date(file.timestamp).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-gray-500 truncate mb-2">{file.path}</p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (file.type === 'java') {
                                  setJavaPath(file.path)
                                  setActiveTab('compile')
                                } else {
                                  setClassPath(file.path)
                                  setActiveTab('compile')
                                }
                              }}
                              className="text-xs px-3 py-1.5 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg flex items-center gap-1"
                            >
                              <ArrowRight size={12} />
                              Use in Workflow
                            </button>
                            <button
                              onClick={() => handleCopyPath(file.path)}
                              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg flex items-center gap-1"
                            >
                              {copiedPath === file.path ? <Check size={12} /> : <Copy size={12} />}
                              Copy Path
                            </button>
                            {file.type === 'java' && (
                              <button
                                onClick={() => handleMc()}
                                className="text-xs px-3 py-1.5 bg-yellow-100 text-yellow-700 hover:bg-yellow-200 rounded-lg flex items-center gap-1"
                              >
                                <Play size={12} />
                                Compile
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
