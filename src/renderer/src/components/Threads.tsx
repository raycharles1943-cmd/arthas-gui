import { useState, useEffect } from 'react'
import { arthas } from '../utils/arthas'
import { Activity, X, RefreshCw, Terminal, Search, Filter } from 'lucide-react'

export function Threads() {
  const [threads, setThreads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedThread, setSelectedThread] = useState<any | null>(null)
  const [stackTrace, setStackTrace] = useState<string>('')
  const [stackLoading, setStackLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [stateFilter, setStateFilter] = useState<string>('all')
  const [cpuFilter, setCpuFilter] = useState<string>('all')

  const fetchThreads = async () => {
    try {
      setLoading(true)
      const results = await arthas.thread()
      const threadResult = results.find(r => r.type === 'thread')
      if (threadResult) {
        setThreads(threadResult.threadStats || [])
      }
    } catch (err) {
      console.error('Failed to fetch threads:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchStackTrace = async (id: number) => {
    try {
      setStackLoading(true)
      setSelectedThread(threads.find(t => t.id === id))
      const results = await arthas.thread(id.toString())
      const stackResult = results.find(r => r.type === 'thread')
      if (stackResult && stackResult.threadInfo) {
        // Simplified stack trace display
        const stack = stackResult.threadInfo[0]?.stackTrace || []
        setStackTrace(stack.map((s: any) => `  at ${s.className}.${s.methodName}(${s.fileName}:${s.lineNumber})`).join('\n'))
      }
    } catch (err) {
      setStackTrace('Failed to fetch stack trace.')
    } finally {
      setStackLoading(false)
    }
  }

  useEffect(() => {
    fetchThreads()
    const timer = setInterval(fetchThreads, 10000)
    return () => clearInterval(timer)
  }, [])

  const filteredThreads = threads.filter(thread => {
    const matchesSearch = searchTerm === '' || 
      thread.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      thread.id.toString().includes(searchTerm)
    
    const matchesState = stateFilter === 'all' || thread.state === stateFilter
    
    let matchesCpu = true
    if (cpuFilter === 'high') {
      matchesCpu = (thread.cpu || 0) > 5
    } else if (cpuFilter === 'medium') {
      matchesCpu = (thread.cpu || 0) > 1 && (thread.cpu || 0) <= 5
    } else if (cpuFilter === 'low') {
      matchesCpu = (thread.cpu || 0) <= 1
    }
    
    return matchesSearch && matchesState && matchesCpu
  })

  const uniqueStates = Array.from(new Set(threads.map(t => t.state))).sort()

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 py-4 border-b flex items-center justify-between bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Activity size={20} className="text-blue-600" />
          <h2 className="text-lg font-bold text-gray-800">Thread Management</h2>
          <span className="ml-2 text-xs font-medium px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
            {filteredThreads.length} / {threads.length} Threads
          </span>
        </div>
        <button 
          onClick={fetchThreads}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md border transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="px-6 py-4 border-b bg-gray-50">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search by thread name or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white text-sm"
            />
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <Filter size={16} className="text-gray-500 shrink-0" />
            <span className="text-sm font-medium text-gray-700 whitespace-nowrap">State:</span>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white min-w-[140px]"
            >
              <option value="all">All States</option>
              {uniqueStates.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <Filter size={16} className="text-gray-500 shrink-0" />
            <span className="text-sm font-medium text-gray-700 whitespace-nowrap">CPU:</span>
            <select
              value={cpuFilter}
              onChange={(e) => setCpuFilter(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white min-w-[120px]"
            >
              <option value="all">All</option>
              <option value="high">High (&gt;5%)</option>
              <option value="medium">Medium (1-5%)</option>
              <option value="low">Low (&le;1%)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500 font-medium sticky top-0">
            <tr>
              <th className="px-6 py-3">ID</th>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Group</th>
              <th className="px-6 py-3">Priority</th>
              <th className="px-6 py-3">State</th>
              <th className="px-6 py-3">%CPU</th>
              <th className="px-6 py-3">Time</th>
              <th className="px-6 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredThreads.map((t, idx) => (
              <tr key={`${t.id}-${idx}`} className="hover:bg-blue-50 transition-colors group">
                <td className="px-6 py-4 font-mono text-gray-500">{t.id}</td>
                <td className="px-6 py-4 font-medium text-gray-800 truncate max-w-md" title={t.name}>{t.name}</td>
                <td className="px-6 py-4 text-gray-600">{t.group}</td>
                <td className="px-6 py-4 text-gray-600">{t.priority}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    t.state === 'RUNNABLE' ? 'bg-green-100 text-green-700' : 
                    t.state === 'WAITING' ? 'bg-gray-100 text-gray-700' :
                    t.state === 'TIMED_WAITING' ? 'bg-orange-100 text-orange-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {t.state}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-blue-600 font-medium">{(t.cpu || 0).toFixed(1)}%</td>
                <td className="px-6 py-4 text-gray-500">{(t.time || 0)}ms</td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => fetchStackTrace(t.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-blue-600 hover:bg-blue-100 rounded-md transition-all flex items-center gap-1 ml-auto"
                  >
                    <Terminal size={14} />
                    Stack
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedThread && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden border">
            <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
              <div className="flex flex-col">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Terminal size={18} className="text-blue-600" />
                  Stack Trace: {selectedThread.name}
                </h3>
                <p className="text-xs text-gray-500">Thread ID: {selectedThread.id} | State: {selectedThread.state}</p>
              </div>
              <button 
                onClick={() => setSelectedThread(null)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="flex-1 p-6 overflow-auto bg-[#1e1e1e]">
              {stackLoading ? (
                <div className="flex items-center justify-center h-40 text-gray-400 gap-2">
                  <RefreshCw size={20} className="animate-spin" />
                  Fetching stack trace...
                </div>
              ) : (
                <pre className="font-mono text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                  {stackTrace || 'No stack trace available.'}
                </pre>
              )}
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
              <button 
                onClick={() => setSelectedThread(null)}
                className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
