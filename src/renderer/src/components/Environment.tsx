import { useState, useEffect } from 'react'
import { arthas } from '../utils/arthas'
import { Settings, Search, RefreshCw, Edit3, Check, X, Info } from 'lucide-react'

type EnvType = 'sysprop' | 'vmoption' | 'sysenv'

export function Environment() {
  const [activeTab, setActiveTab] = useState<EnvType>('sysprop')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditingValue] = useState('')

  const fetchData = async () => {
    setLoading(true)
    try {
      let results;
      if (activeTab === 'sysprop') results = await arthas.sysprop()
      else if (activeTab === 'vmoption') results = await arthas.vmoption()
      else results = await arthas.sysenv()

      const res = results.find(r => r.type === activeTab)
      if (activeTab === 'sysprop') {
        const props = res?.props || {}
        setData(Object.entries(props).map(([k, v]) => ({ key: k, value: v })))
      } else if (activeTab === 'vmoption') {
        setData(res?.vmOptions || [])
      } else {
        const env = res?.env || {}
        setData(Object.entries(env).map(([k, v]) => ({ key: k, value: v })))
      }
    } catch (err) {
      console.error('Failed to fetch env data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (name: string) => {
    try {
      if (activeTab === 'vmoption') {
        await arthas.updateVmoption(name, editValue)
      } else if (activeTab === 'sysprop') {
        await arthas.updateSysprop(name, editValue)
      }
      setEditingKey(null)
      fetchData()
    } catch (err) {
      alert('Update failed')
    }
  }

  useEffect(() => {
    fetchData()
  }, [activeTab])

  const filteredData = data.filter(item => {
    const k = item.key || item.name || ''
    const v = String(item.value || '')
    return k.toLowerCase().includes(search.toLowerCase()) || v.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 py-4 border-b flex items-center justify-between bg-white sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Settings size={20} className="text-blue-600" />
            <h2 className="text-lg font-bold text-gray-800">Environment</h2>
          </div>
          <div className="flex p-1 bg-gray-100 rounded-lg">
            {(['sysprop', 'vmoption', 'sysenv'] as EnvType[]).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Search..."
              className="pl-9 pr-4 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button onClick={fetchData} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <RefreshCw size={18} className={`${loading ? 'animate-spin' : ''} text-gray-500`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500 font-medium sticky top-0">
            <tr>
              <th className="px-6 py-3 w-1/3">KEY / NAME</th>
              <th className="px-6 py-3">VALUE</th>
              {(activeTab === 'sysprop' || activeTab === 'vmoption') && <th className="px-6 py-3 text-right w-24">ACTION</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={3} className="p-12 text-center text-gray-400">Loading environment data...</td></tr>
            ) : filteredData.length === 0 ? (
              <tr><td colSpan={3} className="p-12 text-center text-gray-400">No entries found.</td></tr>
            ) : (
              filteredData.map((item, idx) => {
                const name = item.key || item.name
                const value = item.value
                const isWriteable = activeTab === 'vmoption' ? item.writeable : true
                const isEditing = editingKey === name

                return (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4 font-mono text-xs text-gray-600 break-all">{name}</td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input
                          autoFocus
                          className="w-full px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 outline-none"
                          value={editValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdate(name)}
                        />
                      ) : (
                        <span className="text-gray-800 break-all">{String(value)}</span>
                      )}
                    </td>
                    {(activeTab === 'sysprop' || activeTab === 'vmoption') && (
                      <td className="px-6 py-4 text-right">
                        {isWriteable && (
                          isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => handleUpdate(name)} className="p-1.5 text-green-600 hover:bg-green-50 rounded"><Check size={14} /></button>
                              <button onClick={() => setEditingKey(null)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><X size={14} /></button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingKey(name)
                                setEditingValue(String(value))
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-all"
                            >
                              <Edit3 size={14} />
                            </button>
                          )
                        )}
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      
      <div className="p-4 bg-blue-50 border-t flex items-center gap-2 text-xs text-blue-600">
        <Info size={14} />
        <span>
          {activeTab === 'vmoption' && "Only writeable JVM options can be modified."}
          {activeTab === 'sysprop' && "System properties can be updated dynamically."}
          {activeTab === 'sysenv' && "System environment variables are read-only."}
        </span>
      </div>
    </div>
  )
}
