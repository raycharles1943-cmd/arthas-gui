import { useState, useEffect } from 'react'
import { arthas } from '../utils/arthas'
import { usePersistentState } from '../utils/usePersistentState'
import { 
  History, Play, Trash2, Search, RefreshCw, ChevronRight, ChevronDown, 
  Terminal, Clock, Info, Activity, Filter, Download, Upload, 
  BarChart3, Zap, AlertCircle, CheckCircle, X, 
  Eye, EyeOff, Hash, Database, Cpu, BarChart, PieChart,
  CheckSquare, Square, PlayCircle, Layers, Sliders,
  Calendar, FolderOpen, FileText, Copy, Maximize2, Minimize2
} from 'lucide-react'

export function TimeTunnel() {
  const [records, setRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [searchClass, setSearchClass] = usePersistentState('tt_class_name', '')
  const [searchMethod, setSearchMethod] = usePersistentState('tt_method_name', '')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  
  // 新增状态
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set())
  const [showStats, setShowStats] = useState(false)
  const [displayLimit, setDisplayLimit] = usePersistentState('tt_display_limit', '5')
  const [detailViewMode, setDetailViewMode] = useState<'simple' | 'verbose' | 'java'>('java')
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const [recordCount, setRecordCount] = useState(5)
  const [costThreshold, setCostThreshold] = useState('100')
  const [recordNumber, setRecordNumber] = usePersistentState('tt_record_number', '5') // -n 参数，默认为5

  const fetchRecords = async () => {
    setLoading(true)
    try {
      const results = await arthas.ttList()
      console.log(`ttList results: ${JSON.stringify(results)}`)
      
      // 查找tt类型的响应
      const res = results.find(r => r.type === 'tt')
      
      // Arthas的tt -l命令可能返回不同的字段名
      if (res) {
        // 尝试所有可能的字段名
        let rawRecords = []
        if (res.timeFragmentList !== undefined) {
          rawRecords = Array.isArray(res.timeFragmentList) ? res.timeFragmentList : [res.timeFragmentList]
          console.log(`Using timeFragmentList: ${rawRecords.length} items`)
        } else if (res.timeTunnelData !== undefined) {
          rawRecords = Array.isArray(res.timeTunnelData) ? res.timeTunnelData : [res.timeTunnelData]
          console.log(`Using timeTunnelData: ${rawRecords.length} items`)
        } else if (res.timeFragment !== undefined) {
          // 单个timeFragment对象
          rawRecords = [res.timeFragment]
          console.log(`Using single timeFragment object`)
        } else {
          console.log(`No known data field found in tt result`, res)
        }
        
        // 标准化记录格式以确保与组件兼容
        const records = rawRecords.map(formatTimeTunnelRecord)
        console.log(`Parsed tt records: ${records.length} items`)
        setRecords(records)
      } else {
        setRecords([])
      }
    } catch (err) {
      console.error('Failed to fetch tt records:', err)
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  const handleRecord = async () => {
    if (!searchClass || !searchMethod) return
    setLoading(true)
    try {
      const n = parseInt(recordNumber) || 5
      console.log(`Starting tt record with -n ${n}: ${searchClass} ${searchMethod}`)
      await arthas.ttRecord(searchClass, searchMethod, n)
      fetchRecords()
    } catch (err) {
      alert('Failed to start recording')
    } finally {
      setLoading(false)
    }
  }

  const handleShowDetail = async (index: string) => {
    if (expandedId === index) {
      setExpandedId(null)
      return
    }
    setExpandedId(index)
    setDetailLoading(true)
    try {
      const results = await arthas.ttShow(index)
      console.log(`ttShow results for index ${index}:`, JSON.stringify(results))
      const res = results.find(r => r.type === 'tt')
      console.log(`Found tt result:`, res)
      // Arthas的不同版本返回的字段名不同，需要处理所有可能的情况
      let detailData = null
      if (res) {
        // 尝试所有可能的字段名
        if (res.timeFragment !== undefined) {
          // 新版格式：包含timeFragment字段
          detailData = res.timeFragment
          console.log(`Found detail in timeFragment field`)
        } else if (res.timeFragmentList && res.timeFragmentList.length > 0) {
          // 旧版格式：timeFragmentList数组
          detailData = res.timeFragmentList[0]
          console.log(`Found detail in timeFragmentList field`)
        } else if (res.timeTunnelData && res.timeTunnelData.length > 0) {
          // 另一个可能的格式：timeTunnelData数组
          detailData = res.timeTunnelData[0]
          console.log(`Found detail in timeTunnelData field`)
        } else {
          // 尝试直接访问可能的数据字段
          detailData = res
          console.log(`Using result directly as detail`)
        }
      }
      console.log(`Raw detail data:`, detailData)
      const formattedDetail = detailData ? formatTimeTunnelRecord(detailData) : null
      console.log(`Formatted detail:`, formattedDetail)
      setDetail(formattedDetail)
    } catch (err) {
      console.error('Failed to fetch detail:', err)
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handlePlay = async (index: string) => {
    try {
      const results = await arthas.ttPlay(index)
      const res = results.find(r => r.type === 'tt')
      // ttPlay可能返回不同的字段名
      let playResult = null
      if (res) {
        if (res.timeFragment !== undefined) {
          playResult = res.timeFragment
        } else if (res.timeFragmentList && res.timeFragmentList.length > 0) {
          playResult = res.timeFragmentList[0]
        } else if (res.timeTunnelData && res.timeTunnelData.length > 0) {
          playResult = res.timeTunnelData[0]
        } else {
          playResult = res
        }
      }
      const returnObj = playResult?.returnObj || 'N/A'
      alert(`Replay Success! 
Result: ${JSON.stringify(returnObj, null, 2)}`)
    } catch (err) {
      alert('Replay failed')
    }
  }

  const handleDelete = async (index: string) => {
    try {
      await arthas.ttDelete(index)
      fetchRecords()
      // 从选中记录中移除
      const newSelected = new Set(selectedRecords)
      newSelected.delete(index)
      setSelectedRecords(newSelected)
    } catch (err) {
      alert('Delete failed')
    }
  }

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedRecords.size === 0) return
    
    if (!confirm(`Are you sure you want to delete ${selectedRecords.size} recorded invocation(s)?`)) {
      return
    }
    
    try {
      for (const index of selectedRecords) {
        await arthas.ttDelete(index)
      }
      fetchRecords()
      setSelectedRecords(new Set())
    } catch (err) {
      alert('Batch delete failed')
    }
  }

  // 批量回放
  const handleBatchPlay = async () => {
    if (selectedRecords.size === 0) return
    
    const results = []
    for (const index of selectedRecords) {
      try {
        const result = await arthas.ttPlay(index)
        const res = result.find((r: any) => r.type === 'tt')
        // ttPlay可能返回不同的字段名
        let playResult = null
        if (res) {
          if (res.timeFragment !== undefined) {
            playResult = res.timeFragment
          } else if (res.timeFragmentList && res.timeFragmentList.length > 0) {
            playResult = res.timeFragmentList[0]
          } else if (res.timeTunnelData && res.timeTunnelData.length > 0) {
            playResult = res.timeTunnelData[0]
          } else {
            playResult = res
          }
        }
        results.push({
          index,
          success: true,
          result: playResult?.returnObj || 'N/A'
        })
      } catch (err) {
        results.push({
          index,
          success: false,
          result: 'Replay failed'
        })
      }
    }
    
    alert(`Batch replay completed: ${results.filter(r => r.success).length} succeeded, ${results.filter(r => !r.success).length} failed`)
  }

  // 统计信息
  const getStats = () => {
    if (records.length === 0) return null
    
    const totalCost = records.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0)
    const avgCost = totalCost / records.length
    const maxCostRecord = records.reduce((max, r) => {
      const cost = parseFloat(r.cost) || 0
      return cost > (parseFloat(max.cost) || 0) ? r : max
    }, records[0])
    
    const methodCounts: Record<string, number> = {}
    records.forEach(r => {
      const key = `${r.className.split('.').pop()}.${r.methodName}`
      methodCounts[key] = (methodCounts[key] || 0) + 1
    })
    
    const topMethods = Object.entries(methodCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([method, count]) => `${method} (${count})`)
    
    const hasExceptions = records.some(r => r.isThrow === true)
    const withParams = records.filter(r => r.params && r.params.length > 0).length
    const withReturn = records.filter(r => r.returnObj !== null).length
    
    return {
      total: records.length,
      totalCost: totalCost.toFixed(2),
      avgCost: avgCost.toFixed(2),
      maxCost: parseFloat(maxCostRecord.cost) || 0,
      maxCostMethod: `${maxCostRecord.className.split('.').pop()}.${maxCostRecord.methodName}`,
      uniqueMethods: Object.keys(methodCounts).length,
      topMethods,
      hasExceptions,
      withParams,
      withReturn,
      paramPercent: Math.round(withParams / records.length * 100),
      returnPercent: Math.round(withReturn / records.length * 100)
    }
  }

  // 筛选记录
  const filteredRecords = searchQuery
    ? records.filter(record =>
        record.className.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.methodName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.timestamp.includes(searchQuery)
      )
    : records
  
  // 根据显示限制截取记录
  const displayedRecords = displayLimit === '1000' 
    ? filteredRecords 
    : filteredRecords.slice(0, parseInt(displayLimit) || 5)

  // 选中/取消选中所有
  const toggleSelectAll = () => {
    if (selectedRecords.size === displayedRecords.length) {
      setSelectedRecords(new Set())
    } else {
      setSelectedRecords(new Set(displayedRecords.map(r => r.index)))
    }
  }

  const toggleRecordSelection = (index: string) => {
    const newSelected = new Set(selectedRecords)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedRecords(newSelected)
  }

  // 导出功能
  const exportRecords = () => {
    const data = displayedRecords.map(record => ({
      index: record.index,
      className: record.className,
      methodName: record.methodName,
      timestamp: record.timestamp,
      cost: record.cost,
      params: record.params,
      returnObj: record.returnObj,
      isReturn: record.isReturn,
      isThrow: record.isThrow,
      object: record.object
    }))
    
    const dataStr = JSON.stringify(data, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `time-tunnel-records-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 高级搜索
  const handleAdvancedSearch = async () => {
    if (!searchClass && !searchMethod) {
      alert('Please enter at least class name or method name for search')
      return
    }
    
    setLoading(true)
    try {
      const results = await arthas.ttSearch(searchClass, searchMethod)
      const res = results.find((r: any) => r.type === 'tt')
      // ttSearch可能返回不同的字段名
      let rawRecords = []
      if (res) {
        if (res.timeFragmentList !== undefined) {
          rawRecords = Array.isArray(res.timeFragmentList) ? res.timeFragmentList : [res.timeFragmentList]
          console.log(`Search using timeFragmentList: ${rawRecords.length} items`)
        } else if (res.timeTunnelData !== undefined) {
          rawRecords = Array.isArray(res.timeTunnelData) ? res.timeTunnelData : [res.timeTunnelData]
          console.log(`Search using timeTunnelData: ${rawRecords.length} items`)
        } else if (res.timeFragment !== undefined) {
          // 单个timeFragment对象
          rawRecords = [res.timeFragment]
          console.log(`Search using single timeFragment object`)
        } else {
          console.log(`No known data field found in search result`, res)
        }
      }
      
      const records = rawRecords.map(formatTimeTunnelRecord)
      console.log(`Search results: ${records.length} items`)
      setRecords(records)
    } catch (err) {
      console.error('Search failed:', err)
      alert('Search failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRecords()
  }, [])

  // 标准化TimeTunnel记录格式
  const formatTimeTunnelRecord = (record: any) => {
    if (!record) return record
    
    const formatted: any = { ...record }
    
    // 确保必要的字段存在并正确命名
    if (record.index !== undefined) formatted.index = String(record.index)
    if (record.timestamp !== undefined) formatted.timestamp = String(record.timestamp)
    if (record.cost !== undefined) formatted.cost = String(record.cost)
    if (record.className !== undefined) formatted.className = String(record.className)
    if (record.methodName !== undefined) formatted.methodName = String(record.methodName)
    
    // 映射字段名以匹配组件的期望 - 注意：params和returnObj应该保持原样
    if (record.returnObj !== undefined) formatted.returnObj = record.returnObj
    if (record.params !== undefined) {
      if (Array.isArray(record.params)) {
        formatted.params = [...record.params]  // 复制数组
      } else {
        formatted.params = record.params
      }
    }
    
    // 处理布尔值字段
    if (record.isReturn !== undefined) formatted.isReturn = Boolean(record.isReturn)
    else if (record.return !== undefined) formatted.isReturn = Boolean(record.return)
    
    if (record.isThrow !== undefined) formatted.isThrow = Boolean(record.isThrow)
    else if (record.throw !== undefined) formatted.isThrow = Boolean(record.throw)
    
    // 处理object字段
    if (record.object !== undefined) formatted.object = String(record.object)
    
    // 确保throwExp字段
    if (record.throwExp !== undefined) formatted.throwExp = record.throwExp
    
    console.log(`Formatted record: index=${formatted.index}, className=${formatted.className}, cost=${formatted.cost}, params=${formatted.params ? `array(${formatted.params.length})` : 'null'}, returnObj=${formatted.returnObj ? `string(${formatted.returnObj.length} chars)` : 'null'}, isReturn=${formatted.isReturn}`)
    return formatted
  }

  return (
    <div className="flex h-full bg-gray-50">
      {/* Left: Control Panel */}
      <div className="w-96 border-r bg-white p-6 flex flex-col gap-6 shadow-sm z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <History size={20} className="text-blue-600" />
            <h2 className="text-lg font-bold text-gray-800">Time Tunnel</h2>
          </div>
          <button
            onClick={() => setShowStats(!showStats)}
            className={`p-2 rounded-lg transition-colors ${showStats ? 'bg-green-100 text-green-600' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Toggle Statistics"
          >
            <BarChart3 size={16} />
          </button>
        </div>

        {/* 统计面板 */}
        {showStats && records.length > 0 && (
          <div className="bg-gradient-to-br from-green-50 to-blue-50 border border-green-200 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-gradient-to-r from-green-100 to-blue-100 rounded-lg">
                  <BarChart3 size={14} className="text-green-600" />
                </div>
                <p className="text-xs font-bold text-gray-700">Recording Analytics</p>
              </div>
              <span className="px-2 py-0.5 bg-white border rounded-lg text-[10px] font-medium text-gray-600">
                {records.length} records
              </span>
            </div>
            {(() => {
              const stats = getStats()
              return stats && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/70 rounded-lg p-2 border">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500">Avg Cost</span>
                        <Zap size={12} className="text-yellow-500" />
                      </div>
                      <div className="text-lg font-bold text-gray-800 mt-1">{stats.avgCost}ms</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        Total: {stats.totalCost}ms
                      </div>
                    </div>
                    
                    <div className="bg-white/70 rounded-lg p-2 border">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500">Unique Methods</span>
                        <Database size={12} className="text-purple-500" />
                      </div>
                      <div className="text-lg font-bold text-gray-800 mt-1">{stats.uniqueMethods}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {stats.topMethods.length > 0 && `Top: ${stats.topMethods[0]}`}
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700">Data Quality</span>
                      <div className="flex items-center gap-1">
                        {stats.hasExceptions ? (
                          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded flex items-center gap-0.5">
                            <AlertCircle size={8} />
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
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-xs text-gray-600">
                        With Parameters: <span className="font-bold text-gray-800">{stats.withParams} ({stats.paramPercent}%)</span>
                      </div>
                      <div className="text-xs text-gray-600">
                        With Return: <span className="font-bold text-gray-800">{stats.withReturn} ({stats.returnPercent}%)</span>
                      </div>
                    </div>
                    
                    {stats.maxCost > 0 && (
                      <div className="pt-2 border-t">
                        <div className="text-xs text-gray-600 flex items-center justify-between">
                          <span>Max Cost:</span>
                          <span className="font-bold text-gray-800">{stats.maxCost}ms ({stats.maxCostMethod})</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center justify-between">
              Class Name
              <button
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                className="text-[9px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
              >
                <Sliders size={9} />
                {showAdvancedOptions ? 'Hide Options' : 'More Options'}
              </button>
            </label>
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 hover:bg-white transition-all"
              placeholder="com.example.Service"
              value={searchClass}
              onChange={(e) => setSearchClass(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Method Name</label>
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 hover:bg-white transition-all"
              placeholder="getUser"
              value={searchMethod}
              onChange={(e) => setSearchMethod(e.target.value)}
            />
          </div>
          
          {/* -n 参数设置 */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-1">
              <Hash size={10} />
              Recording Count (-n)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="1"
                max="100"
                step="1"
                className="flex-1 h-1.5 rounded-lg appearance-none bg-gradient-to-r from-blue-200 to-purple-200 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-blue-500"
                value={recordNumber}
                onChange={(e) => setRecordNumber(e.target.value)}
              />
              <div className="w-16">
                <input
                  type="number"
                  min="1"
                  max="1000"
                  className="w-full px-2 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 hover:bg-white transition-all text-center"
                  value={recordNumber}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === '' || (parseInt(value) >= 1 && parseInt(value) <= 1000)) {
                      setRecordNumber(value)
                    }
                  }}
                />
              </div>
              <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
                invocations
              </span>
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 px-0.5">
              <span>1</span>
              <span className="font-medium">{recordNumber}</span>
              <span>100</span>
            </div>
          </div>
          
          {showAdvancedOptions && (
            <div className="space-y-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-1">
                  <Calendar size={10} />
                  Display Limit
                </label>
                <select
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={displayLimit}
                  onChange={(e) => setDisplayLimit(e.target.value)}
                >
                  <option value="5">Show 5 records</option>
                  <option value="10">Show 10 records</option>
                  <option value="20">Show 20 records</option>
                  <option value="50">Show 50 records</option>
                  <option value="100">Show 100 records</option>
                  <option value="1000">Show all records</option>
                </select>
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-1">
                  <AlertCircle size={10} />
                  Cost Threshold (ms)
                </label>
                <input
                  type="range"
                  min="0"
                  max="5000"
                  step="100"
                  className="w-full h-1.5 rounded-lg appearance-none bg-gradient-to-r from-blue-200 to-purple-200 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-blue-400"
                  value={costThreshold}
                  onChange={(e) => setCostThreshold(e.target.value)}
                />
                <div className="flex justify-between text-[9px] text-gray-400">
                  <span>0ms</span>
                  <span>{costThreshold}ms</span>
                  <span>5000ms</span>
                </div>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleRecord}
              disabled={loading || !searchClass || !searchMethod}
              className="py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:from-blue-700 hover:to-purple-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
              Record
            </button>
            <button
              onClick={handleAdvancedSearch}
              disabled={loading || (!searchClass && !searchMethod)}
              className="py-2.5 bg-gradient-to-r from-gray-700 to-gray-800 text-white rounded-xl font-bold text-sm shadow-lg shadow-gray-500/20 hover:from-gray-800 hover:to-gray-900 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search size={16} />
              Search
            </button>
          </div>
        </div>

        <div className="mt-auto space-y-4">
          <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
            <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-1">
              <Info size={10} className="inline mr-1" />
              Pro Tip
            </p>
            <p className="text-xs text-blue-700/70 leading-relaxed">
              Time Tunnel records method calls with full context (parameters, return values, exceptions) and allows replay anytime.
            </p>
            <div className="mt-2 flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1 text-blue-600">
                <Zap size={12} />
                <span>Record & Replay</span>
              </div>
              <div className="flex items-center gap-1 text-purple-600">
                <Layers size={12} />
                <span>Full Context</span>
              </div>
              <div className="flex items-center gap-1 text-green-600">
                <Eye size={12} />
                <span>Debug Tool</span>
              </div>
            </div>
          </div>
          
          {/* 批量操作 */}
          {selectedRecords.size > 0 && (
            <div className="p-3 bg-gradient-to-r from-orange-50 to-yellow-50 rounded-lg border border-orange-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-700">{selectedRecords.size} selected</span>
                <button
                  onClick={() => setSelectedRecords(new Set())}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  title="Clear selection"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleBatchPlay}
                  className="px-3 py-1.5 text-xs font-medium text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <PlayCircle size={12} />
                  Replay All
                </button>
                <button
                  onClick={handleBatchDelete}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <Trash2 size={12} />
                  Delete All
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Records List */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {/* Header with Search and Actions */}
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg">
                <Activity className="text-blue-600" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-800">Recorded Invocations</h2>
                <p className="text-sm text-gray-500">
                  {displayedRecords.length} record{displayedRecords.length !== 1 ? 's' : ''} shown ({filteredRecords.length} total), {selectedRecords.size} selected
                </p>
              </div>
            </div>
            
            <div className="flex flex-col md:flex-row gap-3 md:items-center">
              {/* Search Input */}
              <div className="relative flex-1">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Search size={14} />
                </div>
                <input
                  type="text"
                  placeholder="Search by class, method, or timestamp..."
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
              
              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                  className="px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1"
                >
                  <Filter size={14} />
                  Filter
                </button>
                <button
                  onClick={exportRecords}
                  className="px-3 py-2 text-xs font-medium text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors flex items-center gap-1"
                >
                  <Download size={14} />
                  Export
                </button>
                <button
                  onClick={fetchRecords}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Refresh Records"
                >
                  <RefreshCw size={18} className={`${loading ? 'animate-spin' : ''} text-gray-500`} />
                </button>
              </div>
            </div>
          </div>
          
          {/* 批量操作栏 */}
          {selectedRecords.size > 0 && (
            <div className="mt-4 p-3 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={toggleSelectAll}
                    className="p-1 text-gray-500 hover:text-gray-700"
                    title="Toggle select all"
                  >
                    {selectedRecords.size === displayedRecords.length ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                  <span className="text-sm font-medium text-gray-700">
                    {selectedRecords.size} invocation{selectedRecords.size !== 1 ? 's' : ''} selected
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBatchPlay}
                    className="px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700 rounded-lg transition-all flex items-center gap-1"
                  >
                    <PlayCircle size={12} />
                    Replay Selected
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    className="px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700 rounded-lg transition-all flex items-center gap-1"
                  >
                    <Trash2 size={12} />
                    Delete Selected
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {records.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-400 bg-white rounded-3xl border-2 border-dashed border-gray-100">
            <Clock size={40} className="opacity-10 mb-2" />
            <p className="text-sm">No recordings found. Start by recording a method.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedRecords.map((r) => (
              <div key={r.index} className="bg-white border rounded-2xl shadow-sm overflow-hidden border-gray-200 hover:border-blue-200 transition-colors">
                {/* 记录头 */}
                <div className="px-6 py-4 flex items-start gap-3">
                  {/* 选择框 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleRecordSelection(r.index)
                    }}
                    className="mt-1 p-0.5"
                  >
                    {selectedRecords.has(r.index) ? (
                      <CheckSquare size={14} className="text-blue-500" />
                    ) : (
                      <Square size={14} className="text-gray-300" />
                    )}
                  </button>
                  
                  {/* 主要内容 */}
                  <div 
                    className="flex-1 flex items-center justify-between cursor-pointer"
                    onClick={() => handleShowDetail(r.index)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 flex flex-col items-center">
                          <span className="font-mono text-xs font-bold text-blue-600">#{r.index}</span>
                          <span className="text-[9px] text-gray-400">ID</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${parseFloat(r.cost) > 1000 ? 'bg-red-500' : parseFloat(r.cost) > 100 ? 'bg-yellow-500' : 'bg-green-500'}`} />
                            <div className="flex flex-col">
                              <span className="font-bold text-gray-700 text-sm">{r.methodName}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 font-mono truncate max-w-[200px]">{r.className}</span>
                                {r.params && r.params.length > 0 && (
                                  <span className="text-[10px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">
                                    {r.params.length} param{r.params.length !== 1 ? 's' : ''}
                                  </span>
                                )}
                                {r.returnObj && (
                                  <span className="text-[10px] px-1 py-0.5 bg-green-100 text-green-700 rounded">
                                    Has return
                                  </span>
                                )}
                                {r.isThrow === true && (
                                  <span className="text-[10px] px-1 py-0.5 bg-red-100 text-red-700 rounded">
                                    Exception
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4 mt-1">
                            <div className="flex items-center gap-1 px-2 py-0.5 bg-gray-50 rounded-lg">
                              <Clock size={10} className="text-gray-400" />
                              <span className="text-[10px] font-mono text-gray-500">{r.timestamp}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Zap size={10} className="text-yellow-500" />
                              <span className="text-[10px] font-mono font-bold text-gray-700">{r.cost}ms</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Cpu size={10} className="text-purple-500" />
                              <span className="text-[10px] font-mono text-gray-500">{r.object || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handlePlay(r.index); }}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Replay"
                      >
                        <Play size={18} fill="currentColor" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(r.index); }}
                        className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                      {expandedId === r.index ? <ChevronDown size={20} className="text-blue-400" /> : <ChevronRight size={20} className="text-gray-300" />}
                    </div>
                  </div>
                </div>

                {expandedId === r.index && (
                  <div className="p-6 bg-gray-50 border-t space-y-4 animate-in fade-in slide-in-from-top-1">
                    {/* 显示模式控制 */}
                    <div className="flex justify-between items-center mb-4">
                      <div className="text-sm font-medium text-gray-700">Detail View</div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDetailViewMode('simple')}
                          className={`px-3 py-1 text-xs rounded transition-all ${detailViewMode === 'simple' 
                            ? 'bg-blue-100 text-blue-600 border border-blue-200' 
                            : 'text-gray-500 hover:bg-gray-100'}`}
                        >
                          Simple
                        </button>
                        <button
                          onClick={() => setDetailViewMode('verbose')}
                          className={`px-3 py-1 text-xs rounded transition-all ${detailViewMode === 'verbose' 
                            ? 'bg-purple-100 text-purple-600 border border-purple-200' 
                            : 'text-gray-500 hover:bg-gray-100'}`}
                        >
                          Verbose
                        </button>
                        <button
                          onClick={() => setDetailViewMode('java')}
                          className={`px-3 py-1 text-xs rounded transition-all ${detailViewMode === 'java' 
                            ? 'bg-orange-100 text-orange-600 border border-orange-200' 
                            : 'text-gray-500 hover:bg-gray-100'}`}
                        >
                          Java Format
                        </button>
                      </div>
                    </div>
                    
                    {detailLoading ? (
                      <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
                        <RefreshCw size={20} className="animate-spin" />
                        Loading details...
                      </div>
                    ) : detail ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <ImprovedDetailBlock 
                          title="Parameters" 
                          data={detail.params} 
                          viewMode={detailViewMode}
                          icon={<Database size={12} />}
                        />
                        <ImprovedDetailBlock 
                          title="Return Object" 
                          data={detail.returnObj} 
                          viewMode={detailViewMode}
                          icon={<FolderOpen size={12} />}
                        />
                        <div className="lg:col-span-2">
                          <ImprovedDetailBlock 
                            title="Execution Info" 
                            data={{ 
                              cost: detail.cost + 'ms', 
                              isReturn: detail.isReturn, 
                              isThrow: detail.isThrow,
                              object: detail.object,
                              className: detail.className,
                              methodName: detail.methodName,
                              timestamp: detail.timestamp
                            }} 
                            viewMode={detailViewMode}
                            icon={<FileText size={12} />}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic text-center">Failed to load record details.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailBlock({ title, data }: any) {
  return (
    <div className="bg-[#1e1e1e] rounded-xl p-4 shadow-inner border border-white/5">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 border-b border-white/5 pb-1">{title}</p>      
      <pre className="font-mono text-[11px] text-gray-300 overflow-x-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

interface ImprovedDetailBlockProps {
  title: string;
  data: any;
  viewMode: 'simple' | 'verbose' | 'java';
  icon?: React.ReactNode;
}

function ImprovedDetailBlock({ title, data, viewMode, icon }: ImprovedDetailBlockProps) {
  // 确保expanded状态正确，Java模式默认应该展开
  const [expanded, setExpanded] = useState(viewMode !== 'simple');
  const [copySuccess, setCopySuccess] = useState(false);
  
  console.log(`ImprovedDetailBlock: title=${title}, viewMode=${viewMode}, expanded=${expanded}, data=`, data)
  
  // 当viewMode改变时，确保expanded状态同步
  useEffect(() => {
    console.log(`useEffect: viewMode changed to ${viewMode}, setting expanded to ${viewMode !== 'simple'}`)
    setExpanded(viewMode !== 'simple')
  }, [viewMode])
  
  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      .then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      })
      .catch(err => console.error('Copy failed:', err));
  };
  
  const renderContent = () => {
    console.log(`renderContent: data=`, data, `typeof data=`, typeof data, `viewMode=${viewMode}`)
    
    if (data === null || data === undefined) {
      return <span className="text-gray-400 italic">null</span>;
    }
    
    // 特殊处理：对于Java格式的字符串，即使viewMode不是java，如果字符串包含@也显示为Java格式
    if (typeof data === 'string' && data.includes('@')) {
      console.log(`Detected Java format string, using JavaObjectValueDisplay`)
      return <JavaObjectValueDisplay value={data} />;
    }
    
    const stringData = typeof data === 'string' ? data : JSON.stringify(data, null, viewMode === 'simple' ? 0 : 2);
    
    if (viewMode === 'simple') {
      const displayText = typeof data === 'string' 
        ? (data.length > 100 ? data.substring(0, 100) + '...' : data)
        : (JSON.stringify(data).length > 100 ? JSON.stringify(data).substring(0, 100) + '...' : JSON.stringify(data));
      
      return (
        <div className="font-mono text-xs text-gray-300 overflow-x-auto py-1">
          {displayText}
        </div>
      );
    }
    
    if (viewMode === 'verbose' || viewMode === 'java') {
      return (
        <pre className="font-mono text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto py-2">
          {stringData}
        </pre>
      );
    }
    
    return (
      <pre className="font-mono text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto py-2">
        {stringData}
      </pre>
    );
  };
  
  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-4 shadow-inner border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon && <div className="text-gray-400">{icon}</div>}
          <p className="text-xs font-bold text-gray-300 uppercase tracking-widest">{title}</p>
          {data !== null && data !== undefined && (
            <span className="text-[10px] text-gray-500">
              {typeof data === 'string' 
                ? `${data.length} chars`
                : `${typeof data} ${Array.isArray(data) ? `(${data.length} items)` : `(${Object.keys(data || {}).length} props)`}`
              }
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-gray-400 hover:text-gray-300"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={handleCopy}
            className={`p-1 ${copySuccess ? 'text-green-500' : 'text-gray-400 hover:text-gray-300'}`}
            title="Copy to clipboard"
          >
            <Copy size={14} />
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="border-t border-gray-700 pt-3">
          {renderContent()}
        </div>
      )}
    </div>
  );
}

// Java对象值显示组件
function JavaObjectValueDisplay({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  
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
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Java Format</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded">
            {value.match(/^@(\w+)/)?.[1] || 'Object'}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-0.5 text-[10px] font-medium text-orange-500 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors flex items-center gap-1"
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      
      {expanded ? (
        <div className="bg-gray-800/70 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Formatted View</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">
                  {formattedValue.split('\n').length} lines
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
          <div className="max-h-[400px] overflow-y-auto">
            <pre className="text-xs text-gray-300 font-mono p-3 whitespace-pre">
              {formattedValue}
            </pre>
          </div>
        </div>
      ) : (
        <div className="bg-gray-800/50 rounded-lg p-2">
          <pre className="text-xs text-gray-400 font-mono truncate">
            {value.split('\n')[0]}
            {value.split('\n').length > 1 && ' ...'}
          </pre>
        </div>
      )}
    </div>
  );
}
