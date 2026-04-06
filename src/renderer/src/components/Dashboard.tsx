import { useState, useEffect } from 'react'
import { arthas } from '../utils/arthas'
import { Cpu, MemoryStick, Activity, Layers, RefreshCw, Clock, Trash2 } from 'lucide-react'
import { MemoryChartRecharts } from './MemoryChartRecharts'

interface MemoryDataPoint {
  timestamp: number
  // Heap 内存 - 基础
  heapUsed: number
  heapTotal: number
  
  // PS 垃圾收集器 (默认)
  psEdenSpaceUsed?: number
  psEdenSpaceTotal?: number
  psSurvivorSpaceUsed?: number
  psSurvivorSpaceTotal?: number
  psOldGenUsed?: number
  psOldGenTotal?: number
  
  // G1 垃圾收集器
  g1EdenSpaceUsed?: number
  g1EdenSpaceTotal?: number
  g1SurvivorSpaceUsed?: number
  g1SurvivorSpaceTotal?: number
  g1OldGenUsed?: number
  g1OldGenTotal?: number
  
  // CMS 垃圾收集器
  cmsEdenSpaceUsed?: number
  cmsEdenSpaceTotal?: number
  cmsSurvivorSpaceUsed?: number
  cmsSurvivorSpaceTotal?: number
  cmsOldGenUsed?: number
  cmsOldGenTotal?: number
  
  // 完整的非堆内存区域
  // Non-Heap 内存
  nonheapUsed: number
  nonheapTotal: number
  
  // 元空间（Metaspace）详情
  metaspaceUsed?: number
  metaspaceTotal?: number
  metaspaceCommitted?: number // 已提交内存
  
  // Code Cache
  codeCacheUsed?: number
  codeCacheTotal?: number
  
  // Compressed Class Space
  compressedClassSpaceUsed?: number
  compressedClassSpaceTotal?: number
  
  // 其他内存区域
  directBufferMemoryUsed?: number
  directBufferMemoryTotal?: number
  mappedBufferMemoryUsed?: number
  mappedBufferMemoryTotal?: number
  
  // Class Loader 相关内存
  classDataUsed?: number
  classDataTotal?: number
  
  // Large Object Heap 内存（针对 G1GC）
  g1HumongousUsed?: number
  g1HumongousTotal?: number
  
  // 其他监控指标
  totalMemoryUsed?: number  // 总已使用内存
  totalMemoryCommitted?: number  // 总提交内存
  totalMemoryMax?: number  // 最大可用内存
}

