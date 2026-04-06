import { useState, useEffect } from 'react'
import { arthas } from '../utils/arthas'
import { usePersistentState } from '../utils/usePersistentState'
import { Terminal, Play, Search, Filter, History, Trash2, Clock, ChevronRight, ChevronDown, Code, RefreshCw, X, Save, Bookmark, Eye, EyeOff, Download, Upload, BarChart3, Hash, Filter as FilterIcon, Zap, BookOpen, Database, BarChart, TrendingUp, PieChart, Activity, Cpu, AlertTriangle, CheckCircle } from 'lucide-react'

interface DiagnosisRecord {
  id: string
  time: string
  timestamp: number
  type: 'watch'
  target: string
  className: string
  methodName: string
  expression: string
  condition: string
  invocationCount: number
  results: any[]
}

interface WatchConfig {
  id: string
  name: string
  className: string
  methodName: string
  expression: string
  condition: string
  invocationLimit: number
  expandedLevel: number
  timestamp: number
}

export function Diagnostics() {
  // 表单状态
  const [className, setClassName] = usePersistentState('diag_class_name', '')
  const [methodName, setMethodName] = usePersistentState('diag_method_name', '')
  const [expression, setExpression] = usePersistentState('diag_expression', '{params, returnObj, throwExp}')
  const [condition, setCondition] = usePersistentState('diag_condition', '')
  const [invocationLimit, setInvocationLimit] = usePersistentState('diag_invocation_limit', '10')
  const [expandedLevel, setExpandedLevel] = usePersistentState('diag_expanded_level', '2')
  
  // UI 状态
  const [isRunning, setIsRunning] = useState(false)
  const [records, setRecords] = useState<DiagnosisRecord[]>([])
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null)
  const [configs, setConfigs] = useState<WatchConfig[]>([])
  const [activeConfig, setActiveConfig] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showMethods, setShowMethods] = useState(false)
  const [methods, setMethods] = useState<string[]>([])
  const [showSavedConfigs, setShowSavedConfigs] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showSaveConfigModal, setShowSaveConfigModal] = useState(false)
  const [newConfigName, setNewConfigName] = useState('')
  
  // 自动查询类的方法
  useEffect(() => {
    if (!className) {
      setMethods([])
      setShowMethods(false)
      return
    }
    
    const timer = setTimeout(async () => {
      try {
        const results = await arthas.sc(className)
        const methodsResult = results.find(r => r.type === 'sc')
        if (methodsResult && methodsResult.methods) {
          setMethods(methodsResult.methods)
          setShowMethods(true)
        } else {
          setMethods([])
        }
      } catch (err) {
        console.warn('Failed to fetch class methods:', err)
        setMethods([])
      }
    }, 500)
    
    return () => clearTimeout(timer)
  }, [className])
  
  // 加载保存的配置
  useEffect(() => {
    const savedConfigs = localStorage.getItem('watch_configs')
    if (savedConfigs) {
      try {
        setConfigs(JSON.parse(savedConfigs))
      } catch (err) {
        console.error('Failed to load saved configs:', err)
      }
    }
  }, [])
  
  const handleStart = async () => {
    if (!className || !methodName) return
    
    setIsRunning(true)
    try {
      const res = await arthas.watch(className, methodName, expression, condition, parseInt(invocationLimit) || 10)
      console.log(`res:${JSON.stringify(res)}`);
      const newRecord: DiagnosisRecord = {
        id: Date.now().toString(),
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        type: 'watch',
        target: `${className.split('.').pop()}.${methodName}`,
        className,
        methodName,
        expression,
        condition,
        invocationCount: parseInt(invocationLimit) || 10,
        results: res.filter(r => r.type === 'watch')
      }
      
      setRecords([newRecord, ...records.slice(0, 49)]) // 最多保留50条记录
      setExpandedRecord(newRecord.id)
    } catch (err) {
      console.error('Diagnosis failed:', err)
    } finally {
      setIsRunning(false)
    }
  }
  
  const openSaveConfigModal = () => {
    setNewConfigName(`${className.split('.').pop()}.${methodName}`)
    setShowSaveConfigModal(true)
  }

  const saveCurrentConfig = () => {
    const configName = newConfigName.trim()
    if (!configName) return
    
    const newConfig: WatchConfig = {
      id: Date.now().toString(),
      name: configName,
      className,
      methodName,
      expression,
      condition,
      invocationLimit: parseInt(invocationLimit) || 10,
      expandedLevel: parseInt(expandedLevel) || 2,
      timestamp: Date.now()
    }
    
    const updatedConfigs = [newConfig, ...configs.filter(c => c.name !== configName).slice(0, 9)] // 最多保留10个配置
    setConfigs(updatedConfigs)
    setActiveConfig(newConfig.id)
    localStorage.setItem('watch_configs', JSON.stringify(updatedConfigs))
    setShowSaveConfigModal(false)
    setNewConfigName('')
  }

  const cancelSaveConfig = () => {
    setShowSaveConfigModal(false)
    setNewConfigName('')
  }
  
  const loadConfig = (config: WatchConfig) => {
    setClassName(config.className)
    setMethodName(config.methodName)
    setExpression(config.expression)
    setCondition(config.condition)
    setInvocationLimit(config.invocationLimit.toString())
    setExpandedLevel(config.expandedLevel.toString())
    setActiveConfig(config.id)
  }
  
  const deleteConfig = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updatedConfigs = configs.filter(c => c.id !== id)
    setConfigs(updatedConfigs)
    localStorage.setItem('watch_configs', JSON.stringify(updatedConfigs))
    if (activeConfig === id) {
      setActiveConfig(null)
    }
  }
  
  const clearAllRecords = () => {
    if (confirm('Are you sure you want to clear all diagnosis records?')) {
      setRecords([])
    }
  }
  
  // 显示模式切换
  const [displayMode, setDisplayMode] = useState<'simple' | 'verbose' | 'hierarchical' | 'java'>('java')
  
  // 计算统计信息
  const getStats = () => {
    if (records.length === 0) return null
    
    const totalInvocations = records.reduce((sum, record) => sum + (record.results.length || 0), 0)
    const uniqueMethods = new Set(records.map(r => r.target)).size
    const avgResultsPerWatch = totalInvocations / records.length
    
    // 计算数据大小和分析
    let totalDataSize = 0
    let maxDataRecord = null
    let maxDataSize = 0
    let hasExceptions = false
    
    records.forEach(record => {
      record.results.forEach(result => {
        const dataStr = JSON.stringify(result.details || {})
        const dataSize = new Blob([dataStr]).size
        
        totalDataSize += dataSize
        if (dataSize > maxDataSize) {
          maxDataSize = dataSize
          maxDataRecord = record
        }
        
        // 检查是否有异常
        if (result.details?.throwExp) {
          hasExceptions = true
        }
      })
    })
    
    // 计算热门方法和最近活动
    const methodCallCounts: Record<string, number> = {}
    records.forEach(record => {
      methodCallCounts[record.target] = (methodCallCounts[record.target] || 0) + record.results.length
    })
    
    const topMethods = Object.entries(methodCallCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([method, count]) => `${method} (${count} calls)`)
    
    return {
      totalRecords: records.length,
      totalInvocations,
      uniqueMethods,
      avgResultsPerWatch: avgResultsPerWatch.toFixed(2),
      latestRecordTime: records[0]?.time || 'N/A',
      totalDataSize: (totalDataSize / 1024).toFixed(2), // KB
      maxDataSize: (maxDataSize / 1024).toFixed(2), // KB
      maxDataMethod: maxDataRecord?.target || 'N/A',
      hasExceptions,
      topMethods,
      dataDensity: totalInvocations > 0 ? (totalDataSize / totalInvocations / 1024).toFixed(2) : '0.00' // KB per invocation
    }
  }

  // 渲染结果内容的函数
  const renderResultContent = (result: any, record: DiagnosisRecord) => {
    const value = result.value || '';
    const otherData = { ...result };
    delete otherData.value;
    
    // 根据不同显示模式渲染
    switch (displayMode) {
      case 'simple':
        return (
          <div className="space-y-3">
            {/* 主要value字段 */}
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></div>
                  <p className="text-xs font-bold text-gray-400 uppercase">value</p>
                </div>
                <span className="text-[10px] text-gray-500">
                  {typeof value === 'string' && value.startsWith('@') 
                    ? 'Java Object Format' 
                    : `${typeof value} value`}
                </span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <pre className="text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-words">
                  {value}
                </pre>
              </div>
            </div>
            
            {/* 其他元数据 */}
            {Object.entries(otherData).map(([key, val]) => (
              <div key={key} className="bg-gray-800/30 rounded-lg p-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-600"></div>
                    <p className="text-xs text-gray-400">{key}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">
                    {typeof val === 'string' && val.includes('@') 
                      ? val.substring(0, 30) + (val.length > 30 ? '...' : '')
                      : String(val)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        );
      
      case 'verbose':
        return (
          <div className="space-y-3">
            {/* 主要value字段 */}
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></div>
                  <p className="text-xs font-bold text-gray-400 uppercase">value (Java Object)</p>
                </div>
                <span className="text-[10px] text-gray-500">
                  {typeof value === 'string' && value.startsWith('@') 
                    ? `Java ${value.match(/^@(\w+)/)?.[1] || 'Object'} format` 
                    : `${typeof value} value`}
                </span>
              </div>
              <div className="max-h-[600px] overflow-y-auto">
                <pre className="text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-words">
                  {value}
                </pre>
              </div>
            </div>
            
            {/* 其他元数据 */}
            {Object.entries(otherData).length > 0 && (
              <div className="bg-gray-800/30 rounded-lg p-3">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Metadata</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(otherData).map(([key, val]) => (
                    <div key={key} className="text-xs">
                      <span className="text-gray-500">{key}:</span>
                      <span className="ml-1 text-gray-300 font-mono">{String(val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      
      case 'hierarchical':
        return (
          <div className="space-y-4">
            {/* 使用改进的显示组件显示value */}
            {value && <ImprovedJsonDisplay data={value} label="Return Value" />}
            
            {/* 其他元数据 */}
            {Object.entries(otherData).length > 0 && (
              <div className="bg-gray-800/30 rounded-lg p-3">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Execution Details</p>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(otherData).map(([key, val]) => (
                    <div key={key} className="text-xs space-y-1">
                      <div className="text-gray-500 font-medium">{key}</div>
                      <div className="text-gray-300 font-mono truncate">{String(val)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      
      case 'java':
        return (
          <div className="space-y-4">
            {/* 优化显示Java对象 */}
            {value && <JavaObjectDisplay value={value} />}
            
            {/* 元数据 */}
            {Object.entries(otherData).length > 0 && (
              <div className="bg-gray-800/40 rounded-lg p-3 border border-gray-700">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">执行信息</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-xs space-y-1">
                    <div className="text-gray-500">类名:</div>
                    <div className="text-gray-300 font-mono truncate">{result.className}</div>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="text-gray-500">方法:</div>
                    <div className="text-gray-300 font-mono">{result.methodName}</div>
                  </div>
                  {result.cost && (
                    <div className="text-xs space-y-1">
                      <div className="text-gray-500">耗时(ms):</div>
                      <div className="text-gray-300 font-mono">{result.cost}</div>
                    </div>
                  )}
                  {result.ts && (
                    <div className="text-xs space-y-1">
                      <div className="text-gray-500">时间戳:</div>
                      <div className="text-gray-300 font-mono">{result.ts}</div>
                    </div>
                  )}
                  {result.accessPoint && (
                    <div className="text-xs space-y-1">
                      <div className="text-gray-500">切入点:</div>
                      <div className="text-gray-300 font-mono">{result.accessPoint}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      
      default:
        return null;
    }
  }
  
  const filteredRecords = searchQuery
    ? records.filter(record =>
        record.target.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.className.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.methodName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : records

  return (
    <div className="flex h-full bg-gray-50">
      {/* Form Area */}
      <div className="w-96 border-r bg-white p-6 flex flex-col gap-4 shadow-sm z-10">
        <div className="space-y-4">
          {/* 标题和操作按钮 */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">Method Watch</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSavedConfigs(!showSavedConfigs)}
                className={`p-2 rounded-lg transition-colors ${showSavedConfigs ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
                title="Saved Configurations"
              >
                <Bookmark size={16} />
              </button>
              <button
                onClick={() => setShowStats(!showStats)}
                className={`p-2 rounded-lg transition-colors ${showStats ? 'bg-green-100 text-green-600' : 'text-gray-500 hover:bg-gray-100'}`}
                title="Statistics"
              >
                <BarChart3 size={16} />
              </button>
            </div>
          </div>
          
          {/* 保存的配置面板 */}
          {showSavedConfigs && configs.length > 0 && (
            <div className="bg-gray-50 border rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-gray-500">Saved Configurations</p>
                <span className="text-xs text-gray-400">{configs.length}/10</span>
              </div>
              {configs.map(config => (
                <div
                  key={config.id}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${activeConfig === config.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-100'}`}
                  onClick={() => loadConfig(config)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700 truncate">{config.name}</span>
                      <span className="text-[10px] text-gray-400">{new Date(config.timestamp).toLocaleDateString()}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 truncate">
                      {config.className.split('.').pop()}.{config.methodName}
                    </div>
                  </div>
                  <button
                    onClick={(e) => deleteConfig(config.id, e)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete Configuration"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* 统计面板 */}
          {showStats && records.length > 0 && (
            <div className="bg-gradient-to-br from-green-50 to-blue-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-gradient-to-r from-green-100 to-blue-100 rounded-lg">
                    <BarChart3 size={14} className="text-green-600" />
                  </div>
                  <p className="text-xs font-bold text-gray-700">Watch Analytics</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="px-2 py-0.5 bg-white border rounded-lg text-[10px] font-medium text-gray-600">
                    {records.length} records
                  </span>
                </div>
              </div>
              {(() => {
                const stats = getStats()
                return stats && (
                  <div className="space-y-3">
                    {/* 基础统计 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/70 rounded-lg p-2 border">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-500">Invocations</span>
                          <Activity size={12} className="text-blue-500" />
                        </div>
                        <div className="text-lg font-bold text-gray-800 mt-1">{stats.totalInvocations}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {stats.uniqueMethods} unique methods
                        </div>
                      </div>
                      
                      <div className="bg-white/70 rounded-lg p-2 border">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-500">Data Size</span>
                          <Database size={12} className="text-purple-500" />
                        </div>
                        <div className="text-lg font-bold text-gray-800 mt-1">{stats.totalDataSize} KB</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {stats.dataDensity} KB/avg
                        </div>
                      </div>
                    </div>
                    
                    {/* 数据质量 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700">Data Quality</span>
                        <div className="flex items-center gap-1">
                          {stats.hasExceptions ? (
                            <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded flex items-center gap-0.5">
                              <AlertTriangle size={8} />
                              Has Exceptions
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded flex items-center gap-0.5">
                              <CheckCircle size={8} />
                              Clean Data
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {stats.topMethods.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Most Monitored Methods:</div>
                          <div className="space-y-1">
                            {stats.topMethods.map((method, idx) => (
                              <div key={idx} className="flex items-center justify-between text-xs">
                                <span className="text-gray-700 truncate max-w-[120px]">{method}</span>
                                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">
                                  #{idx + 1}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* 数据趋势 */}
                      <div className="pt-2 border-t">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">Average per Watch:</span>
                          <span className="font-medium text-gray-800">{stats.avgResultsPerWatch} calls</span>
                        </div>
                        <div className="flex items-center justify-between text-xs mt-1">
                          <span className="text-gray-600">Latest Record:</span>
                          <span className="font-medium text-gray-800">{stats.latestRecordTime}</span>
                        </div>
                        {stats.maxDataMethod !== 'N/A' && (
                          <div className="flex items-center justify-between text-xs mt-1">
                            <span className="text-gray-600">Largest Data:</span>
                            <span className="font-medium text-gray-800 truncate max-w-[100px]" title={stats.maxDataMethod}>
                              {stats.maxDataMethod.split('.').pop()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* 配置表单 */}
          <div className="space-y-3">
            {/* Class Name with auto-complete */}
            <div className="relative">
              <InputField 
                label="Class Name" 
                placeholder="com.example.UserService" 
                value={className} 
                onChange={setClassName} 
                icon={<Database size={14} />} 
              />
              {showMethods && methods.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                  {methods.map((method, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm font-mono border-b border-gray-100 last:border-b-0"
                      onClick={() => {
                        setMethodName(method)
                        setShowMethods(false)
                      }}
                    >
                      {method}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Method Name */}
            <InputField 
              label="Method Name" 
              placeholder="getUserById (* for all methods)" 
              value={methodName} 
              onChange={setMethodName} 
              icon={<Terminal size={14} />} 
            />
            
            {/* OGNL Expression */}
            <div className="relative">
              <InputField 
                label="OGNL Expression" 
                placeholder="{params, returnObj, throwExp}" 
                value={expression} 
                onChange={setExpression} 
                icon={<Filter size={14} />} 
              />
              <div className="absolute right-2 top-7 flex gap-1">
                <PresetButton text="{params}" onClick={() => setExpression('{params}')} />
                <PresetButton text="{returnObj}" onClick={() => setExpression('{returnObj}')} />
                <PresetButton text="Full" onClick={() => setExpression('{params, returnObj, throwExp}')} />
              </div>
            </div>
            
            {/* Condition */}
            <InputField 
              label="Condition (Optional)" 
              placeholder="params[0] > 100" 
              value={condition} 
              onChange={setCondition} 
              icon={<FilterIcon size={14} />} 
            />
            
            {/* Advanced Options */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1 mb-1 block">Invocation Limit</label>
                <div className="relative">
                  <select
                    className="w-full pl-3 pr-8 py-2.5 text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50 hover:bg-white transition-all shadow-inner appearance-none"
                    value={invocationLimit}
                    onChange={(e) => setInvocationLimit(e.target.value)}
                  >
                    <option value="1">1</option>
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Hash size={14} />
                  </div>
                </div>
              </div>
              
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1 mb-1 block">Expand Level</label>
                <div className="relative">
                  <select
                    className="w-full pl-3 pr-8 py-2.5 text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50 hover:bg-white transition-all shadow-inner appearance-none"
                    value={expandedLevel}
                    onChange={(e) => setExpandedLevel(e.target.value)}
                  >
                    <option value="1">1 - Minimal</option>
                    <option value="2">2 - Normal</option>
                    <option value="3">3 - Detailed</option>
                    <option value="4">4 - Verbose</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Eye size={14} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button 
            onClick={openSaveConfigModal}
            disabled={!className || !methodName}
            className="flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Save current configuration"
          >
            <Save size={16} />
            Save Config
          </button>
          
          <button 
            onClick={handleStart}
            disabled={isRunning || !className || !methodName}
            className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
              isRunning 
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none' 
                : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-blue-500/20'
            }`}
          >
            {isRunning ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play size={18} fill="currentColor" />
                Start Watch
              </>
            )}
          </button>
        </div>

        {/* Help Section */}
        <div className="mt-auto p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-1">
            <BookOpen size={10} className="inline mr-1" />
            Pro Tip
          </p>
          <p className="text-xs text-blue-700/70 leading-relaxed">
            Watch inspects method parameters, return values, and exceptions in real-time. 
            Use '*' for method name to monitor all methods in a class.
          </p>
          <div className="mt-2 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1 text-blue-600">
              <Zap size={12} />
              <span>Fast execution</span>
            </div>
            <div className="flex items-center gap-1 text-purple-600">
              <Eye size={12} />
              <span>Real-time inspection</span>
            </div>
            <div className="flex items-center gap-1 text-green-600">
              <Filter size={12} />
              <span>Conditional watch</span>
            </div>
          </div>
        </div>
      </div>

      {/* Results Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Results Header with Search */}
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg">
                <History className="text-blue-600" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-800">Watch Results</h2>
                <p className="text-sm text-gray-500">
                  {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}, {getStats()?.totalInvocations || 0} total invocations
                </p>
              </div>
            </div>
            
            <div className="flex flex-col md:flex-row gap-3 md:items-center">
              <div className="flex flex-col md:flex-row gap-3 md:items-center flex-1">
                {/* Search Input */}
                <div className="relative flex-1">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Search size={14} />
                  </div>
                  <input
                    type="text"
                    placeholder="Search by method, class, or expression..."
                    className="w-full pl-9 pr-4 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50 hover:bg-white transition-all"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                
                {/* 快速过滤按钮 */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const sorted = [...records].sort((a, b) => b.results.length - a.results.length)
                      setRecords(sorted)
                    }}
                    className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1"
                    title="Sort by result count (descending)"
                  >
                    <TrendingUp size={12} />
                    Sort by Results
                  </button>
                  <button
                    onClick={() => {
                      const withResults = records.filter(r => r.results.length > 0)
                      const noResults = records.filter(r => r.results.length === 0)
                      setRecords([...withResults, ...noResults])
                    }}
                    className="px-3 py-1.5 text-xs border border-green-200 text-green-600 hover:bg-green-50 rounded-lg transition-colors flex items-center gap-1"
                    title="Show records with results first"
                  >
                    <Filter size={12} />
                    Has Results
                  </button>
                </div>
              </div>
              
              {/* Action Buttons */}
              {records.length > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (expandedRecord) {
                        setExpandedRecord(null)
                      } else if (filteredRecords.length > 0) {
                        setExpandedRecord(filteredRecords[0].id)
                      }
                    }}
                    className="px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1"
                    title={expandedRecord ? "Collapse all" : "Expand first record"}
                  >
                    {expandedRecord ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {expandedRecord ? "Collapse" : "Expand"}
                  </button>
                  <button
                    onClick={() => {
                      const dataStr = JSON.stringify(records, null, 2)
                      const dataBlob = new Blob([dataStr], { type: 'application/json' })
                      const url = URL.createObjectURL(dataBlob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `watch-results-${new Date().toISOString().split('T')[0]}.json`
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                      URL.revokeObjectURL(url)
                    }}
                    className="px-3 py-2 text-xs font-medium text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors flex items-center gap-1"
                    title="Export all records as JSON"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button
                    onClick={clearAllRecords}
                    className="px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1"
                    title="Clear all records"
                  >
                    <Trash2 size={14} />
                    Clear All
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Empty State */}
        {filteredRecords.length === 0 ? (
          <div className="h-96 flex flex-col items-center justify-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
            {searchQuery ? (
              <>
                <Search size={48} className="opacity-20 mb-4" />
                <p className="text-sm mb-2">No records matching "{searchQuery}"</p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <Clock size={48} className="opacity-20 mb-4" />
                <p className="text-sm mb-2">No watch records yet</p>
                <p className="text-xs text-gray-400 max-w-md text-center">
                  Configure a class and method watch above to start inspecting method invocations.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRecords.map((record) => (
              <div key={record.id} className="bg-white border rounded-xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2">
                {/* Record Header */}
                <div 
                  className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedRecord(expandedRecord === record.id ? null : record.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${record.results.length > 0 ? 'bg-gradient-to-br from-purple-100 to-pink-100' : 'bg-gray-100'}`}>
                        <Code className={record.results.length > 0 ? 'text-purple-600' : 'text-gray-400'} size={16} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700">
                            WATCH
                          </span>
                          <span className="font-bold text-gray-800">{record.target}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500">
                            {record.time} • {record.results.length} invocation{record.results.length !== 1 ? 's' : ''}
                          </span>
                          <span className="text-xs text-gray-400">
                            Expression: {record.expression.length > 30 ? record.expression.substring(0, 30) + '...' : record.expression}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {expandedRecord === record.id ? <ChevronDown size={20} className="text-gray-300" /> : <ChevronRight size={20} className="text-gray-300" />}
                </div>
                
                {/* Expanded Content */}
                {expandedRecord === record.id && (
                  <div className="border-t">
                    {/* Result Statistics */}
                    <div className="px-5 py-3 bg-gray-50 border-b flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-600">
                          <strong>{record.results.length}</strong> invocation{record.results.length !== 1 ? 's' : ''} captured
                        </span>
                        {record.condition && (
                          <span className="text-xs text-gray-600">
                            Condition: <code className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px]">{record.condition}</code>
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          const recordStr = JSON.stringify(record, null, 2)
                          const dataBlob = new Blob([recordStr], { type: 'application/json' })
                          const url = URL.createObjectURL(dataBlob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `watch-${record.target}-${record.id}.json`
                          document.body.appendChild(a)
                          a.click()
                          document.body.removeChild(a)
                          URL.revokeObjectURL(url)
                        }}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Download size={12} />
                        Export Record
                      </button>
                    </div>
                    
                    {/* Results Grid with Display Mode Controls */}
                    <div className="p-5 space-y-4 max-h-[700px] overflow-y-auto">
                      {record.results.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                          <EyeOff size={32} className="mx-auto mb-2 opacity-30" />
                          <p className="text-sm italic">No invocation data captured. Ensure the method is being called while watch is active.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Display Mode Controls */}
                          <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                            <div className="text-xs text-gray-600">显示模式:</div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setDisplayMode('simple')}
                                className={`px-3 py-1 text-xs rounded transition-all ${displayMode === 'simple' 
                                  ? 'bg-blue-100 text-blue-600 border border-blue-200' 
                                  : 'text-gray-500 hover:bg-gray-100'}`}
                              >
                                简洁模式
                              </button>
                              <button
                                onClick={() => setDisplayMode('verbose')}
                                className={`px-3 py-1 text-xs rounded transition-all ${displayMode === 'verbose' 
                                  ? 'bg-purple-100 text-purple-600 border border-purple-200' 
                                  : 'text-gray-500 hover:bg-gray-100'}`}
                              >
                                详细模式
                              </button>
                              <button
                                onClick={() => setDisplayMode('java')}
                                className={`px-3 py-1 text-xs rounded transition-all ${displayMode === 'java' 
                                  ? 'bg-orange-100 text-orange-600 border border-orange-200' 
                                  : 'text-gray-500 hover:bg-gray-100'}`}
                              >
                                Java对象模式
                              </button>
                              <button
                                onClick={() => setDisplayMode('hierarchical')}
                                className={`px-3 py-1 text-xs rounded transition-all ${displayMode === 'hierarchical' 
                                  ? 'bg-green-100 text-green-600 border border-green-200' 
                                  : 'text-gray-500 hover:bg-gray-100'}`}
                              >
                                层级模式
                              </button>
                            </div>
                            <div className="text-xs text-gray-500">
                              {displayMode === 'simple' && '显示简化的JSON数据'}
                              {displayMode === 'verbose' && '显示完整格式化JSON数据'}
                              {displayMode === 'java' && '优化显示Arthas Java对象格式'}
                              {displayMode === 'hierarchical' && '显示可折叠的层级数据，支持搜索'}
                            </div>
                          </div>
                          
                          {record.results.map((result, i) => (
                            <div key={i} className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-4 shadow-inner">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <div className="px-2 py-1 bg-gray-700 rounded text-[10px] font-bold text-gray-300">
                                    调用 #{i + 1}
                                  </div>
                                  <div className="text-xs text-gray-400">
                                    {new Date(record.timestamp + (i * 100)).toLocaleTimeString()}
                                  </div>
                                </div>
                                <div className="text-xs text-gray-500">
                                  {Object.keys(result.details || {}).length} 个数据点
                                </div>
                              </div>
                              
                              {renderResultContent(result, record)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Configuration Modal */}
      {showSaveConfigModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full animate-in fade-in slide-in-from-top-2">
            <div className="px-6 py-5 border-b">
              <h3 className="text-lg font-bold text-gray-800">Save Configuration</h3>
              <p className="text-sm text-gray-500 mt-1">
                Save your current watch settings for quick reuse
              </p>
            </div>
            
            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Configuration Name
                  </label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newConfigName}
                    onChange={(e) => setNewConfigName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveCurrentConfig()
                      if (e.key === 'Escape') cancelSaveConfig()
                    }}
                    autoFocus
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    This will be saved as: {className.split('.').pop()}.{methodName}
                  </p>
                </div>
                
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Class:</span>
                      <div className="font-medium text-gray-800 truncate">{className}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Method:</span>
                      <div className="font-medium text-gray-800">{methodName}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Expression:</span>
                      <div className="font-medium text-gray-800 truncate">{expression}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Limit:</span>
                      <div className="font-medium text-gray-800">{invocationLimit} calls</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-xl">
              <button
                onClick={cancelSaveConfig}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveCurrentConfig}
                disabled={!newConfigName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InputField({ label, placeholder, value, onChange, icon }: any) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">{label}</label>
      <div className="relative group">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors">
          {icon}
        </div>
        <input
          type="text"
          placeholder={placeholder}
          className="w-full pl-9 pr-4 py-2.5 text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50 hover:bg-white transition-all shadow-inner"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

function PresetButton({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-0.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
    >
      {text}
    </button>
  )
}

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-600">{label}:</span>
      <span className="text-xs font-bold text-gray-800">{value}</span>
    </div>
  )
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

function CollapsibleSection({ title, children, defaultCollapsed = false }: CollapsibleSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  
  return (
    <div className="bg-gray-800/50 rounded-lg overflow-hidden">
      <button
        className="w-full px-3 py-2 flex items-center justify-between bg-gray-800 hover:bg-gray-700 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <ChevronRight size={12} className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
          <span className="text-xs font-bold text-gray-300">{title}</span>
        </div>
        <span className="text-[10px] text-gray-500">
          {isCollapsed ? 'Click to expand' : 'Click to collapse'}
        </span>
      </button>
      {!isCollapsed && (
        <div className="p-3">
          {children}
        </div>
      )}
    </div>
  )
}

// 改进的JSON显示组件，支持折叠和搜索，特别处理Arthas Java对象格式
interface ImprovedJsonDisplayProps {
  data: any;
  label: string;
}

function ImprovedJsonDisplay({ data, label }: ImprovedJsonDisplayProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  
  const togglePath = (path: string) => {
    const newSet = new Set(expandedPaths);
    if (newSet.has(path)) {
      newSet.delete(path);
    } else {
      newSet.add(path);
    }
    setExpandedPaths(newSet);
  };

  // 解析Arthas Java对象格式的辅助函数
  const parseArthasValue = (value: string): { type: string; content: string; details?: any } => {
    if (!value || typeof value !== 'string') {
      return { type: 'plain', content: String(value) };
    }
    
    // 匹配 @Type[...] 格式
    const javaObjectMatch = value.match(/^@(\w+)\[(.+)\]$/s);
    if (javaObjectMatch) {
      const [_, type, content] = javaObjectMatch;
      
      // 处理对象类型的特定格式
      if (content.includes('=')) {
        try {
          // 解析类似 Product(id=1, categoryId=1, name=12...) 的格式
          const objStart = content.indexOf('(');
          const objEnd = content.lastIndexOf(')');
          if (objStart >= 0 && objEnd > objStart) {
            const className = content.substring(0, objStart);
            const propertiesStr = content.substring(objStart + 1, objEnd);
            
            // 简单解析属性
            const properties: Record<string, string> = {};
            const parts = propertiesStr.split(',');
            parts.forEach(part => {
              const trimmed = part.trim();
              const eqIdx = trimmed.indexOf('=');
              if (eqIdx > 0) {
                const key = trimmed.substring(0, eqIdx).trim();
                const val = trimmed.substring(eqIdx + 1).trim();
                properties[key] = val;
              }
            });
            
            return { 
              type, 
              content: `${className}(${Object.keys(properties).length} properties)`,
              details: properties 
            };
          }
        } catch (e) {
          // 解析失败，返回原始内容
          console.warn('Failed to parse Java object:', e);
        }
      }
      
      return { type, content: content.length > 100 ? content.substring(0, 100) + '...' : content };
    }
    
    // 匹配简单的 @Type[value] 格式
    const simpleMatch = value.match(/^@(\w+)\[([^\]]+)\]$/);
    if (simpleMatch) {
      const [_, type, val] = simpleMatch;
      return { type, content: val };
    }
    
    return { type: 'plain', content: value };
  };

  const renderArthasObject = (value: string, path = ''): React.ReactNode => {
    const parsed = parseArthasValue(value);
    const currentPath = path + `@${parsed.type}`;
    const isExpanded = expandedPaths.has(currentPath);
    
    // 获取类型颜色
    const getTypeColor = (type: string) => {
      const typeColors: Record<string, string> = {
        ArrayList: 'text-purple-400',
        Object: 'text-blue-400',
        Integer: 'text-green-400',
        Long: 'text-green-500',
        Boolean: 'text-orange-400',
        Product: 'text-yellow-400',
        Page: 'text-pink-400',
        String: 'text-teal-400',
      };
      return typeColors[type] || 'text-gray-300';
    };
    
    if (parsed.details) {
      // 有详细信息的对象类型
      return (
        <div className="pl-4">
          <button
            onClick={() => togglePath(currentPath)}
            className="flex items-center gap-1 text-sm hover:text-gray-200 mb-1"
          >
            <ChevronRight size={10} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            <span className={`font-mono font-bold ${getTypeColor(parsed.type)}`}>@{parsed.type}</span>
            <span className="text-gray-400 text-xs ml-1">{parsed.content}</span>
          </button>
          
          {isExpanded && (
            <div className="border-l border-gray-700 ml-2 pl-3 space-y-1 max-h-[300px] overflow-y-auto">
              {Object.entries(parsed.details).map(([key, val], index) => (
                <div key={index} className="text-xs">
                  <span className="text-yellow-400 font-medium">{key}</span>: 
                  <span className="ml-1 text-gray-300">{String(val)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    } else if (parsed.content.includes('@')) {
      // 嵌套的Arthas对象
      return (
        <div className="pl-4">
          <button
            onClick={() => togglePath(currentPath)}
            className="flex items-center gap-1 text-sm hover:text-gray-200 mb-1"
          >
            <ChevronRight size={10} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            <span className={`font-mono font-bold ${getTypeColor(parsed.type)}`}>@{parsed.type}</span>
            <span className="text-gray-400 text-xs ml-1">({parsed.content.length > 50 ? 'click to expand' : parsed.content})</span>
          </button>
          
          {isExpanded && (
            <div className="border-l border-gray-700 ml-2 pl-3 space-y-1 max-h-[400px] overflow-y-auto">
              <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
                {parsed.content}
              </pre>
            </div>
          )}
        </div>
      );
    } else {
      // 简单值
      return (
        <span className={`font-mono ${getTypeColor(parsed.type)}`}>
          @{parsed.type}[{parsed.content}]
        </span>
      );
    }
  };

  const renderJson = (obj: any, path = ''): React.ReactNode => {
    if (obj === null) return <span className="text-gray-400">null</span>;
    if (obj === undefined) return <span className="text-gray-400">undefined</span>;
    
    // 检查是否是Arthas格式的字符串
    if (typeof obj === 'string' && obj.startsWith('@')) {
      return renderArthasObject(obj, path);
    }
    
    if (typeof obj === 'string') {
      const displayText = obj.length > 100 ? obj.substring(0, 100) + '...' : obj;
      
      // 检查是否包含Arthas格式的嵌套
      if (obj.includes('@')) {
        return renderArthasObject(obj, path);
      }
      
      return <span className="text-green-400">"{displayText}"</span>;
    }
    
    if (typeof obj === 'number') return <span className="text-blue-400">{obj}</span>;
    if (typeof obj === 'boolean') return <span className="text-orange-400">{obj.toString()}</span>;
    
    if (Array.isArray(obj)) {
      if (obj.length === 0) return <span className="text-gray-500">[]</span>;
      
      const currentPath = path + '[]';
      const isExpanded = expandedPaths.has(currentPath);
      
      return (
        <div className="pl-4">
          <button
            onClick={() => togglePath(currentPath)}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-300 mb-1"
          >
            <ChevronRight size={10} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            <span className="font-mono">Array ({obj.length} items)</span>
          </button>
          
          {isExpanded && (
            <div className="border-l border-gray-700 ml-2 pl-3 space-y-1 max-h-[300px] overflow-y-auto">
              {obj.map((item, index) => (
                <div key={index} className="text-xs">
                  <span className="text-gray-500">[{index}]</span>: {renderJson(item, `${currentPath}[${index}]`)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    
    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) return <span className="text-gray-500">{'{ }'}</span>;
      
      const currentPath = path + '{}';
      const isExpanded = expandedPaths.has(currentPath);
      
      // 过滤搜索
      const filteredKeys = searchTerm 
        ? keys.filter(key => 
            key.toLowerCase().includes(searchTerm.toLowerCase()) ||
            JSON.stringify(obj[key]).toLowerCase().includes(searchTerm.toLowerCase())
          )
        : keys;
      
      return (
        <div className="pl-4">
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => togglePath(currentPath)}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-300"
            >
              <ChevronRight size={10} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              <span className="font-mono">Object ({keys.length} properties)</span>
            </button>
            
            {keys.length > 5 && (
              <div className="flex items-center gap-1">
                <Search size={10} className="text-gray-500" />
                <input
                  type="text"
                  placeholder="Search..."
                  className="bg-gray-900 text-gray-300 text-xs px-2 py-0.5 rounded border border-gray-700 w-24"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            )}
          </div>
          
          {isExpanded && filteredKeys.length > 0 && (
            <div className="border-l border-gray-700 ml-2 pl-3 space-y-1 max-h-[400px] overflow-y-auto">
              {filteredKeys.map(key => (
                <div key={key} className="text-xs">
                  <span className="text-yellow-400 font-medium">"{key}"</span>: {renderJson(obj[key], `${currentPath}.${key}`)}
                </div>
              ))}
            </div>
          )}
          
          {isExpanded && filteredKeys.length === 0 && keys.length > 0 && (
            <div className="text-xs text-gray-500 italic ml-2">
              No properties match "{searchTerm}"
            </div>
          )}
        </div>
      );
    }
    
    return <span className="text-gray-400">{String(obj)}</span>;
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-bold text-gray-400 uppercase">{label}</span>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span className="px-1.5 py-0.5 bg-gray-800 rounded">@表示Java类型</span>
        </div>
      </div>
      <div className="max-h-[600px] overflow-auto bg-gray-900/50 p-3 rounded-lg">
        {renderJson(data)}
      </div>
    </div>
  );
}

// 专门用于显示Java对象的组件
interface JavaObjectDisplayProps {
  value: string;
}

function JavaObjectDisplay({ value }: JavaObjectDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  
  // 解析Arthas返回的Java对象字符串
  // 示例: @ArrayList[\n    @Object[...],\n    @Page[...],\n    null,\n  ]
  
  // 简单的格式化函数
  const formatJavaObject = (str: string): string => {
    if (!str) return '';
    
    // 添加缩进格式化
    let indent = 0;
    const lines = str.split('\n');
    const formattedLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.endsWith(']') || trimmed.endsWith('),')) {
        indent = Math.max(0, indent - 2);
      }
      
      const indentedLine = ' '.repeat(indent) + trimmed;
      
      if (trimmed.endsWith('[') || trimmed.includes('@') && trimmed.endsWith('(')) {
        indent += 2;
      }
      
      return indentedLine;
    });
    
    return formattedLines.join('\n');
  };
  
  const formattedValue = formatJavaObject(value);
  
  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-r from-orange-100 to-red-100 rounded-lg">
            <Code className="text-orange-600" size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-300">Java Object Format</span>
              <span className="px-2 py-0.5 bg-gray-700 rounded text-[10px] text-gray-300">
                Arthas
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {value.match(/^@(\w+)/)?.[1] || 'Object'} · {value.length} characters
            </div>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-3 py-1 text-xs font-medium text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors flex items-center gap-1"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      
      {expanded ? (
        <div className="space-y-3">
          {/* 格式化显示 */}
          <div className="bg-gray-800/70 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-800 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Formatted Java Object</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500">
                    Lines: {formattedValue.split('\n').length}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(value)
                        .then(() => alert('Copied to clipboard!'))
                        .catch(err => console.error('Copy failed:', err));
                    }}
                    className="text-[10px] text-blue-500 hover:text-blue-400"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              <pre className="text-xs text-gray-300 font-mono p-3 whitespace-pre">
                {formattedValue}
              </pre>
            </div>
          </div>
          
          {/* 类型分析 */}
          {value.includes('@') && (
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs font-bold text-gray-400 uppercase mb-2">Detected Java Types</p>
              <div className="flex flex-wrap gap-2">
                {Array.from(new Set(value.match(/@(\w+)/g) || [])).map((type, i) => (
                  <span key={i} className="px-2 py-1 bg-gray-700 text-gray-300 text-[10px] rounded">
                    {type}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-800/50 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Preview:</span>
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-orange-500 hover:text-orange-400"
            >
              Click to expand full object
            </button>
          </div>
          <pre className="text-xs text-gray-400 font-mono mt-1 truncate">
            {value.split('\n')[0]}
            {value.split('\n').length > 1 && ' ...'}
          </pre>
        </div>
      )}
    </div>
  );
}
