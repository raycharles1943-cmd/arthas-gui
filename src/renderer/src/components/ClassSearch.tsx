import { useState, useEffect } from 'react'
import { arthas } from '../utils/arthas'
import { usePersistentState } from '../utils/usePersistentState'
import { Search, FileCode, Layers, Terminal, Copy, CheckCircle, AlertCircle, RefreshCw, X, ExternalLink, BookOpen, Cpu, Shield, Zap } from 'lucide-react'

export function ClassSearch() {
  const [searchQuery, setSearchQuery] = usePersistentState('class_search_query', '')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [selectedClass, setSelectedClass] = useState<string | null>(null)
  const [classDetail, setClassDetail] = useState<any>(null)
  const [methods, setMethods] = useState<any[]>([])
  const [sourceCode, setSourceCode] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'detail' | 'methods' | 'source'>('detail')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [methodFilter, setMethodFilter] = useState<string>('all') // 'all', 'public', 'private', 'static'
  const [filteredMethods, setFilteredMethods] = useState<any[]>([])

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!searchQuery) return
    
    console.log('🚀 开始搜索类:', searchQuery)
    setLoading(true)
    setError(null)
    try {
      console.log('📡 调用 arthas.sc()...')
      const res = await arthas.sc(searchQuery)
      console.log('✅ API返回的数据:', res)
      
      if (!Array.isArray(res)) {
        console.warn('❌ API返回的不是数组:', typeof res, res)
        setResults([])
        setError('API返回格式异常，请检查Arthas连接')
        return
      }
      
      if (res.length === 0) {
        console.warn('⚠️ API返回空数组，未找到类')
        setResults([])
        setError(`未找到匹配 "${searchQuery}" 的类`)
        return
      }
      
      // 打印每个返回项的类型，帮助我们调试
      res.forEach((item, idx) => {
        console.log(`📊 返回项 ${idx}:`, {
          type: item.type,
          hasClassInfo: !!item.classInfo,
          hasClasses: !!item.classes,
          classesCount: item.classes?.length || 0,
          keys: Object.keys(item)
        })
      })
      
      const scResults = res.filter(r => r.type === 'sc')
      console.log(`🔍 筛选出 ${scResults.length} 个type为"sc"的结果`)
      
      if (scResults.length === 0) {
        console.warn('❌ 未找到type为"sc"的结果，所有type:', res.map(r => r.type))
        // 尝试其他可能的type
        const otherTypes = res.filter(r => r.classes)
        if (otherTypes.length > 0) {
          console.log('尝试使用包含classes字段的结果:', otherTypes)
          setResults(otherTypes[0]?.classes || [])
        } else {
          setResults([])
          setError(`未找到匹配 "${searchQuery}" 的类`)
        }
      } else {
        // 新的数据格式：类信息在classInfo字段中
        const classes = scResults
          .filter(r => r.classInfo && r.classInfo.name)
          .map(r => {
            const ci = r.classInfo
            return {
              name: ci.name,
              simpleName: ci.simpleName,
              classLoader: (ci.classloader && ci.classloader[0]) || ci.classLoaderHash,
              location: ci.codeSource,
              codeSource: ci.codeSource,
              modifier: ci.modifier,
              isInterface: ci.interface,
              isAbstract: ci.modifier && (ci.modifier.includes('abstract') || false),
              annotations: ci.annotations || [],
              interfaces: ci.interfaces || [],
              superClass: ci.superClass || [],
              detailed: r.detailed || false
            }
          })
        
        console.log(`📊 找到 ${classes.length} 个类:`, classes.map(c => c.name))
        console.log('解析后的类数据:', classes)
        
        if (classes.length === 0) {
          setError(`找到匹配项但无法解析类信息，API返回格式: ${JSON.stringify(scResults[0])}`)
        }
        
        setResults(classes)
      }
    } catch (err: any) {
      console.error('❌ 搜索类时出错:', err)
      setResults([])
      setError(`搜索失败: ${err?.message || err}。请检查Arthas连接。`)
    } finally {
      setLoading(false)
    }
  }

  const handleClassSelect = async (className: string) => {
    console.log('🚀 选择类:', className)
    setSelectedClass(className)
    setActiveTab('detail')
    setLoading(true)
    setError(null)
    try {
      console.log('📡 并发获取类详情、方法和源码...')
      const [detailRes, methodRes, sourceRes] = await Promise.all([
        arthas.sc(className),
        arthas.sm(className),
        arthas.jad(className)
      ])

      console.log('✅ 详情API返回:', detailRes)
      console.log(`✅ 方法API返回:${JSON.stringify(methodRes)}`)
      console.log('✅ 源码API返回:', sourceRes)

      // 根据新的API格式解析详情
      const scDetail = detailRes.find(r => r.type === 'sc')
      const classInfo = scDetail?.classInfo
      
      // 解析方法数据：根据新的API格式，每个方法是一个数组元素，包含methodInfo字段
      let classMethods = []
      
      // 调试：先打印完整的API返回结构
      console.log('🔍 方法API返回数据完整结构:', methodRes)
      console.log('🔍 方法API数据长度:', methodRes.length)
      console.log('🔍 方法API数据前几个元素:', methodRes.slice(0, 3))
      
      // 找出所有type为'sm'的条目（可能有多个）
      const smResults = methodRes.filter(r => r.type === 'sm')
      console.log(`🔍 找到 ${smResults.length} 个type为"sm"的结果`)
      
      if (smResults.length > 0) {
        // 遍历所有sm结果，提取methodInfo
        smResults.forEach((item, idx) => {
          console.log(`🔍 处理第 ${idx + 1} 个sm结果:`, item)
          if (item.methodInfo) {
            console.log(`🔍 第 ${idx + 1} 个sm结果包含methodInfo:`, item.methodInfo)
            classMethods.push(item.methodInfo)
          }
        })
        
        // 如果没有通过上述方式找到方法，尝试搜索其他格式
        if (classMethods.length === 0) {
          console.log('⚠️ 未从methodInfo字段找到方法，尝试其他格式')
          
          // 尝试直接从结果中查找包含methods字段的对象
          const methodsFromOtherFormat = methodRes.find(r => r.methods)
          if (methodsFromOtherFormat && methodsFromOtherFormat.methods) {
            if (Array.isArray(methodsFromOtherFormat.methods)) {
              classMethods = methodsFromOtherFormat.methods
            } else {
              classMethods = [methodsFromOtherFormat.methods]
            }
          }
        }
      } else {
        console.warn('❌ 未找到type为"sm"的结果，检查所有type:', methodRes.map(r => r.type))
      }
      
      const source = sourceRes.find(r => r.type === 'jad')?.source || 'Failed to decompile class.'

      console.log('📊 classInfo数据:', classInfo)
      console.log('📊 解析后的方法数量:', classMethods.length)
      if (classMethods.length > 0) {
        console.log('📊 解析后的前3个方法:', classMethods.slice(0, 3))
      }
      console.log('📊 解析后的源码长度:', source?.length || 0)

      if (!classInfo || !classInfo.name) {
        console.warn('❌ 未找到类详情，API返回:', scDetail)
        setError(`无法获取类 "${className}" 的详细信息`)
      }

      // 从classInfo构建增强的详情
      const enhancedDetail = {
        name: classInfo?.name || className,
        simpleName: classInfo?.simpleName || className.split('.').pop(),
        classLoader: (classInfo?.classloader && classInfo.classloader[0]) || classInfo?.classLoaderHash,
        location: classInfo?.codeSource,
        codeSource: classInfo?.codeSource,
        modifier: classInfo?.modifier || '',
        
        // 从classInfo提取信息
        isInterface: classInfo?.interface || false,
        isAbstract: classInfo?.modifier && (classInfo.modifier.includes('abstract') || false),
        isFinal: classInfo?.modifier && classInfo.modifier.includes('final') || false,
        isPublic: classInfo?.modifier && classInfo.modifier.includes('public') || false,
        
        // 提取父类信息
        superClass: classInfo?.superClass ? 
          (Array.isArray(classInfo.superClass) && classInfo.superClass.length > 0 ? 
            classInfo.superClass[0] : 
            (typeof classInfo.superClass === 'string' ? classInfo.superClass : parseSuperClass(classInfo.modifier))) 
          : parseSuperClass(classInfo?.modifier),
        
        // 解析接口
        interfacesList: Array.isArray(classInfo?.interfaces) ? classInfo.interfaces : 
                      parseInterfaces(classInfo?.interfaces),
        
        // 其他信息
        annotations: classInfo?.annotations || [],
        isEnum: classInfo?.enum || false,
        isAnnotation: classInfo?.annotation || false,
        isSynthetic: classInfo?.synthetic || false,
        
        // 方法统计
        methodsCount: classMethods.length,
        publicMethodsCount: classMethods.filter(m => m.modifier && m.modifier.includes('public')).length,
        privateMethodsCount: classMethods.filter(m => m.modifier && m.modifier.includes('private')).length,
        staticMethodsCount: classMethods.filter(m => m.modifier && m.modifier.includes('static')).length,
      }

      console.log('✨ 增强后的详情:', enhancedDetail)
      
      setClassDetail(enhancedDetail)
      setMethods(classMethods)
      setSourceCode(source)
    } catch (err: any) {
      console.error('❌ 获取类详情时出错:', err)
      setError(`获取类详情失败: ${err?.message || err}`)
    } finally {
      setLoading(false)
    }
  }

  // 辅助函数：解析父类
  const parseSuperClass = (modifier: string) => {
    if (!modifier) return 'java.lang.Object'
    const superClassMatch = modifier.match(/extends\s+([\w.]+)/)
    return superClassMatch ? superClassMatch[1] : 'java.lang.Object'
  }

  // 辅助函数：解析接口
  const parseInterfaces = (interfaces: string | string[]) => {
    if (!interfaces) return []
    if (Array.isArray(interfaces)) return interfaces
    // 处理字符串形式的接口列表
    if (interfaces.includes(',')) {
      return interfaces.split(/\s*,\s*/).filter(Boolean)
    }
    return [interfaces]
  }

  const [showHistory, setShowHistory] = useState(false)
  const [searchHistory, setSearchHistory] = usePersistentState<{query: string, timestamp: number}[]>('class_search_history', [])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleQuickAction = (action: 'watch' | 'trace' | 'jad' | 'sm', className: string, methodName?: string) => {
    console.log(`Quick action: ${action} on ${className}${methodName ? `.${methodName}` : ''}`)
    // 这里可以添加跳转到其他页面或执行命令的逻辑
    alert(`${action} action triggered for ${className}${methodName ? `.${methodName}` : ''}`)
  }

  // 方法过滤逻辑
  const filterMethods = (methodsList: any[], filterType: string) => {
    if (!methodsList || methodsList.length === 0) return []
    
    switch (filterType) {
      case 'public':
        return methodsList.filter(m => m.modifier && m.modifier.includes('public'))
      case 'private':
        return methodsList.filter(m => m.modifier && m.modifier.includes('private'))
      case 'static':
        return methodsList.filter(m => m.modifier && m.modifier.includes('static'))
      case 'constructors':
        return methodsList.filter(m => m.constructor === true || m.methodName === '<init>')
      case 'cglib':
        return methodsList.filter(m => m.declaringClass && m.declaringClass.includes('CGLIB'))
      case 'original':
        return methodsList.filter(m => !m.declaringClass || !m.declaringClass.includes('CGLIB'))
      default:
        return methodsList
    }
  }
  
  // 统计方法信息
  const getMethodStats = () => {
    if (!methods || methods.length === 0) return {}
    
    const cglibMethods = methods.filter(m => m.declaringClass && m.declaringClass.includes('CGLIB'))
    const originalMethods = methods.filter(m => !m.declaringClass || !m.declaringClass.includes('CGLIB'))
    const publicMethods = methods.filter(m => m.modifier && m.modifier.includes('public'))
    const privateMethods = methods.filter(m => m.modifier && m.modifier.includes('private'))
    const staticMethods = methods.filter(m => m.modifier && m.modifier.includes('static'))
    const constructors = methods.filter(m => m.constructor === true || m.methodName === '<init>')
    
    return {
      total: methods.length,
      cglibCount: cglibMethods.length,
      originalCount: originalMethods.length,
      publicCount: publicMethods.length,
      privateCount: privateMethods.length,
      staticCount: staticMethods.length,
      constructorCount: constructors.length,
    }
  }

  // 使用useEffect更新过滤后的方法列表
  useEffect(() => {
    if (methods && methods.length > 0) {
      const filtered = filterMethods(methods, methodFilter)
      setFilteredMethods(filtered)
      console.log(`🔍 方法过滤: ${methodFilter}, 过滤后数量: ${filtered.length}/${methods.length}`)
    } else {
      setFilteredMethods([])
    }
  }, [methods, methodFilter])

  // 添加搜索到历史记录
  const addToSearchHistory = (query: string) => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return
    
    const newHistory = [
      { query: trimmedQuery, timestamp: Date.now() },
      ...searchHistory.filter(item => item.query !== trimmedQuery)
    ].slice(0, 10) // 只保留最近10条
    
    setSearchHistory(newHistory)
  }

  // 从历史记录中删除
  const removeFromSearchHistory = (query: string) => {
    const newHistory = searchHistory.filter(item => item.query !== query)
    setSearchHistory(newHistory)
  }

  // 清空历史记录
  const clearSearchHistory = () => {
    setSearchHistory([])
  }

  // 搜索处理函数，包括历史记录
  const handleSearchWithHistory = async (e?: React.FormEvent) => {
    if (!searchQuery.trim()) return
    
    addToSearchHistory(searchQuery)
    await handleSearch(e)
  }

  return (
    <div className="flex h-full bg-gray-50">
      {/* Left Sidebar: Search & List */}
      <div className="w-96 border-r bg-white flex flex-col shadow-sm z-10">
        <div className="p-4 border-b bg-gray-50/50">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Class Search</h2>
          <form onSubmit={handleSearchWithHistory} className="relative flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={16} />
              <input
                type="text"
                placeholder="com.example.Service 或 *Service (支持通配符)"
                className="w-full pl-9 pr-8 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white shadow-inner transition-all"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (e.target.value.trim()) {
                    setShowHistory(true)
                  }
                }}
                onFocus={() => {
                  if (searchHistory.length > 0) {
                    setShowHistory(true)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchWithHistory(e)
                  }
                }}
              />
              {searchHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  title="搜索历史"
                >
                  👇
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={loading || !searchQuery.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2 shrink-0"
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
              {loading ? 'Searching...' : 'Search'}
            </button>
          </form>
          
          {/* Arthas连接测试和调试按钮 */}
          <div className="mt-3 flex justify-between items-center">
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  console.log('🛠️ 测试Arthas连接...')
                  try {
                    const testRes = await arthas.version()
                    console.log('✅ Arthas连接成功，版本:', testRes)
                    alert(`✅ Arthas连接成功!
返回数据: ${JSON.stringify(testRes, null, 2)}`)
                  } catch (err: any) {
                    console.error('❌ Arthas连接失败:', err)
                    alert(`❌ Arthas连接失败: ${err?.message || err}
请确认:
1. Arthas服务是否已启动
2. 端口8563是否可访问`)
                  }
                }}
                className="text-xs text-gray-500 hover:text-blue-600 hover:underline"
                title="测试Arthas连接"
              >
                🔗 测试连接
              </button>
              <button
                onClick={() => {
                  // 模拟API返回的测试数据（基于实际API格式）
                  console.log('🐞 注入测试数据用于调试')
                  const testData = [
                    {
                      name: 'com.waimao.service.ProductService',
                      simpleName: 'ProductService',
                      classLoader: 'sun.misc.Launcher$AppClassLoader@18b4aac2',
                      location: '/F:/aidengwang/waimao/waimao-backend/target/classes/',
                      codeSource: '/F:/aidengwang/waimao/waimao-backend/target/classes/',
                      modifier: 'public',
                      isInterface: false,
                      isAbstract: false,
                      isEnum: false,
                      isFinal: false,
                      isPublic: true,
                      annotations: ['org.springframework.stereotype.Service'],
                      interfaces: [],
                      superClass: ['java.lang.Object']
                    }
                  ]
                  console.log('注入测试数据:', testData)
                  setResults(testData)
                  alert('✅ 已注入测试数据，现在可以点击列表中的类进行测试')
                }}
                className="text-xs text-purple-500 hover:text-purple-600 hover:underline"
                title="注入测试数据"
              >
                🐞 注入测试
              </button>
            </div>
            <button
              onClick={() => {
                setSearchQuery('')
                setResults([])
                setSelectedClass(null)
                setClassDetail(null)
                console.log('🧹 清空所有状态')
              }}
              className="text-xs text-gray-500 hover:text-red-600 hover:underline"
              title="清空搜索"
            >
              🧹 清空
            </button>
          </div>
          
          {/* 历史记录面板 */}
          {showHistory && searchHistory.length > 0 && (
            <div className="mt-3 bg-white border border-gray-200 rounded-lg shadow-lg">
              <div className="flex items-center justify-between p-3 border-b">
                <div className="text-xs font-medium text-gray-500 flex items-center gap-1">
                  <span>📜</span>
                  最近搜索历史
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={clearSearchHistory}
                    className="text-xs text-red-400 hover:text-red-600 hover:underline"
                    title="清空历史记录"
                  >
                    清空
                  </button>
                  <button
                    onClick={() => setShowHistory(false)}
                    className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
                  >
                    关闭
                  </button>
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto">
                {searchHistory.map((item, idx) => (
                  <div 
                    key={item.timestamp} 
                    className={`flex items-center justify-between px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0 ${idx === 0 ? 'bg-blue-50/30' : ''}`}
                  >
                    <button
                      onClick={() => {
                        setSearchQuery(item.query)
                        setShowHistory(false)
                        handleSearchWithHistory()
                      }}
                      className="flex-1 text-left text-sm text-gray-700 hover:text-blue-600 hover:underline"
                      title={`点击搜索: ${item.query}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 w-4 text-right">#{searchHistory.length - idx}</span>
                        <span className="truncate">{item.query}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </div>
                    </button>
                    <button
                      onClick={() => removeFromSearchHistory(item.query)}
                      className="text-xs text-gray-400 hover:text-red-500 p-1 ml-2"
                      title="删除此项"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && results.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <RefreshCw size={20} className="animate-spin text-blue-500" />
              <p className="font-medium text-gray-600">正在搜索 "{searchQuery}"...</p>
              <p className="text-xs text-gray-400 max-w-xs mt-1">
                请稍候，正在查询Arthas服务
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <Search size={24} className="opacity-20" />
              <p className="font-medium text-gray-600">
                {error ? '搜索失败' : '等待搜索'}
              </p>
              <p className="text-xs text-gray-400 max-w-xs mt-1">
                {error ? (
                  <span className="text-red-400">{error}</span>
                ) : (
                  <>
                    支持完整类名 (com.example.Service) 或<br/>通配符搜索 (*Service, com.*.Service)
                  </>
                )}
              </p>
              {!error && (
                <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100 text-left">
                  <p className="text-xs font-medium text-blue-800 mb-1">使用步骤：</p>
                  <ol className="text-xs text-blue-600 space-y-1 pl-4 list-decimal">
                    <li>输入类名（如 com.waimao.service.ProductService）</li>
                    <li>点击 "Search" 按钮或按 Enter 键</li>
                    <li>从搜索结果列表中选择类</li>
                    <li>查看类详情、方法和源码</li>
                  </ol>
                </div>
              )}
              {error && (
                <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100 text-left">
                  <p className="text-xs font-medium text-red-800 mb-1">故障排除：</p>
                  <ul className="text-xs text-red-600 space-y-1 pl-4 list-disc">
                    <li>点击上方的 "🔗 测试连接" 检查Arthas服务</li>
                    <li>确认类是否已加载到JVM中</li>
                    <li>检查网络连接和Arthas服务状态</li>
                    <li>尝试更通用的搜索模式（如 *Service）</li>
                  </ul>
                </div>
              )}
            </div>
          ) : (
            results.map((c, idx) => (
              <button
                key={`${c.name}-${idx}`}
                onClick={() => handleClassSelect(c.name)}
                className={`w-full text-left px-3 py-3 rounded-lg text-sm transition-all hover:bg-blue-50 border border-transparent hover:border-blue-100 ${
                  selectedClass === c.name 
                    ? 'bg-blue-600 text-white shadow-md transform scale-[1.02] border-blue-500' 
                    : ''
                } group`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-1.5 rounded-md ${selectedClass === c.name ? 'bg-blue-500/20' : 'bg-gray-100'}`}>
                    <Layers size={14} className={selectedClass === c.name ? 'text-blue-100' : 'text-gray-500'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold truncate" title={c.simpleName || c.name.split('.').pop()}>
                        {c.simpleName || c.name.split('.').pop()}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {c.location && (
                          <span className={`text-[9px] px-1 py-0.5 rounded ${selectedClass === c.name ? 'bg-blue-400/30 text-blue-100' : 'bg-gray-100 text-gray-500'}`} title="位置">
                            {c.location.includes('.jar') || c.location.includes('.jar/') ? 'JAR' : 'DIR'}
                          </span>
                        )}
                        {c.isInterface && (
                          <span className={`text-[9px] px-1 py-0.5 rounded ${selectedClass === c.name ? 'bg-blue-400/30 text-blue-100' : 'bg-blue-50 text-blue-600'}`} title="接口">
                            Interface
                          </span>
                        )}
                        {c.isEnum && (
                          <span className={`text-[9px] px-1 py-0.5 rounded ${selectedClass === c.name ? 'bg-blue-400/30 text-blue-100' : 'bg-purple-50 text-purple-600'}`} title="枚举">
                            Enum
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={`text-xs ${selectedClass === c.name ? 'text-blue-200' : 'text-gray-500'} truncate`} title={c.name}>
                      {c.name}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.classLoader && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${selectedClass === c.name ? 'bg-blue-400/20 text-blue-100' : 'bg-gray-100 text-gray-500'}`} title="类加载器">
                          CL: {typeof c.classLoader === 'string' ? 
                            (c.classLoader.split('/').slice(-1)[0] || 
                            c.classLoader.split('@').slice(-1)[0] || 
                            c.classLoader.substring(0, 20)) 
                            : 'System'}
                        </span>
                      )}
                      {c.codeSource && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${selectedClass === c.name ? 'bg-blue-400/20 text-blue-100' : 'bg-green-50 text-green-600'}`} title="代码源">
                          Source
                        </span>
                      )}
                      {c.annotations && c.annotations.length > 0 && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${selectedClass === c.name ? 'bg-blue-400/20 text-blue-100' : 'bg-yellow-50 text-yellow-600'}`} title={`注解: ${c.annotations.join(', ')}`}>
                          @{c.annotations.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Content: Details */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {selectedClass ? (
          <>
            <div className="px-6 py-4 bg-white border-b flex items-center justify-between sticky top-0 z-20 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                  <FileCode size={20} />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-gray-800 truncate" title={selectedClass}>{selectedClass}</h1>
                  <p className="text-xs text-gray-500 truncate">
                    {classDetail?.classLoader || 
                     (classDetail?.classLoaderHash ? `ClassLoaderHash: ${classDetail.classLoaderHash}` : 'Unknown ClassLoader')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-1 p-1 bg-gray-100 rounded-lg shrink-0">
                  <TabButton active={activeTab === 'detail'} onClick={() => setActiveTab('detail')} icon={<Layers size={14} />} label="Info" />
                  <TabButton active={activeTab === 'methods'} onClick={() => setActiveTab('methods')} icon={<Terminal size={14} />} label="Methods" />
                  <TabButton active={activeTab === 'source'} onClick={() => setActiveTab('source')} icon={<FileCode size={14} />} label="Source" />
                </div>
                {/* Quick Actions */}
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleQuickAction('watch', selectedClass)}
                    className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-xs font-medium hover:bg-green-200 transition-colors flex items-center gap-1"
                    title="Watch this class"
                  >
                    <Zap size={12} />
                    Watch
                  </button>
                  <button
                    onClick={() => handleQuickAction('trace', selectedClass)}
                    className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-200 transition-colors flex items-center gap-1"
                    title="Trace this class"
                  >
                    <Cpu size={12} />
                    Trace
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-white">
              {loading && !classDetail ? (
                <div className="p-12 text-center text-gray-400 flex flex-col items-center gap-3">
                  <RefreshCw size={24} className="animate-spin text-blue-500" />
                  Loading class info...
                </div>
              ) : activeTab === 'detail' ? (
                <div className="p-6 max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  {/* 概览卡片组 */}
                  <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <OverviewCard
                      title="Class Name"
                      value={classDetail?.name?.split('.').pop() || ''}
                      subtitle={classDetail?.name}
                      onCopy={() => copyToClipboard(classDetail?.name)}
                      copyable
                    />
                    <OverviewCard
                      title="Class Type"
                      value={classDetail?.isInterface ? 'Interface' : classDetail?.isAbstract ? 'Abstract Class' : 'Concrete Class'}
                      subtitle={classDetail?.modifier}
                      chip={classDetail?.isPublic ? 'Public' : 'Package'}
                      chipColor={classDetail?.isPublic ? 'green' : 'gray'}
                    />
                    <OverviewCard
                      title="ClassLoader"
                      value={classDetail?.classLoader?.split('@')?.[0]?.split('/').pop() || 'System'}
                      subtitle={classDetail?.classLoader}
                      onCopy={() => copyToClipboard(classDetail?.classLoader)}
                      copyable
                    />
                    <OverviewCard
                      title="Code Source"
                      value={classDetail?.codeSource ? 'Available' : 'N/A'}
                      subtitle={classDetail?.codeSource}
                      onCopy={() => copyToClipboard(classDetail?.codeSource)}
                      copyable
                    />
                    <OverviewCard
                      title="Annotations"
                      value={classDetail?.annotations?.length > 0 ? `${classDetail.annotations.length} 个` : '无'}
                      subtitle={classDetail?.annotations?.join(', ')}
                      chip={classDetail?.annotations?.length > 0 ? '有注解' : '无注解'}
                      chipColor={classDetail?.annotations?.length > 0 ? 'purple' : 'gray'}
                    />
                  </section>

                  {/* 继承关系与方法统计 */}
                  <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-50 rounded-xl p-5 border">
                      <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center gap-2">
                        <span>继承关系</span>
                        <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">Hierarchy</span>
                      </h3>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          <div className="font-medium">当前类</div>
                          <div className="font-mono text-sm text-gray-700 truncate flex-1">{classDetail?.name}</div>
                        </div>
                        {classDetail?.superClass && 
                         (Array.isArray(classDetail.superClass) ? classDetail.superClass.length > 0 : classDetail.superClass !== 'java.lang.Object') && (
                          <>
                            <div className="relative ml-5">
                              <div className="absolute left-0 top-0 bottom-0 w-px bg-gray-300"></div>
                              <div className="flex items-center gap-2 py-2">
                                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                                <div className="font-medium">父类</div>
                                <div className="font-mono text-sm text-gray-700 truncate flex-1">
                                  {Array.isArray(classDetail.superClass) ? 
                                    (classDetail.superClass[0] || 'java.lang.Object') : 
                                    classDetail.superClass}
                                </div>
                                <button 
                                  onClick={() => handleClassSelect(
                                    Array.isArray(classDetail.superClass) ? 
                                      (classDetail.superClass[0] || 'java.lang.Object') : 
                                      classDetail.superClass
                                  )}
                                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  查看
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                        {(!classDetail?.superClass || 
                          (Array.isArray(classDetail.superClass) && classDetail.superClass.length === 0) || 
                          (Array.isArray(classDetail.superClass) && classDetail.superClass[0] === 'java.lang.Object') ||
                          classDetail.superClass === 'java.lang.Object') && (
                          <div className="relative ml-5">
                            <div className="absolute left-0 top-0 bottom-0 w-px bg-gray-300"></div>
                            <div className="flex items-center gap-2 py-2">
                              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
                              <div className="font-medium">根父类</div>
                              <div className="font-mono text-sm text-gray-500 truncate flex-1">java.lang.Object</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 方法统计 */}
                    <div className="bg-gray-50 rounded-xl p-5 border">
                      <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center gap-2">
                        <span>方法统计</span>
                        <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">{methods.length} Methods</span>
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        <StatCard label="总共" value={classDetail?.methodsCount || 0} color="blue" />
                        <StatCard label="公有" value={classDetail?.publicMethodsCount || 0} color="green" />
                        <StatCard label="私有" value={classDetail?.privateMethodsCount || 0} color="red" />
                        <StatCard label="静态" value={classDetail?.staticMethodsCount || 0} color="purple" />
                      </div>
                      {/* CGLIB代理统计 */}
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="text-xs text-gray-500 mb-2">CGLIB代理统计</div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-orange-400"></div>
                            <span className="text-xs text-gray-600">CGLIB代理方法</span>
                          </div>
                          <span className="text-xs font-semibold text-orange-600">{getMethodStats().cglibCount || 0}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-teal-400"></div>
                            <span className="text-xs text-gray-600">原始类方法</span>
                          </div>
                          <span className="text-xs font-semibold text-teal-600">{getMethodStats().originalCount || 0}</span>
                        </div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">方法类型分布</div>
                        <div className="flex items-center">
                          <div className="flex-1 h-2 rounded-full overflow-hidden bg-gray-300">
                            {methods.length > 0 && (
                              <>
                                <div 
                                  className="h-full bg-blue-500" 
                                  style={{ width: `${100 * (classDetail?.publicMethodsCount || 0) / methods.length}%` }}
                                  title="公有方法"
                                />
                                <div 
                                  className="h-full bg-red-500"
                                  style={{ width: `${100 * (classDetail?.privateMethodsCount || 0) / methods.length}%` }}
                                  title="私有方法"
                                />
                                <div 
                                  className="h-full bg-green-500"
                                  style={{ width: `${100 * (classDetail?.staticMethodsCount || 0) / methods.length}%` }}
                                  title="其他方法"
                                />
                              </>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 ml-2">{methods.length}</div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* 接口实现 */}
                  {classDetail?.interfacesList && classDetail.interfacesList.length > 0 && (
                    <section className="bg-indigo-50/50 rounded-xl p-5 border border-indigo-100">
                      <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center gap-2">
                        <span>实现接口</span>
                        <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{classDetail.interfacesList.length} Interfaces</span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {classDetail.interfacesList.map((i: string, idx: number) => (
                          <div key={idx} className="group flex items-center justify-between bg-white border border-indigo-100 rounded-lg p-3 hover:bg-indigo-50 transition-colors">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-indigo-400"></div>
                              <span className="font-mono text-sm text-gray-800 truncate" title={i}>{i}</span>
                            </div>
                            <button 
                              onClick={() => handleClassSelect(i)}
                              className="opacity-0 group-hover:opacity-100 text-xs text-indigo-600 hover:text-indigo-800 hover:underline transition-opacity"
                            >
                              查看
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 注解信息 */}
                  {classDetail?.annotations && classDetail.annotations.length > 0 && (
                    <section className="bg-purple-50/50 rounded-xl p-5 border border-purple-100">
                      <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center gap-2">
                        <span>类注解</span>
                        <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">{classDetail.annotations.length} Annotations</span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {classDetail.annotations.map((annotation: string, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 bg-white border border-purple-100 rounded-lg p-3">
                            <div className="w-2 h-2 rounded-full bg-purple-400"></div>
                            <span className="font-mono text-sm text-gray-800 truncate" title={annotation}>
                              {annotation.replace('@', '')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : activeTab === 'methods' ? (
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b sticky top-0 z-10">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Methods {filteredMethods.length}{methodFilter !== 'all' ? ` / ${methods.length}` : ''}
                    </div>
                    <div className="flex gap-1">
                      <button 
                        onClick={() => setMethodFilter('all')}
                        className={`text-xs px-2 py-1 rounded ${methodFilter === 'all' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
                      >
                        全部
                      </button>
                      <button 
                        onClick={() => setMethodFilter('public')}
                        className={`text-xs px-2 py-1 rounded ${methodFilter === 'public' ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
                      >
                        公有
                      </button>
                      <button 
                        onClick={() => setMethodFilter('private')}
                        className={`text-xs px-2 py-1 rounded ${methodFilter === 'private' ? 'bg-red-100 text-red-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
                      >
                        私有
                      </button>
                      <button 
                        onClick={() => setMethodFilter('static')}
                        className={`text-xs px-2 py-1 rounded ${methodFilter === 'static' ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
                      >
                        静态
                      </button>
                      <button 
                        onClick={() => setMethodFilter('constructors')}
                        className={`text-xs px-2 py-1 rounded ${methodFilter === 'constructors' ? 'bg-yellow-100 text-yellow-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
                      >
                        构造器
                      </button>
                      <button 
                        onClick={() => setMethodFilter('cglib')}
                        className={`text-xs px-2 py-1 rounded ${methodFilter === 'cglib' ? 'bg-orange-100 text-orange-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
                      >
                        CGLIB
                      </button>
                      <button 
                        onClick={() => setMethodFilter('original')}
                        className={`text-xs px-2 py-1 rounded ${methodFilter === 'original' ? 'bg-teal-100 text-teal-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
                      >
                        原始
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-12 px-4 py-2 bg-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b">
                    <div className="col-span-7">Method Details</div>
                    <div className="col-span-3 text-right">Type & Modifiers</div>
                    <div className="col-span-2 text-right">Actions</div>
                  </div>
                  {filteredMethods.map((m, idx) => (
                    <div key={idx} className="grid grid-cols-12 px-4 py-3 items-center hover:bg-blue-50 rounded-lg transition-colors group border-b border-gray-50 last:border-0">
                      <div className="col-span-7 flex flex-col gap-0.5">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-gray-800">{m.methodName}</span>
                          {m.constructor && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-600 rounded-full font-medium">
                              构造器
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-gray-400">
                          {m.parameters && Array.isArray(m.parameters) && m.parameters.length > 0 ? (
                            <div className="flex flex-wrap gap-1 items-center mt-0.5">
                              <span className="text-gray-500">参数:</span>
                              {m.parameters.map((param: string, pIdx: number) => (
                                <span key={pIdx} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">
                                  {param.split('.').pop()}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-gray-400 text-xs italic">无参数</div>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1 truncate" title={m.descriptor}>
                          {m.descriptor}
                        </div>
                        {m.declaringClass && m.declaringClass !== selectedClass && (
                          <div className="text-[9px] text-orange-500 mt-0.5 truncate" title={`声明类: ${m.declaringClass}`}>
                            [{m.declaringClass.includes('CGLIB') ? 'CGLIB代理' : '父类'}]
                          </div>
                        )}
                        {m.returnType && (
                          <div className="text-[9px] text-blue-500 mt-0.5" title={`返回类型: ${m.returnType}`}>
                            返回: {m.returnType.split('.').pop()}
                          </div>
                        )}
                      </div>
                      <div className="col-span-3 text-right">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${getModifierColor(m.modifier)}`}>
                            {m.modifier}
                          </span>
                          {m.classLoaderHash && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded" title={`类加载器: ${m.classLoaderHash}`}>
                              CLH
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2 text-right">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => handleQuickAction('watch', selectedClass, m.methodName)}
                            className="text-[10px] px-2 py-0.5 bg-green-100 text-green-600 rounded hover:bg-green-200"
                            title="Watch method"
                          >
                            W
                          </button>
                          <button 
                            onClick={() => handleQuickAction('trace', selectedClass, m.methodName)}
                            className="text-[10px] px-2 py-0.5 bg-purple-100 text-purple-600 rounded hover:bg-purple-200"
                            title="Trace method"
                          >
                            T
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative h-full bg-[#1e1e1e]">
                  <div className="absolute top-4 right-6 z-10 flex items-center gap-2">
                    <button 
                      onClick={() => copyToClipboard(sourceCode)}
                      className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors flex items-center gap-2 text-xs font-medium border border-white/10"
                    >
                      {copied ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
                      {copied ? '已复制!' : '复制源码'}
                    </button>
                  </div>
                  <pre className="p-8 font-mono text-sm text-gray-300 leading-relaxed overflow-auto h-full">
                    {sourceCode}
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-white">
            <div className="p-8 bg-gray-50 rounded-full mb-6">
              <Terminal size={48} className="opacity-20" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">未选择类</h2>
            <p className="max-w-xs text-center text-sm">从左侧搜索结果中选择一个类，查看详情并反编译代码。</p>
          </div>
        )}

        {/* Floating Error Notification */}
{error && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-6 py-4 bg-red-600 text-white rounded-xl shadow-2xl animate-in fade-in zoom-in-95 max-w-lg z-50">
          <AlertCircle size={20} />
          <div className="flex-1">
            <p className="font-medium">{error}</p>
            <p className="text-sm opacity-80 mt-1">
              请点击左侧"🔗 测试连接"检查Arthas服务状态
            </p>
          </div>
          <button onClick={() => setError(null)} className="ml-2 hover:bg-white/20 p-1 rounded">
            <X size={16} />
          </button>
        </div>
      )}
      
      {/* 连接状态指示器 */}
      {!selectedClass && !error && !loading && (
        <div className="absolute bottom-4 right-4 bg-white/80 backdrop-blur-sm rounded-lg p-3 shadow-lg border">
          <p className="text-xs font-medium text-gray-700 mb-1">连接状态</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
            <span className="text-xs text-gray-500">等待搜索</span>
            <button
              onClick={async () => {
                try {
                  await arthas.version()
                  alert('✅ Arthas连接正常')
                } catch (err) {
                  alert('❌ Arthas连接失败')
                }
              }}
              className="text-xs text-blue-500 hover:text-blue-700 hover:underline ml-2"
            >
              状态检查
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
        active 
          ? 'bg-white text-blue-600 shadow-sm' 
          : 'text-gray-500 hover:text-gray-800'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function OverviewCard({ title, value, subtitle, chip, chipColor = 'gray', copyable = false, onCopy }: any) {
  const getChipColorClass = () => {
    switch (chipColor) {
      case 'green': return 'bg-green-100 text-green-700';
      case 'blue': return 'bg-blue-100 text-blue-700';
      case 'red': return 'bg-red-100 text-red-700';
      case 'purple': return 'bg-purple-100 text-purple-700';
      case 'gray':
      default: return 'bg-gray-100 text-gray-600';
    }
  }

  return (
    <div className="group p-5 bg-gray-50 rounded-xl border border-transparent hover:border-blue-100 hover:bg-blue-50/30 transition-all relative">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{title}</p>
      <div className="flex items-baseline gap-2">
        <p className="font-semibold text-gray-800 text-lg truncate">{value}</p>
        {chip && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${getChipColorClass()}`}>
            {chip}
          </span>
        )}
      </div>
      {subtitle && (
        <p className="mt-1 text-xs text-gray-500 truncate" title={subtitle}>
          {subtitle}
        </p>
      )}
      {copyable && value && (
        <button 
          onClick={onCopy}
          className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-all"
          title="复制"
        >
          <Copy size={14} />
        </button>
      )}
    </div>
  )
}

function StatCard({ label, value, color = 'blue' }: any) {
  const getColorClass = () => {
    switch (color) {
      case 'green': return 'bg-green-400/20 text-green-600 border-green-200';
      case 'red': return 'bg-red-400/20 text-red-600 border-red-200';
      case 'purple': return 'bg-purple-400/20 text-purple-600 border-purple-200';
      case 'blue':
      default: return 'bg-blue-400/20 text-blue-600 border-blue-200';
    }
  }

  return (
    <div className={`p-3 rounded-lg border ${getColorClass()} `}>
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  )
}

function getModifierColor(modifier: string) {
  if (!modifier) return 'bg-gray-100 text-gray-600'
  if (modifier.includes('public')) return 'bg-green-100 text-green-700'
  if (modifier.includes('private')) return 'bg-red-100 text-red-700'
  if (modifier.includes('protected')) return 'bg-yellow-100 text-yellow-700'
  if (modifier.includes('static')) return 'bg-blue-100 text-blue-700'
  if (modifier.includes('abstract')) return 'bg-purple-100 text-purple-700'
  return 'bg-gray-100 text-gray-600'
}

// 保留原有的 InfoCard 组件（虽然现在可能用不到，但保留以防万一）
function InfoCard({ title, value, onCopy }: any) {
  return (
    <div className="group p-5 bg-gray-50 rounded-xl border border-transparent hover:border-blue-100 hover:bg-blue-50/30 transition-all relative">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{title}</p>
      <p className="font-mono text-sm text-gray-800 break-all leading-relaxed">{value || 'N/A'}</p>
      {onCopy && value && (
        <button 
          onClick={onCopy}
          className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-all"
        >
          <Copy size={14} />
        </button>
      )}
    </div>
  )
}