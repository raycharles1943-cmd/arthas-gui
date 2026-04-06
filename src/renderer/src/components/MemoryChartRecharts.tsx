import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts'

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

interface MemoryChartRechartsProps {
  data: MemoryDataPoint[]
  maxPoints?: number
}

// 定义图表线条的颜色配置
const COLOR_CONFIG = {
  // Heap 总和 - 蓝色系
  heapUsed: '#3b82f6',
  heapTotal: '#1d4ed8',
  
  // PS 垃圾收集器 - 标准色系
  psEdenSpaceUsed: '#10b981',
  psEdenSpaceTotal: '#047857',
  psSurvivorSpaceUsed: '#f59e0b',
  psSurvivorSpaceTotal: '#d97706',
  psOldGenUsed: '#ef4444',
  psOldGenTotal: '#dc2626',
  
  // G1 垃圾收集器 - 蓝色/青色系
  g1EdenSpaceUsed: '#0ea5e9',
  g1EdenSpaceTotal: '#0369a1',
  g1SurvivorSpaceUsed: '#06b6d4',
  g1SurvivorSpaceTotal: '#0e7490',
  g1OldGenUsed: '#6366f1',
  g1OldGenTotal: '#4f46e5',
  g1HumongousUsed: '#8b5cf6',
  g1HumongousTotal: '#7c3aed',
  
  // Non-Heap 总览 - 紫色系
  nonheapUsed: '#8b5cf6',
  nonheapTotal: '#7c3aed',
  
  // 元空间（Metaspace）详情 - 青色系
  metaspaceUsed: '#14b8a6',
  metaspaceTotal: '#0f766e',
  
  // Code Cache - 黄色系
  codeCacheUsed: '#eab308',
  codeCacheTotal: '#ca8a04',
}

// 定义核心线条的显示配置
const CORE_LINE_CONFIGS = [
  { key: 'heapUsed', name: 'Heap 已使用', stroke: COLOR_CONFIG.heapUsed },
  { key: 'heapTotal', name: 'Heap 总量', stroke: COLOR_CONFIG.heapTotal },
  { key: 'nonheapUsed', name: 'Non-Heap 已使用', stroke: COLOR_CONFIG.nonheapUsed },
  { key: 'nonheapTotal', name: 'Non-Heap 总量', stroke: COLOR_CONFIG.nonheapTotal },
  { key: 'metaspaceUsed', name: 'Metaspace 已使用', stroke: COLOR_CONFIG.metaspaceUsed },
  { key: 'metaspaceTotal', name: 'Metaspace 总量', stroke: COLOR_CONFIG.metaspaceTotal },
]

const getMB = (bytes: number) => {
  return isNaN(bytes) ? '0' : (bytes / 1024 / 1024).toFixed(1)
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg">
        <div className="text-xs font-medium text-gray-500 mb-2">
          {formatTime(payload[0].payload.timestamp)}
        </div>
        
        <div className="space-y-1">
          {payload
            .filter((p: any) => p.value !== undefined && p.value > 0)
            .map((p: any, index: number) => (
              <div key={index} className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-2.5 h-2.5 rounded-full" 
                    style={{ backgroundColor: p.color }}
                  ></div>
                  <span className="text-xs text-gray-700">{p.name}:</span>
                </div>
                <span className="text-xs font-semibold text-gray-800">
                  {getMB(p.value)} MB
                </span>
              </div>
            ))}
        </div>
      </div>
    )
  }
  return null
}

export function MemoryChartRecharts({ data, maxPoints = 60 }: MemoryChartRechartsProps) {
  const displayData = data.slice(-maxPoints)
  
  if (displayData.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg border border-dashed border-gray-300">
        <div className="text-center text-gray-500">
          <div className="text-2xl mb-2">📊</div>
          <p className="font-medium">等待内存数据</p>
          <p className="text-sm mt-1">内存使用历史将在这里显示</p>
        </div>
      </div>
    )
  }
  
  const chartData = displayData.map((d, index) => {
    const point: any = {
      timestamp: d.timestamp,
      relativeTime: index
    }
    
    Object.keys(d).forEach(key => {
      if (key !== 'timestamp') {
        point[key] = d[key as keyof MemoryDataPoint]
      }
    })
    
    return point
  })
  
  const latestData = displayData[displayData.length - 1]
  const heapUsed = getMB(latestData.heapUsed)
  const heapTotal = getMB(latestData.heapTotal)
  const heapPercent = heapTotal > 0 ? ((latestData.heapUsed / latestData.heapTotal) * 100).toFixed(1) : '0'
  
  const nonheapUsed = getMB(latestData.nonheapUsed)
  const nonheapTotal = getMB(latestData.nonheapTotal)
  const nonheapPercent = nonheapTotal > 0 ? ((latestData.nonheapUsed / latestData.nonheapTotal) * 100).toFixed(1) : '0'
  
  const filteredLineConfigs = CORE_LINE_CONFIGS.filter(config => 
    displayData.some(d => d[config.key as keyof MemoryDataPoint] !== undefined && d[config.key as keyof MemoryDataPoint] > 0)
  )

  return (
    <div className="bg-white border rounded-xl shadow-sm h-full">
      <div className="px-6 py-4 border-b">
        <div className="font-semibold text-gray-800">内存使用趋势图</div>
        <div className="text-sm text-gray-500 mt-1">
          单位: MB • 时间: {formatTime(displayData[0]?.timestamp || 0)} ~ {formatTime(displayData[displayData.length - 1]?.timestamp || 0)}
        </div>
      </div>
      
      <div className="p-4" style={{ height: '500px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 50, bottom: 30 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="relativeTime" 
              tickFormatter={(value, index) => {
                const timestamp = displayData[index]?.timestamp || 0
                const date = new Date(timestamp)
                return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
              }}
              stroke="#888"
              fontSize={11}
            />
            <YAxis 
              stroke="#888"
              fontSize={11}
              tickFormatter={(value) => getMB(value)}
              width={70}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            
            {filteredLineConfigs.map((config) => (
              <Area
                key={config.key}
                type="monotone"
                dataKey={config.key}
                name={config.name}
                stroke={config.stroke}
                strokeWidth={2}
                fill={`${config.stroke}20`}
                fillOpacity={0.3}
                connectNulls={true}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      <div className="px-6 py-3 border-t text-sm text-gray-600 bg-gray-50">
        <div className="flex justify-between items-center">
          <div>
            {displayData.length} 个数据点 • Heap: {heapUsed}/{heapTotal} MB ({heapPercent}%) • Non-Heap: {nonheapUsed}/{nonheapTotal} MB ({nonheapPercent}%)
          </div>
        </div>
      </div>
    </div>
  )
}