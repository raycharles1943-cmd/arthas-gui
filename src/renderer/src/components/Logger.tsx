import { useState, useEffect, useRef } from 'react'
import { arthas } from '../utils/arthas'
import { ClipboardList, Search, RefreshCw, Download, CheckSquare, Square, Eye, EyeOff, Filter, AlertCircle, Check, X, Save } from 'lucide-react'

export function Logger() {
  const [loggers, setLoggers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [selectedLevels, setSelectedLevels] = useState<string[]>([])
  const [showAppenderDetails, setShowAppenderDetails] = useState(false)
  const [selectedLoggers, setSelectedLoggers] = useState<Set<string>>(new Set())
  const [expandedLoggers, setExpandedLoggers] = useState<Set<string>>(new Set())
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [levelStats, setLevelStats] = useState<Record<string, number>>({})
  const [batchTargetLevel, setBatchTargetLevel] = useState<string>('INFO')
  const [searchMode, setSearchMode] = useState<'simple' | 'advanced'>('simple')
  const [searchInAppenders, setSearchInAppenders] = useState(true)
  const [searchInClasses, setSearchInClasses] = useState(true)
  
  const autoRefreshInterval = useRef<NodeJS.Timeout>()
  const levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'OFF']
  const allLevels = [...levels, 'FATAL', 'ALL']

  const fetchLoggers = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const results = await arthas.logger()
      const res = results.find(r => r.type === 'logger')
      if (res && res.loggers) {
        // Flatten nested loggers if necessary or handle array
        const list = Array.isArray(res.loggers) ? res.loggers : Object.values(res.loggers)
        setLoggers(list)
        
        // 计算日志级别统计
        const stats: Record<string, number> = {}
        allLevels.forEach(level => { stats[level] = 0 })
        
        list.forEach(logger => {
          const level = logger.level?.toUpperCase() || 'OFF'
          if (stats[level] !== undefined) {
            stats[level]++
          } else {
            stats['OFF'] = (stats['OFF'] || 0) + 1
          }
        })
        
        // 计算ALL
        stats['ALL'] = list.length
        setLevelStats(stats)
      } else {
        setError('No logger data found in response.')
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch loggers. Make sure Arthas is connected.')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateLevel = async (name: string, level: string) => {
    try {
      await arthas.updateLogger(name, level)
      setSuccess(`Successfully updated ${name} to ${level}`)
      setError(null)
      fetchLoggers()
    } catch (err: any) {
      console.error('Failed to update logger:', err)
      setError(`Failed to update ${name} to ${level}: ${err?.message || 'Unknown error'}`)
    }
  }

  const handleBulkUpdateLevel = async (level: string) => {
    if (selectedLoggers.size === 0) {
      setError('Please select loggers to update.')
      return
    }
    
    const confirmed = window.confirm(`Update ${selectedLoggers.size} logger(s) to ${level}?`)
    if (!confirmed) return
    
    try {
      const updates = Array.from(selectedLoggers).map(name =>
        arthas.updateLogger(name, level)
      )
      
      await Promise.all(updates)
      setSuccess(`Successfully updated ${selectedLoggers.size} logger(s) to ${level}`)
      setSelectedLoggers(new Set())
      setError(null)
      fetchLoggers()
    } catch (err: any) {
      setError(`Failed to batch update: ${err?.message || 'Unknown error'}`)
    }
  }

  const toggleSelectAll = () => {
    if (selectedLoggers.size === filteredLoggers.length) {
      setSelectedLoggers(new Set())
    } else {
      setSelectedLoggers(new Set(filteredLoggers.map(l => l.name)))
    }
  }

  const toggleSelectLogger = (name: string) => {
    const newSelected = new Set(selectedLoggers)
    if (newSelected.has(name)) {
      newSelected.delete(name)
    } else {
      newSelected.add(name)
    }
    setSelectedLoggers(newSelected)
  }

  const toggleExpandedLogger = (name: string) => {
    const newExpanded = new Set(expandedLoggers)
    if (newExpanded.has(name)) {
      newExpanded.delete(name)
    } else {
      newExpanded.add(name)
    }
    setExpandedLoggers(newExpanded)
  }

  const handleExportConfig = () => {
    const config = {
      timestamp: new Date().toISOString(),
      totalLoggers: loggers.length,
      loggers: loggers.map(logger => ({
        name: logger.name,
        level: logger.level,
        class: logger.clazz,
        appenders: logger.appenders?.map((a: any) => ({
          name: a.name || a,
          type: a.type,
          layout: a.layout,
          target: a.target
        })) || []
      }))
    }
    
    const dataStr = JSON.stringify(config, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    
    // 创建下载链接
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `logger-config-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    
    setSuccess('Logger configuration exported successfully')
  }

  // 自动刷新逻辑
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshInterval.current = setInterval(fetchLoggers, 10000) // 每10秒刷新
    } else {
      if (autoRefreshInterval.current) {
        clearInterval(autoRefreshInterval.current)
      }
    }

    return () => {
      if (autoRefreshInterval.current) {
        clearInterval(autoRefreshInterval.current)
      }
    }
  }, [autoRefresh])

  // 3秒后清除成功消息
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [success])

  useEffect(() => {
    fetchLoggers()
  }, [])

  const filteredLoggers = loggers.filter(l => {
    if (!search && selectedLevels.length === 0) return true
    
    let matchesSearch = false
    if (search) {
      const searchLower = search.toLowerCase()
      
      // 基本搜索：总是搜索logger名称
      let searchResult = l.name?.toLowerCase().includes(searchLower)
      
      // 高级搜索选项
      if (searchMode === 'advanced' || searchInClasses) {
        searchResult = searchResult || (l.clazz && l.clazz.toLowerCase().includes(searchLower))
      }
      
      if (searchMode === 'advanced' || searchInAppenders) {
        searchResult = searchResult || (l.appenders && l.appenders.some((a: any) => 
          String(a.name || a).toLowerCase().includes(searchLower) ||
          String(a.type || '').toLowerCase().includes(searchLower) ||
          String(a.target || '').toLowerCase().includes(searchLower)
        ))
      }
      
      // 精确搜索模式（前缀：* 后缀：* 包含：默认）
      if (searchMode === 'advanced') {
        if (searchLower.startsWith('*')) {
          // 后缀匹配
          const suffix = searchLower.slice(1)
          searchResult = l.name?.toLowerCase().endsWith(suffix) || 
                        l.clazz?.toLowerCase().endsWith(suffix)
        } else if (searchLower.endsWith('*')) {
          // 前缀匹配
          const prefix = searchLower.slice(0, -1)
          searchResult = l.name?.toLowerCase().startsWith(prefix) || 
                        l.clazz?.toLowerCase().startsWith(prefix)
        }
      }
      
      matchesSearch = searchResult
    } else {
      matchesSearch = true
    }
    
    const matchesLevel = selectedLevels.length === 0 || selectedLevels.includes(l.level?.toUpperCase() || 'OFF')
    return matchesSearch && matchesLevel
  })

  const toggleLevelFilter = (level: string) => {
    setSelectedLevels(prev => {
      if (prev.includes(level)) {
        return prev.filter(l => l !== level)
      }
      return [...prev, level]
    })
  }

  const getLevelColor = (level: string, includeBackground = false) => {
    switch (level) {
      case 'TRACE': return includeBackground ? 'bg-purple-100 text-purple-700 border-purple-200' : 'text-purple-500'
      case 'DEBUG': return includeBackground ? 'bg-blue-100 text-blue-700 border-blue-200' : 'text-blue-500'
      case 'INFO': return includeBackground ? 'bg-green-100 text-green-700 border-green-200' : 'text-green-500'
      case 'WARN': return includeBackground ? 'bg-orange-100 text-orange-700 border-orange-200' : 'text-orange-500'
      case 'ERROR': return includeBackground ? 'bg-red-100 text-red-700 border-red-200' : 'text-red-500'
      case 'FATAL': return includeBackground ? 'bg-red-900 text-red-100 border-red-700' : 'text-red-700'
      default: return includeBackground ? 'bg-gray-100 text-gray-700 border-gray-200' : 'text-gray-400'
    }
  }

  const getLevelBadgeClass = (level: string) => {
    return getLevelColor(level, true)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Main header */}
      <div className="px-6 py-4 border-b flex flex-col space-y-3 bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-blue-600" />
            <h2 className="text-lg font-bold text-gray-800">Logger Management</h2>
            <span className="ml-2 text-xs font-medium px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
              {loggers.length} Loggers
            </span>
            {filteredLoggers.length !== loggers.length && (
              <span className="text-xs text-gray-500">
                ({filteredLoggers.length} filtered)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Selected loggers batch operations */}
            {selectedLoggers.size > 0 && (
              <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                <span className="text-sm font-medium text-blue-700">
                  {selectedLoggers.size} selected
                </span>
                <div className="flex items-center gap-1">
                  <select
                    value={batchTargetLevel}
                    onChange={(e) => setBatchTargetLevel(e.target.value)}
                    className="text-xs px-2 py-0.5 border rounded bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    {levels.map(lv => 
                      <option key={lv} value={lv}>{lv}</option>
                    )}
                  </select>
                  <button
                    onClick={() => handleBulkUpdateLevel(batchTargetLevel)}
                    className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                  >
                    <Save size={12} />
                    Apply
                  </button>
                  <button
                    onClick={() => setSelectedLoggers(new Set())}
                    className="text-xs px-2 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 flex items-center gap-1"
                  >
                    <X size={12} />
                    Clear
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={handleExportConfig}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-blue-600"
              title="Export configuration"
            >
              <Download size={18} />
            </button>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`p-2 hover:bg-gray-100 rounded-lg transition-colors ${autoRefresh ? 'text-green-600' : 'text-gray-500'}`}
              title={autoRefresh ? "Auto-refresh enabled (10s)" : "Enable auto-refresh"}
            >
              <RefreshCw size={18} className={autoRefresh ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setShowAppenderDetails(!showAppenderDetails)}
              className={`p-2 hover:bg-gray-100 rounded-lg transition-colors ${showAppenderDetails ? 'bg-blue-50 text-blue-600' : 'text-gray-500'}`}
              title={showAppenderDetails ? "Hide appender details" : "Show appender details"}
            >
              {showAppenderDetails ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <button 
              onClick={fetchLoggers} 
              disabled={loading}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-blue-600"
              title="Refresh manually"
            >
              <RefreshCw size={18} className={`${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Status messages */}
        {error && (
          <div className="flex items-center gap-3 p-3 text-red-700 bg-red-50 border border-red-100 rounded-lg">
            <AlertCircle size={18} />
            <p className="text-sm flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-3 p-3 text-green-700 bg-green-50 border border-green-100 rounded-lg">
            <Check size={18} />
            <p className="text-sm flex-1">{success}</p>
            <button onClick={() => setSuccess(null)} className="text-green-400 hover:text-green-600">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-4">
          <div className="flex-1 flex items-start gap-3 flex-col md:flex-row md:items-center">
          <div className="flex-1 flex items-center gap-3">
            <div className="relative flex-1 max-w-lg">
              <div className="flex items-center">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  type="text"
                  placeholder={`Search ${searchMode === 'advanced' ? '(use *prefix or suffix*)' : 'by name, class, or appender'}...`}
                  className="w-full pl-9 pr-24 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center bg-gray-100 rounded pr-1">
                    <span className="text-xs text-gray-500 px-2">
                      Found: {filteredLoggers.length}
                    </span>
                    <button
                      onClick={() => setSearch('')}
                      className="text-gray-400 hover:text-gray-600 p-0.5"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
              {searchMode === 'advanced' && !search && (
                <div className="absolute -bottom-5 left-0 text-xs text-gray-400">
                  Tip: Use "*suffix" for suffix match or "prefix*" for prefix match
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                <Filter size={14} className="text-gray-400 ml-1" />
                <select
                  value={selectedLevels.length === 0 ? 'ALL' : selectedLevels[0]}
                  onChange={(e) => {
                    if (e.target.value === 'ALL') {
                      setSelectedLevels([])
                    } else {
                      setSelectedLevels([e.target.value])
                    }
                  }}
                  className="text-xs px-2 py-1 bg-white border rounded focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="ALL">ALL Levels</option>
                  {levels.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                </select>
              </div>

              {filteredLoggers.length > 0 && (
                <button
                  onClick={toggleSelectAll}
                  className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 whitespace-nowrap"
                >
                  {selectedLoggers.size === filteredLoggers.length ? 'Clear All' : 'Select All'}
                </button>
              )}
            </div>
          </div>
          
          {/* Advanced search options */}
          <div className="flex items-center gap-2 text-xs bg-gray-50 px-2 py-1 rounded-lg border">
            <button
              onClick={() => setSearchMode(searchMode === 'simple' ? 'advanced' : 'simple')}
              className={`px-2 py-0.5 rounded whitespace-nowrap ${searchMode === 'advanced' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
            >
              {searchMode === 'simple' ? 'Simple' : 'Advanced'} Search
            </button>
            
            {searchMode === 'advanced' && (
              <>
                <div className="h-4 w-px bg-gray-300" />
                <label className="flex items-center gap-1 text-gray-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={searchInClasses}
                    onChange={(e) => setSearchInClasses(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Search in Classes
                </label>
                <label className="flex items-center gap-1 text-gray-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={searchInAppenders}
                    onChange={(e) => setSearchInAppenders(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Search in Appenders
                </label>
              </>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Level filter and bulk actions */}
      <div className="px-6 py-3 border-b bg-gray-50 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-700">Filter by level:</span>
          <div className="flex items-center space-x-1">
            {levels.map(level => (
              <button
                key={level}
                onClick={() => toggleLevelFilter(level)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  selectedLevels.includes(level) 
                    ? getLevelColor(level, true)
                    : 'bg-white border text-gray-700 hover:bg-gray-50'
                }`}
              >
                {level} ({levelStats[level] || 0})
              </button>
            ))}
            {selectedLevels.length > 0 && (
              <button
                onClick={() => setSelectedLevels([])}
                className="text-xs text-blue-600 hover:text-blue-800 ml-2"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
        
        {selectedLoggers.size > 0 && (
          <div className="flex items-center space-x-3">
            <span className="text-sm text-gray-700">
              {selectedLoggers.size} logger(s) selected
            </span>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">Update to:</span>
              <select
                className="border rounded px-2 py-1 text-sm"
                onChange={(e) => handleBulkUpdateLevel(e.target.value)}
                defaultValue=""
              >
                <option value="" disabled>Select level</option>
                {levels.map(lv => (
                  <option key={lv} value={lv}>{lv}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Level statistics */}
      <div className="px-6 py-2 border-b bg-white">
        <div className="flex items-center space-x-4">
          {levels.map(level => {
            const count = levelStats[level] || 0
            const percentage = loggers.length > 0 ? (count / loggers.length * 100).toFixed(1) : '0'
            return (
              <div key={level} className="flex items-center">
                <div className={`w-2 h-2 rounded-full mr-1.5 ${getLevelColor(level, false)}`} />
                <span className="text-xs font-medium text-gray-600">{level}:</span>
                <span className="text-xs ml-1">{count} ({percentage}%)</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500 font-medium sticky top-0">
            <tr>
              <th className="px-6 py-3 w-8">
                <button onClick={toggleSelectAll} className="p-1">
                  {selectedLoggers.size === filteredLoggers.length && filteredLoggers.length > 0 ? 
                    <CheckSquare size={16} className="text-blue-600" /> : 
                    <Square size={16} className="text-gray-400" />}
                </button>
              </th>
              <th className="px-6 py-3">LOGGER NAME</th>
              <th className="px-6 py-3">LEVEL</th>
              <th className="px-6 py-3">CLASS</th>
              <th className="px-6 py-3">APPENDER</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={5} className="p-12 text-center text-gray-400">Loading loggers...</td></tr>
            ) : filteredLoggers.length === 0 ? (
              <tr><td colSpan={5} className="p-12 text-center text-gray-400">No loggers found.</td></tr>
            ) : (
              filteredLoggers.map((l, idx) => (
                <tr key={idx} className={`hover:bg-gray-50 transition-colors ${selectedLoggers.has(l.name) ? 'bg-blue-50' : ''}`}>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => toggleSelectLogger(l.name)}
                      className="p-1"
                    >
                      {selectedLoggers.has(l.name) ? 
                        <CheckSquare size={16} className="text-blue-600" /> : 
                        <Square size={16} className="text-gray-400" />}
                    </button>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-800 break-all">
                    <div>{l.name}</div>
                    {l.parent && (
                      <div className="text-xs text-gray-500 mt-1">Parent: {l.parent}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={l.level}
                      onChange={(e) => handleUpdateLevel(l.name, e.target.value)}
                      className={`px-2 py-1 rounded text-xs font-bold border transition-colors ${
                        getLevelColor(l.level?.toUpperCase() || 'OFF', true)
                      }`}
                    >
                      {levels.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                    {l.effectiveLevel && l.effectiveLevel !== l.level && (
                      <div className="text-xs text-gray-500 mt-1">Effective: {l.effectiveLevel}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-xs truncate max-w-xs" title={l.clazz}>{l.clazz}</td>
                  <td className="px-6 py-4 text-gray-400 text-xs">
                    {!showAppenderDetails ? (
                      <div>{l.appenders?.map((a: any) => a.name || a).join(', ') || 'N/A'}</div>
                    ) : (
                      <div className="space-y-1">
                        {l.appenders?.length ? (
                          l.appenders.map((a: any, ai: number) => (
                            <div key={ai} className="p-2 bg-gray-50 rounded">
                              <div className="font-medium text-gray-700">{a.name || a}</div>
                              {a.type && <div className="text-xs">Type: {a.type}</div>}
                              {a.level && <div className="text-xs">Level: {a.level}</div>}
                              {a.threshold && <div className="text-xs">Threshold: {a.threshold}</div>}
                              {a.encoding && <div className="text-xs">Encoding: {a.encoding}</div>}
                            </div>
                          ))
                        ) : (
                          <span>N/A</span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