export function Dashboard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [memoryHistory, setMemoryHistory] = useState<MemoryDataPoint[]>([])
  const [maxHistoryPoints, setMaxHistoryPoints] = useState(60) // 默认保留60个数据点
  const [paused, setPaused] = useState(false)

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null) // 清除之前的错误
      
      // 获取dashboard数据和详细内存数据
      const [dashboardResults, memoryResults] = await Promise.all([
        arthas.dashboard(),
        arthas.memory().catch(err => {
          console.warn('[Dashboard] Failed to fetch memory data:', err)
          return [] // 返回空数组而不是抛出错误
        })
      ])
      
      const dashboardResult = dashboardResults.find(r => r.type === 'dashboard')
      
      if (dashboardResult) {
        console.log(`[Dashboard] Received dashboard data:`, dashboardResult)
        setData(dashboardResult)
        
        // 处理详细内存数据
        const memoryResult = memoryResults.find(r => r.type === 'memory') || {}
        if (memoryResult) {
          console.log(`[Dashboard] Received detailed memory data:`, memoryResult)
        }
        
        // 收集时间序列数据（如果当前没有暂停）
        if (!paused) {
          const timestamp = Date.now()
          const newDataPoint = createMemoryDataPoint(timestamp, dashboardResult, memoryResult)
          
          setMemoryHistory(prev => {
            const newHistory = [...prev, newDataPoint]
            // 限制历史数据点数量
            if (newHistory.length > maxHistoryPoints) {
              return newHistory.slice(-maxHistoryPoints)
            }
            return newHistory
          })
        }
      } else {
        console.warn('No dashboard data found in response:', dashboardResults)
        setError('Dashboard API response missing dashboard data. Check Arthas connection.')
      }
      
    } catch (err: any) {
      console.error('[Dashboard] Failed to fetch dashboard data:', err)
      setError(`Failed to fetch dashboard data: ${err?.message || err}. Make sure Arthas is still connected.`)
    } finally {
      setLoading(false)
    }
  }
  
  // 创建内存数据点
  const createMemoryDataPoint = (timestamp: number, dashboardData: any, memoryData: any): MemoryDataPoint => {
    const dataPoint: MemoryDataPoint = {
      timestamp,
      heapUsed: 0,
      heapTotal: 0,
      nonheapUsed: 0,
      nonheapTotal: 0
    }
    
    // 从 dashboard 数据提取基础信息
    if (dashboardData?.memoryInfo) {
      const memoryInfo = dashboardData.memoryInfo
      const heapSummary = Array.isArray(memoryInfo.heap) 
        ? memoryInfo.heap.find((h: any) => h.name === 'heap') 
        : (memoryInfo.heap || {})
      
      const nonheapSummary = Array.isArray(memoryInfo.nonheap) 
        ? memoryInfo.nonheap.find((h: any) => h.name === 'nonheap') 
        : (memoryInfo.nonheap || {})
      
      dataPoint.heapUsed = parseFloat(heapSummary.used) || 0
      dataPoint.heapTotal = parseFloat(heapSummary.total) || 0
      dataPoint.nonheapUsed = parseFloat(nonheapSummary.used) || 0
      dataPoint.nonheapTotal = parseFloat(nonheapSummary.total) || 0
    }
    
    // 从 memory 数据提取详细分类信息
    if (memoryData) {
      // 提取 heap 详细分类（支持多种垃圾收集器）
      if (Array.isArray(memoryData.heap)) {
        memoryData.heap.forEach((heapItem: any) => {
          const name = heapItem.name || ''
          const used = parseFloat(heapItem.used) || 0
          const total = parseFloat(heapItem.total) || 0
          
          // PS 垃圾收集器
          if (name.includes('PS Eden') || name.includes('Par Eden')) {
            dataPoint.psEdenSpaceUsed = used
            dataPoint.psEdenSpaceTotal = total
          } else if (name.includes('PS Survivor') || name.includes('Par Survivor')) {
            dataPoint.psSurvivorSpaceUsed = used
            dataPoint.psSurvivorSpaceTotal = total
          } else if (name.includes('PS Old') || name.includes('Par Old')) {
            dataPoint.psOldGenUsed = used
            dataPoint.psOldGenTotal = total
          }
          
          // G1 垃圾收集器
          if (name.includes('G1 Eden')) {
            dataPoint.g1EdenSpaceUsed = used
            dataPoint.g1EdenSpaceTotal = total
          } else if (name.includes('G1 Survivor')) {
            dataPoint.g1SurvivorSpaceUsed = used
            dataPoint.g1SurvivorSpaceTotal = total
          } else if (name.includes('G1 Old')) {
            dataPoint.g1OldGenUsed = used
            dataPoint.g1OldGenTotal = total
          } else if (name.includes('G1 Humongous')) {
            dataPoint.g1HumongousUsed = used
            dataPoint.g1HumongousTotal = total
          }
          
          // CMS 垃圾收集器
          if (name.includes('CMS Eden')) {
            dataPoint.cmsEdenSpaceUsed = used
            dataPoint.cmsEdenSpaceTotal = total
          } else if (name.includes('CMS Survivor')) {
            dataPoint.cmsSurvivorSpaceUsed = used
            dataPoint.cmsSurvivorSpaceTotal = total
          } else if (name.includes('CMS Old')) {
            dataPoint.cmsOldGenUsed = used
            dataPoint.cmsOldGenTotal = total
          }
          
          // 通用 Eden/Old Gen 检测（如果未匹配到特定收集器）
          if (!dataPoint.psEdenSpaceUsed && name.includes('Eden')) {
            dataPoint.psEdenSpaceUsed = used
            dataPoint.psEdenSpaceTotal = total
          }
          if (!dataPoint.psOldGenUsed && (name.includes('Old') || name.includes('Tenured'))) {
            dataPoint.psOldGenUsed = used
            dataPoint.psOldGenTotal = total
          }
        })
      }
      
      // 提取 nonheap 详细分类（包括完整的 Metaspace 信息）
      if (Array.isArray(memoryData.nonheap)) {
        memoryData.nonheap.forEach((nonheapItem: any) => {
          const name = nonheapItem.name || ''
          const used = parseFloat(nonheapItem.used) || 0
          const total = parseFloat(nonheapItem.total) || 0
          const committed = parseFloat(nonheapItem.committed) || 0
          
          if (name.includes('Metaspace')) {
            dataPoint.metaspaceUsed = used
            dataPoint.metaspaceTotal = total
            if (committed > 0) dataPoint.metaspaceCommitted = committed
          } else if (name.includes('Code Cache')) {
            dataPoint.codeCacheUsed = used
            dataPoint.codeCacheTotal = total
          } else if (name.includes('Compressed Class')) {
            dataPoint.compressedClassSpaceUsed = used
            dataPoint.compressedClassSpaceTotal = total
          } else if (name.includes('Class Data')) {
            dataPoint.classDataUsed = used
            dataPoint.classDataTotal = total
          }
        })
      }
      
      // 处理其他内存区域
      if (Array.isArray(memoryData.directBuffers)) {
        memoryData.directBuffers.forEach((bufferItem: any) => {
          if (bufferItem.name === 'Direct Buffer') {
            dataPoint.directBufferMemoryUsed = parseFloat(bufferItem.used) || 0
            dataPoint.directBufferMemoryTotal = parseFloat(bufferItem.total) || 0
          } else if (bufferItem.name === 'Mapped Buffer') {
            dataPoint.mappedBufferMemoryUsed = parseFloat(bufferItem.used) || 0
            dataPoint.mappedBufferMemoryTotal = parseFloat(bufferItem.total) || 0
          }
        })
      }
      
      // 添加内存使用总和统计（如果 Arthas API 返回）
      if (memoryData.totalUsed) {
        dataPoint.totalMemoryUsed = parseFloat(memoryData.totalUsed) || 0
      }
      if (memoryData.totalCommitted) {
        dataPoint.totalMemoryCommitted = parseFloat(memoryData.totalCommitted) || 0
      }
      if (memoryData.totalMax) {
        dataPoint.totalMemoryMax = parseFloat(memoryData.totalMax) || 0
      }
    }
    
    return dataPoint
  }

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 5000)
    return () => clearInterval(timer)
  }, [])

  // 当maxHistoryPoints改变时，限制历史数据数量
  useEffect(() => {
    if (memoryHistory.length > maxHistoryPoints) {
      setMemoryHistory(prev => prev.slice(-maxHistoryPoints))
    }
  }, [maxHistoryPoints, memoryHistory.length])

  if (loading && !data && !error) return <div className="p-8 text-center">Loading dashboard...</div>
  // 即使有错误，如果有数据则显示数据，否则显示错误

  const threads = data?.threads || []
  const memory = data?.memoryInfo || {}
  const gcInfos = data?.gcInfos || []

  // Safe memory calculation
  const getMB = (bytes: any) => {
    const val = parseFloat(bytes)
    return isNaN(val) ? '0' : (val / 1024 / 1024).toFixed(0)
  }

  // Find the 'heap' summary in the heap array
  const heapSummary = Array.isArray(memory.heap) 
    ? memory.heap.find((h: any) => h.name === 'heap') 
    : (memory.heap || {})

  const heapUsed = heapSummary?.used || 0
  const heapTotal = heapSummary?.total || 0

  // Sum up GC stats from all collectors
  const gcCount = gcInfos.reduce((acc: number, curr: any) => acc + (curr.collectionCount || 0), 0)
  const gcTime = gcInfos.reduce((acc: number, curr: any) => acc + (curr.collectionTime || 0), 0)

  // 如果没有数据但有错误，只显示错误
  if (!data && error) return <div className="p-8 text-red-500 text-center">{error}</div>
  
  return (
    <div className="p-6 space-y-6">
      {/* 错误提示条（如果有错误但有数据） */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 flex items-center gap-3">
          <div className="text-red-500">⚠️</div>
          <div>
            <p className="font-medium">部分数据加载失败</p>
            <p className="text-sm opacity-80">{error}</p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          icon={<Cpu className="text-blue-500" />} 
          title="CPU Usage" 
          value={`${(threads[0]?.cpu || 0).toFixed(1)}%`} 
          subtitle="Top Thread"
        />
        <StatCard 
          icon={<MemoryStick className="text-green-500" />} 
          title="Heap Memory" 
          value={`${getMB(heapUsed)}MB`} 
          subtitle={`Total: ${getMB(heapTotal)}MB`}
        />
        <StatCard 
          icon={<Activity className="text-purple-500" />} 
          title="Threads" 
          value={threads.length} 
          subtitle="Total Active"
        />
        <StatCard 
          icon={<Layers className="text-orange-500" />} 
          title="GC Count" 
          value={gcCount} 
          subtitle={`Time: ${gcTime}ms`}
        />
      </div>

      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="font-semibold text-gray-800">内存使用趋势图 (Recharts)</div>
            {paused && (
              <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full flex items-center gap-1">
                <Clock size={12} />
                数据收集已暂停
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setPaused(!paused)}
              className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${
                paused 
                  ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              }`}
            >
              {paused ? (
                <>
                  <RefreshCw size={12} />
                  继续收集
                </>
              ) : (
                <>
                  <Clock size={12} />
                  暂停收集
                </>
              )}
            </button>
            <button
              onClick={() => setMemoryHistory([])}
              className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors flex items-center gap-1.5"
            >
              <Trash2 size={12} />
              清空历史
            </button>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <span>数据点:</span>
              <select 
                value={maxHistoryPoints}
                onChange={(e) => setMaxHistoryPoints(Number(e.target.value))}
                className="bg-gray-100 border rounded px-2 py-0.5 text-xs"
              >
                <option value="30">30</option>
                <option value="60">60</option>
                <option value="120">120</option>
                <option value="300">300</option>
                <option value="600">600</option>
              </select>
            </div>
          </div>
        </div>
        <div className="p-4" style={{ height: '600px' }}>
          <MemoryChartRecharts data={memoryHistory} maxPoints={maxHistoryPoints} />
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, title, value, subtitle }: any) {
  return (
    <div className="p-6 bg-white border rounded-xl shadow-sm flex items-start gap-4">
      <div className="p-3 bg-gray-50 rounded-lg">{icon}</div>
      <div>
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <h3 className="text-2xl font-bold text-gray-800">{value}</h3>
        <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
      </div>
    </div>
  )
}


