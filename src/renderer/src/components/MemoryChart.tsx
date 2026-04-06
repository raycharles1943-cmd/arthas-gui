import { useState, useEffect, useRef } from 'react'

interface MemoryDataPoint {
  timestamp: number
  heapUsed: number
  heapTotal: number
  nonheapUsed: number
  nonheapTotal: number
}

interface MemoryChartProps {
  data: MemoryDataPoint[]
  maxPoints?: number
}

export function MemoryChart({ data, maxPoints = 60 }: MemoryChartProps) {
  const [selectedPoint, setSelectedPoint] = useState<MemoryDataPoint | null>(null)
  const [hoverPoint, setHoverPoint] = useState<MemoryDataPoint | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  
  // 限制显示的数据点数量
  const displayData = data.slice(-maxPoints)
  
  if (displayData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border border-dashed border-gray-300">
        <div className="text-center text-gray-500">
          <div className="text-2xl mb-2">📊</div>
          <p className="font-medium">等待内存数据</p>
          <p className="text-sm mt-1">内存使用历史将在这里显示</p>
        </div>
      </div>
    )
  }
  
  // 计算图表参数
  const timestamps = displayData.map(d => d.timestamp)
  const heapUsedValues = displayData.map(d => d.heapUsed)
  const heapTotalValues = displayData.map(d => d.heapTotal)
  const nonheapUsedValues = displayData.map(d => d.nonheapUsed)
  
  const minTimestamp = Math.min(...timestamps)
  const maxTimestamp = Math.max(...timestamps)
  
  const maxHeapValue = Math.max(...heapUsedValues, ...heapTotalValues)
  const maxNonheapValue = Math.max(...nonheapUsedValues)
  const maxValue = Math.max(maxHeapValue, maxNonheapValue)
  
  const getMB = (bytes: number) => {
    return isNaN(bytes) ? 0 : (bytes / 1024 / 1024).toFixed(0)
  }
  
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
  }
  
  const getX = (timestamp: number, width: number) => {
    const relativeTime = timestamp - minTimestamp
    const totalTime = maxTimestamp - minTimestamp || 1
    return (relativeTime / totalTime) * (width - 40) + 20
  }
  
  const getY = (value: number, height: number) => {
    return height - 40 - (value / maxValue) * (height - 60)
  }
  
  const renderChart = () => {
    const width = chartRef.current ? chartRef.current.clientWidth : 800
    const height = 300
    
    return {
      width,
      height,
      points: {
        heapUsed: displayData.map((d, i) => ({
          x: getX(d.timestamp, width),
          y: getY(d.heapUsed, height),
          data: d
        })),
        heapTotal: displayData.map((d, i) => ({
          x: getX(d.timestamp, width),
          y: getY(d.heapTotal, height),
          data: d
        })),
        nonheapUsed: displayData.map((d, i) => ({
          x: getX(d.timestamp, width),
          y: getY(d.nonheapUsed, height),
          data: d
        }))
      }
    }
  }
  
  const chartInfo = renderChart()
  const currentPoint = hoverPoint || selectedPoint || displayData[displayData.length - 1]
  
  return (
    <div className="space-y-4">
      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
          <div className="text-xs font-medium text-blue-700 mb-1">Heap Used</div>
          <div className="text-xl font-bold text-blue-900">{getMB(currentPoint.heapUsed)} MB</div>
          <div className="text-xs text-blue-600 mt-1">
            峰值: {getMB(Math.max(...heapUsedValues))} MB
          </div>
        </div>
        <div className="p-4 bg-green-50 rounded-lg border border-green-100">
          <div className="text-xs font-medium text-green-700 mb-1">Heap Total</div>
          <div className="text-xl font-bold text-green-900">{getMB(currentPoint.heapTotal)} MB</div>
          <div className="text-xs text-green-600 mt-1">
            平均: {getMB(heapTotalValues.reduce((a, b) => a + b, 0) / heapTotalValues.length)} MB
          </div>
        </div>
        <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
          <div className="text-xs font-medium text-purple-700 mb-1">Non-Heap Used</div>
          <div className="text-xl font-bold text-purple-900">{getMB(currentPoint.nonheapUsed)} MB</div>
          <div className="text-xs text-purple-600 mt-1">
            峰值: {getMB(Math.max(...nonheapUsedValues))} MB
          </div>
        </div>
      </div>
      
      {/* 图表区域 */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="font-semibold text-gray-800">内存使用趋势图</div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span>Heap Used</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span>Heap Total</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-purple-500"></div>
              <span>Non-Heap Used</span>
            </div>
          </div>
        </div>
        
        <div 
          ref={chartRef}
          className="p-6 relative"
          style={{ height: 340 }}
          onMouseLeave={() => setHoverPoint(null)}
        >
          {/* Y轴标签 */}
          <div className="absolute left-0 top-6 bottom-6 w-10 flex flex-col justify-between items-end text-xs text-gray-500">
            <span>{getMB(maxValue)} MB</span>
            <span>{getMB(maxValue * 0.5)} MB</span>
            <span>0 MB</span>
          </div>
          
          {/* X轴标签 */}
          <div className="absolute left-10 right-0 bottom-0 h-10 flex justify-between items-start text-xs text-gray-500">
            {displayData.length > 0 && (
              <>
                <span>{formatTime(displayData[0].timestamp)}</span>
                {displayData.length >= 3 && (
                  <span>{formatTime(displayData[Math.floor(displayData.length / 2)].timestamp)}</span>
                )}
                <span>{formatTime(displayData[displayData.length - 1].timestamp)}</span>
              </>
            )}
          </div>
          
          {/* 图表画布 */}
          <svg 
            width={chartInfo.width} 
            height={chartInfo.height}
            className="absolute left-10 right-6 top-6"
          >
            {/* 网格线 */}
            {[0.25, 0.5, 0.75].map((fraction, i) => (
              <line
                key={`grid-${i}`}
                x1={20}
                y1={chartInfo.height - 40 - fraction * (chartInfo.height - 60)}
                x2={chartInfo.width - 20}
                y2={chartInfo.height - 40 - fraction * (chartInfo.height - 60)}
                stroke="#e5e7eb"
                strokeWidth="1"
                strokeDasharray="4 2"
              />
            ))}
            
            {/* Heap Total 区域渐变 */}
            <defs>
              <linearGradient id="heapTotalGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.2"/>
                <stop offset="100%" stopColor="#10b981" stopOpacity="0"/>
              </linearGradient>
            </defs>
            
            {/* Heap Total 区域 */}
            {chartInfo.points.heapTotal.length > 1 && (
              <polygon
                points={`${chartInfo.points.heapTotal.map(p => `${p.x},${p.y}`).join(' ')} ${chartInfo.points.heapTotal[chartInfo.points.heapTotal.length - 1].x},${chartInfo.height - 40} ${chartInfo.points.heapTotal[0].x},${chartInfo.height - 40}`}
                fill="url(#heapTotalGradient)"
              />
            )}
            
            {/* 折线 */}
            {['heapUsed', 'heapTotal', 'nonheapUsed'].map((lineKey, lineIndex) => {
              const points = chartInfo.points[lineKey as keyof typeof chartInfo.points]
              const colors = ['#3b82f6', '#10b981', '#8b5cf6']
              
              if (points.length < 2) return null
              
              return (
                <g key={lineKey}>
                  <path
                    d={`M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`}
                    fill="none"
                    stroke={colors[lineIndex]}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  
                  {points.map((point, pointIndex) => (
                    <circle
                      key={pointIndex}
                      cx={point.x}
                      cy={point.y}
                      r="3"
                      fill={colors[lineIndex]}
                      onMouseEnter={() => setHoverPoint(point.data)}
                      onClick={() => setSelectedPoint(point.data)}
                      className="cursor-pointer opacity-0 hover:opacity-100"
                    />
                  ))}
                </g>
              )
            })}
            
            {/* 悬停线 */}
            {hoverPoint && (
              <>
                <line
                  x1={getX(hoverPoint.timestamp, chartInfo.width)}
                  y1={20}
                  x2={getX(hoverPoint.timestamp, chartInfo.width)}
                  y2={chartInfo.height - 40}
                  stroke="#6b7280"
                  strokeWidth="1"
                  strokeDasharray="4 2"
                />
                <circle
                  cx={getX(hoverPoint.timestamp, chartInfo.width)}
                  cy={getY(hoverPoint.heapUsed, chartInfo.height)}
                  r="5"
                  fill="#3b82f6"
                />
                <circle
                  cx={getX(hoverPoint.timestamp, chartInfo.width)}
                  cy={getY(hoverPoint.heapTotal, chartInfo.height)}
                  r="5"
                  fill="#10b981"
                />
                <circle
                  cx={getX(hoverPoint.timestamp, chartInfo.width)}
                  cy={getY(hoverPoint.nonheapUsed, chartInfo.height)}
                  r="5"
                  fill="#8b5cf6"
                />
              </>
            )}
          </svg>
          
          {/* 悬停信息 */}
          {hoverPoint && (
            <div 
              className="absolute bg-white border shadow-lg rounded-lg p-3 min-w-48"
              style={{
                left: Math.min(getX(hoverPoint.timestamp, chartInfo.width), chartInfo.width - 200),
                top: 20
              }}
            >
              <div className="text-xs font-medium text-gray-500 mb-2">
                {formatTime(hoverPoint.timestamp)}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span className="text-xs text-gray-700">Heap Used:</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-800">
                    {getMB(hoverPoint.heapUsed)} MB
                  </span>
                </div>
                <div className="flex justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-xs text-gray-700">Heap Total:</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-800">
                    {getMB(hoverPoint.heapTotal)} MB
                  </span>
                </div>
                <div className="flex justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                    <span className="text-xs text-gray-700">Non-Heap Used:</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-800">
                    {getMB(hoverPoint.nonheapUsed)} MB
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* 图例 */}
        <div className="px-6 py-4 border-t text-sm text-gray-600">
          <div className="flex items-center justify-between">
            <div>
              显示 {displayData.length} 个数据点（最近 {Math.round((maxTimestamp - minTimestamp) / 1000)} 秒）
            </div>
            <div className="text-xs text-gray-500">
              点击数据点查看详情 • 悬停查看具体数值
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}