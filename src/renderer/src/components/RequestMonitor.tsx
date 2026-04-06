import { useState, useRef, useEffect } from 'react'
import { arthas } from '../utils/arthas'
import { Activity, Zap, Loader2, ChevronDown, ChevronRight, StopCircle, Filter } from 'lucide-react'

// ─── 数据结构 ───────────────────────────────────────────────────────────────

interface AggNode {
  key: string
  className: string
  methodName: string
  totalCostNs: number
  calls: number
  children: Map<string, AggNode>
}

interface ProfilerNode {
  id: string
  className: string
  methodName: string
  totalCostMs: number
  selfCostMs: number
  calls: number
  percentage: number
  children: ProfilerNode[]
}

interface DiscoveredClass {
  className: string
  depth: number
  parentClass: string | null
  methods: string[]
  referencedClasses: string[]
  jadSuccess: boolean
}

interface DiscoveryResult {
  rootClass: string
  allClasses: DiscoveredClass[]
  classNameSet: Set<string>
}

/** 每个独立 trace job 的状态 */
interface TraceJob {
  className: string
  jobId: string
  /** 该 job 已收集到的 trace 结果 */
  collected: any[]
  done: boolean
  /** 该 job 对应的 sessionId（轮询时必须用这个） */
  sessionId: string
  consumerId: string
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

// 类名缓存管理器
interface CachedClassName {
  value: string
  lastUsed: number
  successCount: number
}

const CLASS_CACHE_KEY = 'arthas_gui_cached_class_names'

function getCachedClassNames(): CachedClassName[] {
  try {
    const stored = localStorage.getItem(CLASS_CACHE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveCachedClassNames(classNames: CachedClassName[]) {
  try {
    localStorage.setItem(CLASS_CACHE_KEY, JSON.stringify(classNames))
  } catch {
    // 忽略存储错误
  }
}

function addOrUpdateCachedClassName(className: string, success: boolean = true) {
  const cached = getCachedClassNames()
  const existingIndex = cached.findIndex(item => item.value === className)
  
  if (existingIndex >= 0) {
    cached[existingIndex] = {
      ...cached[existingIndex],
      lastUsed: Date.now(),
      successCount: success ? cached[existingIndex].successCount + 1 : cached[existingIndex].successCount
    }
  } else {
    cached.push({
      value: className,
      lastUsed: Date.now(),
      successCount: success ? 1 : 0
    })
  }
  
  // 按最后使用时间排序（最新的在前），并限制最多保存20个
  cached.sort((a, b) => b.lastUsed - a.lastUsed)
  const limited = cached.slice(0, 20)
  saveCachedClassNames(limited)
}

function removeCachedClassName(className: string) {
  const cached = getCachedClassNames()
  const filtered = cached.filter(item => item.value !== className)
  saveCachedClassNames(filtered)
}

function isBusinessClass(className: string): boolean {
  const jdkPrefixes = [
    'java.', 'javax.', 'sun.', 'com.sun.',
    'org.springframework.', 'org.apache.', 'ch.qos.',
    'io.netty.', 'com.google.', 'org.slf4j.',
    'org.mybatis.', 'com.zaxxer.',
  ]
  return !jdkPrefixes.some(p => className.startsWith(p))
}

/** 判断是否是实体类（只包含数据字段，无业务逻辑） */
function isEntityClass(className: string, methods: string[]): boolean {
  const shortName = className.split('.').pop() ?? ''
  // 实体类命名模式
  const entityPatterns = [
    /Entity$/, /DO$/, /DTO$/, /VO$/, /BO$/, /PO$/, /POJO$/,
    /Bean$/, /Model$/, /Entity$/, /Record$/, /Info$/,
  ]
  if (entityPatterns.some(p => p.test(shortName))) return true
  
  // 检查方法模式：如果是纯 getter/setter认为是实体类
  const isGetterSetter = (m: string) => 
    /^(get|set|is)[A-Z]/.test(m) || m === shortName
  
  const getterSetterCount = methods.filter(isGetterSetter).length
  // 如果方法全是 getter/setter/构造函数，则认为是实体类
  if (methods.length > 0 && getterSetterCount === methods.length) return true
  
  return false
}

function parseJadSource(source: string, className: string): { methods: string[]; refs: string[] } {
  const shortName = className.split('.').pop() ?? ''
  const methods: string[] = []
  const refs: string[] = []

  // 只匹配 public 方法
  const methodRe = /public\s+(?:static\s+)?(?:[\w<>[\].,\s]+\s+)?(\w+)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = methodRe.exec(source)) !== null) {
    const name = m[1]
    // 过滤掉构造函数和关键字
    if (name && name !== shortName && !/^(if|for|while|switch|catch|return)$/.test(name)) {
      methods.push(name)
    }
  }

  const importRe = /import\s+([\w.]+)\s*;/g
  while ((m = importRe.exec(source)) !== null) {
    const cls = m[1]
    if (isBusinessClass(cls)) refs.push(cls)
  }

  const newRe = /new\s+([\w.]+)\s*\(/g
  while ((m = newRe.exec(source)) !== null) {
    const cls = m[1]
    if (cls.includes('.') && isBusinessClass(cls)) refs.push(cls)
  }

  return {
    methods: [...new Set(methods)],
    refs: [...new Set(refs)],
  }
}

// ─── BFS 类发现（并发优化版） ────────────────────────────────────────────────

/** 单个类的 JAD 反编译任务 */
async function jadClass(
  className: string,
  depth: number,
  parentClass: string | null,
  onLog: (msg: string) => void
): Promise<DiscoveredClass | null> {
  onLog(`▸ [深度 ${depth}] JAD: ${className}`)

  let methods: string[] = []
  let referencedClasses: string[] = []

  try {
    // @ts-ignore
    const jadRes = await window.api.arthasApiRequest({
      action: 'exec',
      command: `jad --source-only ${className}`,
    })

    const source: string | undefined =
      jadRes?.data?.body?.results?.[0]?.source ??
      jadRes?.data?.results?.[0]?.source

    if (source) {
      const parsed = parseJadSource(source, className)
      methods = parsed.methods
      referencedClasses = parsed.refs

      onLog(`  ✅ JAD 成功 | 方法: ${methods.length} | 引用: ${referencedClasses.length}`)
    } else {
      onLog(`  ⚠️  JAD 无源码`)
    }
  } catch (err: any) {
    onLog(`  ❌ JAD 失败: ${err?.message ?? err}`)
  }

  // 过滤实体类
  if (isEntityClass(className, methods)) {
    onLog(`  🚫 跳过实体类`)
    return null
  }

  return {
    className,
    depth,
    parentClass,
    methods,
    referencedClasses,
    jadSuccess: methods.length > 0,
  }
}

async function discoverClasses(
  rootClassName: string,
  maxDepth: number,
  onLog: (msg: string) => void
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    rootClass: rootClassName,
    allClasses: [],
    classNameSet: new Set(),
  }

  const CONCURRENCY = 5 // 并发数

  onLog(`╔══════════════════════════════════════════════`)
  onLog(`║  🔍 开始 BFS 类发现 (maxDepth=${maxDepth}, 并发=${CONCURRENCY})`)
  onLog(`║  根类: ${rootClassName}`)
  onLog(`╚══════════════════════════════════════════════`)

  // 初始队列：根类
  let queue: Array<[string, number, string | null]> = [[rootClassName, 0, null]]
  result.classNameSet.add(rootClassName)

  // 分层处理：每层并发执行
  while (queue.length > 0) {
    const depth = queue[0][1] // 当前层深度
    onLog(`\n═══ 深度 ${depth} 层，开始批量并发 JAD（共 ${queue.length} 个类） ═══`)

    // 取出一批（最多 CONCURRENCY 个）
    const batch = queue.splice(0, CONCURRENCY)

    // 并发执行这一批
    const batchResults = await Promise.all(
      batch.map(([className, d, parentClass]) =>
        jadClass(className, d, parentClass, onLog)
      )
    )

    // 收集成功结果 & 下一层的新类
    const nextQueue: Array<[string, number, string | null]> = []

    for (const disc of batchResults) {
      if (disc) {
        result.allClasses.push(disc)

        // 发现新引用类，加入下一层
        if (disc.depth < maxDepth) {
          for (const ref of disc.referencedClasses) {
            if (!result.classNameSet.has(ref)) {
              result.classNameSet.add(ref)
              nextQueue.push([ref, disc.depth + 1, disc.className])
              onLog(`  ➕ 新增: ${ref}`)
            }
          }
        }
      }
    }

    // 如果本批处理完了但还有剩余，继续处理同层的
    if (queue.length > 0 && queue[0][1] === depth) {
      // 同层还有，继续追加到下一批
      queue = [...queue, ...nextQueue]
    } else {
      // 进入下一层
      queue = nextQueue
    }
  }

  onLog(`\n╔══════════════════════════════════════════════`)
  onLog(`║  📊 类发现汇总`)
  onLog(`╠══════════════════════════════════════════════`)
  onLog(`║  共发现 ${result.allClasses.length} 个类`)

  const byDepth = new Map<number, string[]>()
  for (const dc of result.allClasses) {
    const list = byDepth.get(dc.depth) ?? []
    list.push(dc.className)
    byDepth.set(dc.depth, list)
  }
  byDepth.forEach((classes, d) => {
    onLog(`║  深度 ${d}: ${classes.length} 个类`)
    classes.forEach(c => onLog(`║    · ${c}`))
  })
  onLog(`╚══════════════════════════════════════════════`)

  return result
}

// ─── 聚合逻辑 ─────────────────────────────────────────────────────────────────
//
// 所有类各自独立 trace，结果可能是互相独立的调用树片段。
// 聚合策略：
//   1. 对所有 trace 结果统一 merge 进 nodeMap（sig = className##methodName）
//   2. 找出"真正的根"：在 topLevelSigs 中，且没有被任何节点的 children 引用的节点
//   3. 若存在多棵独立树（互不引用），取 totalCostNs 最大的作为展示根，其他挂为其子节点
//      （或通过日志提示用户）

function buildAggregatedTree(traceResults: any[]): ProfilerNode | null {
  const nodeMap = new Map<string, AggNode>()

  const sig = (n: any) => `${n.className}##${n.methodName}`

  const getOrCreate = (src: any): AggNode => {
    const key = sig(src)
    if (!nodeMap.has(key)) {
      nodeMap.set(key, {
        key,
        className: src.className,
        methodName: src.methodName,
        totalCostNs: 0,
        calls: 0,
        children: new Map(),
      })
    }
    return nodeMap.get(key)!
  }

  const mergeTree = (src: any, parentNode: AggNode | null) => {
    if (!src || !src.className || !src.methodName) {
      if (Array.isArray(src?.children)) {
        src.children.forEach((c: any) => mergeTree(c, parentNode))
      }
      return
    }

    const node = getOrCreate(src)
    node.totalCostNs += Number(src.cost) || 0
    node.calls += Number(src.times) || 1

    if (parentNode && !parentNode.children.has(sig(src))) {
      parentNode.children.set(sig(src), node)
    }

    if (Array.isArray(src.children) && src.children.length > 0) {
      src.children.forEach((child: any) => mergeTree(child, node))
    }
  }

  // 记录哪些 sig 作为顶层出现过
  const topLevelSigs = new Set<string>()

  for (const res of traceResults) {
    let rootSrc = res.data?.root ?? res.root
    if (rootSrc?.type === 'thread' && Array.isArray(rootSrc.children)) {
      rootSrc = rootSrc.children.find((n: any) => n.className && n.methodName) ?? rootSrc.children[0]
    }
    if (!rootSrc || !rootSrc.className) continue

    const rootSig = sig(rootSrc)

    // 与 listenerId 方案不同：这里每条 trace 都独立 merge，根节点直接作为顶层
    // 若根节点已被另一棵树引用为子节点，则仅累加耗时，不重复加入 topLevelSigs
    if (!nodeMap.has(rootSig)) {
      // 全新节点，作为顶层
      mergeTree(rootSrc, null)
      topLevelSigs.add(rootSig)
    } else {
      // 已存在（被别的树 merge 进来作为子节点），直接累加
      const existing = nodeMap.get(rootSig)!
      existing.totalCostNs += Number(rootSrc.cost) || 0
      existing.calls += Number(rootSrc.times) || 1
      if (Array.isArray(rootSrc.children)) {
        rootSrc.children.forEach((child: any) => mergeTree(child, existing))
      }
    }
  }

  if (nodeMap.size === 0) return null

  // 找真正的根：在 topLevelSigs 中，且没有被任何节点的 children 引用
  const allChildSigs = new Set<string>()
  for (const node of nodeMap.values()) {
    node.children.forEach((_, s) => allChildSigs.add(s))
  }

  const trueRoots: AggNode[] = []
  for (const s of topLevelSigs) {
    if (!allChildSigs.has(s)) {
      const n = nodeMap.get(s)
      if (n) trueRoots.push(n)
    }
  }

  // 没有找到"纯顶层"时，退化为全局 totalCostNs 最大的节点
  if (trueRoots.length === 0) {
    let best: AggNode | null = null
    for (const n of nodeMap.values()) {
      if (!best || n.totalCostNs > best.totalCostNs) best = n
    }
    if (!best) return null
    trueRoots.push(best)
  }

  // 若存在多棵真正独立的顶层树，取耗时最大的作为主根
  const rootNode = trueRoots.reduce((a, b) => (a.totalCostNs >= b.totalCostNs ? a : b))

  const toProfiler = (node: AggNode, parentTotalNs: number, visited = new Set<string>()): ProfilerNode => {
    if (visited.has(node.key)) {
      return {
        id: node.key + '_cycle',
        className: node.className,
        methodName: node.methodName,
        totalCostMs: 0,
        selfCostMs: 0,
        calls: 0,
        percentage: 0,
        children: [],
      }
    }
    visited.add(node.key)

    const childrenArr = Array.from(node.children.values())
    const childrenTotalNs = childrenArr.reduce((s, c) => s + c.totalCostNs, 0)
    const selfCostNs = Math.max(0, node.totalCostNs - childrenTotalNs)
    const percentage = parentTotalNs > 0 ? (node.totalCostNs / parentTotalNs) * 100 : 100

    return {
      id: node.key,
      className: node.className,
      methodName: node.methodName,
      totalCostMs: node.totalCostNs / 1e6,
      selfCostMs: selfCostNs / 1e6,
      calls: node.calls,
      percentage,
      children: childrenArr.map(c => toProfiler(c, node.totalCostNs, new Set(visited))),
    }
  }

  return toProfiler(rootNode, rootNode.totalCostNs)
}

// ─── UI 组件 ─────────────────────────────────────────────────────────────────

function ProfilerTree({ node, depth = 0 }: { node: ProfilerNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 3)
  const hasChildren = node.children.length > 0
  const isHot = node.percentage > 20 || node.selfCostMs > 50
  const isLoop = node.calls > 5

  return (
    <>
      <div
        className={`grid grid-cols-12 gap-2 py-2 px-4 text-[11px] font-mono border-b border-gray-800 hover:bg-white/5 transition-colors ${
          depth === 0 ? 'bg-blue-500/10 font-bold' : ''
        }`}
      >
        <div
          className="col-span-5 flex items-center gap-2 truncate"
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          {hasChildren ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="shrink-0 text-gray-400 hover:text-white focus:outline-none"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <div className="w-3 shrink-0" />
          )}
          <span className="truncate" title={`${node.className}.${node.methodName}`}>
            {node.className.split('.').pop()}.{node.methodName}
          </span>
        </div>
        <div className="col-span-1 text-center">
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] ${
              isLoop ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-300'
            }`}
          >
            {node.calls}
          </span>
        </div>
        <div className="col-span-2 text-right">{node.totalCostMs.toFixed(2)}ms</div>
        <div className="col-span-2 text-right">
          <span className={node.selfCostMs > 10 ? 'text-red-400 font-bold' : 'text-gray-300'}>
            {node.selfCostMs.toFixed(2)}ms
          </span>
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${isHot ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(100, node.percentage)}%` }}
            />
          </div>
          <span className="w-10 text-right">{node.percentage.toFixed(1)}%</span>
        </div>
      </div>

      {expanded &&
        hasChildren &&
        node.children.map(child => (
          <ProfilerTree key={child.id} node={child} depth={depth + 1} />
        ))}
    </>
  )
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export function RequestMonitor() {
  const [className, setClassName] = useState('')
  const [duration, setDuration] = useState(10)
  const [maxDepth, setMaxDepth] = useState(3)
  const [isProfiling, setIsProfiling] = useState(false)
  const [treeData, setTreeData] = useState<ProfilerNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('Idle')
  const [log, setLog] = useState<string>('')
  const abortRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const profilingStartTimeRef = useRef<number>(0)
  
  // 缓存类名状态
  const [cachedClassNames, setCachedClassNames] = useState<CachedClassName[]>([])
  const [showClassDropdown, setShowClassDropdown] = useState(false)
  
  // 筛选状态
  const [filters, setFilters] = useState({
    className: '',
    methodName: '',
    minTotalTime: 0,
    minSelfTime: 0,
    minCalls: 1,
    showOnlyHot: false,
  })
  const [showFilterPanel, setShowFilterPanel] = useState(false)

  // 初始化缓存
  useEffect(() => {
    const cached = getCachedClassNames()
    setCachedClassNames(cached)
  }, [])

  // 自动滚动到日志底部
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [log])

  // 点击外部关闭筛选面板和类名下拉
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      
      if (showFilterPanel && !target.closest('.filter-panel-container')) {
        setShowFilterPanel(false)
      }
      
      if (showClassDropdown && !target.closest('.class-dropdown-container')) {
        setShowClassDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFilterPanel, showClassDropdown])

  // 筛选函数
  const filterNode = (node: ProfilerNode): ProfilerNode | null => {
    const { className: classFilter, methodName: methodFilter, minTotalTime, minSelfTime, minCalls, showOnlyHot } = filters
    
    // 检查当前节点是否满足筛选条件
    const classMatch = !classFilter || node.className.toLowerCase().includes(classFilter.toLowerCase()) || 
                      node.className.split('.').pop()?.toLowerCase().includes(classFilter.toLowerCase()) || 
                      false
    const methodMatch = !methodFilter || node.methodName.toLowerCase().includes(methodFilter.toLowerCase())
    const totalTimeMatch = node.totalCostMs >= minTotalTime
    const selfTimeMatch = node.selfCostMs >= minSelfTime
    const callsMatch = node.calls >= minCalls
    const hotMatch = !showOnlyHot || node.percentage > 20 || node.selfCostMs > 50
    
    const nodeMatches = classMatch && methodMatch && totalTimeMatch && selfTimeMatch && callsMatch && hotMatch
    
    // 筛选子节点
    const filteredChildren: ProfilerNode[] = []
    for (const child of node.children) {
      const filteredChild = filterNode(child)
      if (filteredChild) {
        filteredChildren.push(filteredChild)
      }
    }
    
    // 如果节点本身不匹配，但子节点有匹配的，返回一个只包含子节点的虚拟节点
    if (!nodeMatches && filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      }
    }
    
    // 如果节点匹配，返回节点及其筛选后的子节点
    if (nodeMatches) {
      return {
        ...node,
        children: filteredChildren,
      }
    }
    
    // 都不匹配，返回null
    return null
  }

  // 获取筛选后的树数据
  const filteredTreeData = treeData ? filterNode(treeData) : null

  const appendLog = (msg: string) => {
    console.log('[Profiler]', msg)
    setLog(prev => prev + msg + '\n')
  }

  const startProfiling = async () => {
    if (!className.trim()) {
      setError('请输入完整类名')
      return
    }

    setIsProfiling(true)
    setError(null)
    setTreeData(null)
    setLog('')
    abortRef.current = false
    profilingStartTimeRef.current = Date.now() // 记录开始时间

    try {
      // ════════════════════════════════════════════════════
      // 阶段 1：BFS 类发现
      // ════════════════════════════════════════════════════
      setProgress('🔍 BFS 类发现中...')
      const discovery = await discoverClasses(className, maxDepth, appendLog)

      const allClasses = discovery.allClasses.map(dc => dc.className)
      appendLog(`\n🎯 共发现 ${allClasses.length} 个类，每类独立开启 Trace`)
      allClasses.forEach((c, i) => appendLog(`  [${i + 1}] ${c}`))

      // ════════════════════════════════════════════════════
      // 阶段 2：初始化 Arthas 会话
      // ════════════════════════════════════════════════════
      setProgress('初始化 Arthas 会话...')
      appendLog('\n══════════════ 初始化会话 ══════════════')

      // @ts-ignore
      const sessionRes = await window.api.arthasApiRequest({ action: 'init_session' })
      const raw = sessionRes?.data || sessionRes || {}
      const sessionId = raw.sessionId || raw.body?.sessionId
      const consumerId = raw.consumerId || raw.body?.consumerId

      if (!sessionId || !consumerId) {
        throw new Error(`初始化会话失败，响应: ${JSON.stringify(sessionRes)}`)
      }
      appendLog(`✅ sessionId: ${sessionId}`)
      appendLog(`✅ consumerId: ${consumerId}`)

      // 清理旧增强
      try {
        await arthas.reset(className)
        appendLog('🧹 旧增强状态已清理')
      } catch {}

      // ════════════════════════════════════════════════════
      // 阶段 3：对每个类各自提交独立 Trace job
      // ════════════════════════════════════════════════════
      setProgress('提交独立 Trace...')
      appendLog('\n══════════════ 提交独立 Trace（每类一个 job） ══════════════')

      const jobs: TraceJob[] = []

      for (let i = 0; i < allClasses.length; i++) {
        if (abortRef.current) break

        const cls = allClasses[i]
        
        // 只监听 public 方法，排除 Object 继承方法
        const cmd = `trace ${cls} '*' -n 100 '#cost > 0' -A 0`
        appendLog(`\n[${i + 1}/${allClasses.length}] 提交: ${cmd}`)

        const subSessionRes = await window.api.arthasApiRequest({ action: 'init_session' })
        const subRaw = subSessionRes?.data || subSessionRes || {}
        const subSessionId = subRaw.sessionId || subRaw.body?.sessionId
        const subConsumerId = subRaw.consumerId || subRaw.body?.consumerId

        try {
          // @ts-ignore
          const execRes = await window.api.arthasApiRequest({
            action: 'async_exec',
            command: cmd,
            sessionId: subSessionId,
            consumerId: subConsumerId,
            execTimeout: 60000,
          })

          const rawExec = execRes?.data?.body || execRes?.data || execRes || {}
          const jobId = rawExec.jobId || rawExec.body?.jobId

          if (!jobId) {
            appendLog(`  ⚠️  未返回 jobId，跳过该类`)
            continue
          }

          appendLog(`  ✅ jobId: ${jobId}`)
          jobs.push({ className: cls, jobId, collected: [], done: false, sessionId: subSessionId, consumerId: subConsumerId })
        } catch (err: any) {
          appendLog(`  ❌ 提交失败: ${err?.message ?? err}`)
        }
      }

      if (jobs.length === 0) {
        throw new Error('所有类 Trace 提交失败，请检查类名和 Arthas 连接')
      }

      appendLog(`\n✅ 共成功提交 ${jobs.length} 个独立 Trace job`)

      // ════════════════════════════════════════════════════
      // 阶段 4：等待增强确认（轮询各 job，直到收到 enhancer 结果）
      // ════════════════════════════════════════════════════
      setProgress('等待增强确认...')
      appendLog('\n══════════════ 等待增强确认 ══════════════')

      const enhancerConfirmed = new Set<string>()
      let enhancePollCount = 0
      const maxEnhancePoll = 40

      while (enhancerConfirmed.size < jobs.length && enhancePollCount < maxEnhancePoll) {
        await new Promise(r => setTimeout(r, 500))
        enhancePollCount++

        for (const job of jobs) {
          if (enhancerConfirmed.has(job.jobId)) continue

          // @ts-ignore
          const pullRes = await window.api.arthasApiRequest({
            action: 'pull_results',
            jobId: job.jobId,
            sessionId: job.sessionId,
            consumerId: job.consumerId,
          })

          const results: any[] =
            pullRes?.data?.body?.results ??
            pullRes?.data?.results ??
            []

          const enhancer = results.find(r => r.type === 'enhancer')
          if (enhancer) {
            if (enhancer.success === false || (enhancer.effect?.classCount ?? 0) === 0) {
              appendLog(`  ⚠️  ${job.className} 增强失败: ${enhancer.message ?? ''}`)
            } else {
              appendLog(`  ✅ ${job.className} 增强成功 (${enhancer.effect?.classCount} 个类)`)
            }
            enhancerConfirmed.add(job.jobId)
          }

          // 顺带收集已出现的 trace 结果
          const traces = results.filter(r => r.type === 'trace' || r.type === 'method')
          if (traces.length > 0) {
            job.collected.push(...traces)
          }
        }

        if (enhancerConfirmed.size < jobs.length) {
          appendLog(
            `  ⏳ 第 ${enhancePollCount} 次轮询，已确认增强: ${enhancerConfirmed.size}/${jobs.length}`
          )
        }
      }

      appendLog(`\n✅ 增强阶段结束，已确认 ${enhancerConfirmed.size}/${jobs.length} 个 job`)

      // ════════════════════════════════════════════════════
      // 阶段 5：并发轮询所有 job，收集 trace 结果
      // ════════════════════════════════════════════════════
      setProgress(`监听中 (${duration}s)... ⚠️ 请触发 HTTP 请求`)
      appendLog(`\n══════════════ 并发收集结果（${duration}s） ══════════════`)
      appendLog('⚠️  请在此期间触发 HTTP 请求！')

      const startTime = Date.now()
      let pollIdx = 0

      while (!abortRef.current && Date.now() - startTime < duration * 1000) {
        await new Promise(r => setTimeout(r, 400))
        pollIdx++

        let newThisPoll = 0

        for (const job of jobs) {
          if (job.done) continue

          // @ts-ignore
          const pullRes = await window.api.arthasApiRequest({
            action: 'pull_results',
            jobId: job.jobId,
            sessionId: job.sessionId,
            consumerId: job.consumerId,
          })

          const state = pullRes?.data?.state ?? pullRes?.state ?? 'UNKNOWN'
          const results: any[] =
            pullRes?.data?.body?.results ??
            pullRes?.data?.results ??
            []

          if (state === 'TERMINATED' || state === 'FAILED' || state === 'REFUSED') {
            job.done = true
          }

          const traces = results.filter(r => r.type === 'trace' || r.type === 'method')
          if (traces.length > 0) {
            job.collected.push(...traces)
            newThisPoll += traces.length

            appendLog(
              `  [${job.className.split('.').pop()}] 捕获 ${traces.length} 条，累计 ${job.collected.length} 条`
            )
          }
        }

        const totalCollected = jobs.reduce((s, j) => s + j.collected.length, 0)
        if (totalCollected > 0) {
          setProgress(`🟢 已捕获 ${totalCollected} 次调用（来自 ${jobs.length} 个 job）...`)
        }
      }

      // ════════════════════════════════════════════════════
      // 阶段 6：打印各 job 汇总 & 汇总结果
      // ════════════════════════════════════════════════════
      appendLog('\n══════════════ 各 job 结果汇总 ══════════════')
      const allCollected: any[] = []

      for (const job of jobs) {
        appendLog(
          `  ${job.className.split('.').pop()} (${job.className}): ${job.collected.length} 条 trace${
            job.collected.length === 0 ? ' （空）' : ''
          }`
        )

        if (job.collected.length > 0) {
          appendLog(`  └─ 示例（第1条）:`)
          appendLog(JSON.stringify(job.collected[0], null, 2))
          allCollected.push(...job.collected)
        }
      }

      appendLog(`\n📊 总计收集: ${allCollected.length} 条（来自 ${jobs.length} 个 job）`)

      if (allCollected.length === 0) {
        setError(
          `未捕获到数据\n` +
            `1. 请确认监听期间触发了 HTTP 请求\n` +
            `2. 检查类是否被加载: sc -d ${className}`
        )
        setProgress('失败')
        return
      }

      // 停止所有 job
      for (const job of jobs) {
        try { await arthas.stopTrace(job.jobId) } catch {}
      }

      // ════════════════════════════════════════════════════
      // 阶段 7：聚合调用树
      // ════════════════════════════════════════════════════
      setProgress('聚合数据...')
      appendLog('\n══════════════ 聚合调用树 ══════════════')

      const tree = buildAggregatedTree(allCollected)
      if (!tree) throw new Error('解析失败：未找到有效调用链')

      setTreeData(tree)
      const totalTimeMs = Date.now() - profilingStartTimeRef.current
      const totalTimeSec = (totalTimeMs / 1000).toFixed(1)
      const doneMsg = `✅ 完成: ${tree.calls} 次根调用 | 监控了 ${discovery.allClasses.length} 个类 | 总计耗时: ${totalTimeSec}s`
      setProgress(doneMsg)
      appendLog(`\n${doneMsg}`)
      
      // 保存成功的类名到缓存
      if (className.trim()) {
        addOrUpdateCachedClassName(className.trim(), true)
        setCachedClassNames(getCachedClassNames())
      }
    } catch (err: any) {
      console.error('[Profiler] ❌', err)
      const totalTimeMs = Date.now() - profilingStartTimeRef.current
      const totalTimeSec = (totalTimeMs / 1000).toFixed(1)
      const msg = `失败: ${err?.message ?? err} | 总计耗时: ${totalTimeSec}s`
      setError(msg)
      appendLog(`\n❌ ${msg}`)
      setProgress('失败')
      
      // 保存失败的类名到缓存（但不增加成功次数）
      if (className.trim()) {
        addOrUpdateCachedClassName(className.trim(), false)
        setCachedClassNames(getCachedClassNames())
      }
    } finally {
      setIsProfiling(false)
    }
  }

  const stopProfiling = () => {
    abortRef.current = true
    const totalTimeMs = Date.now() - profilingStartTimeRef.current
    const totalTimeSec = (totalTimeMs / 1000).toFixed(1)
    appendLog(`\n🛑 用户手动停止 | 总计耗时: ${totalTimeSec}s`)
    
    // 保存手动停止的类名到缓存
    if (className.trim()) {
      addOrUpdateCachedClassName(className.trim(), false) // 手动停止不算成功
      setCachedClassNames(getCachedClassNames())
    }
  }

  return (
    <div className="flex h-full bg-[#1e1e1e] text-gray-200">
      {/* ── 左侧控制面板 ── */}
      <div className="w-80 border-r border-gray-700 bg-[#252526] p-6 flex flex-col gap-4 overflow-y-auto">
        <div className="flex items-center gap-2 mb-2">
          <Activity size={20} className="text-blue-400" />
          <h2 className="text-lg font-bold text-gray-100">智能 Profiler</h2>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
              Target Class
            </label>
            <div className="relative mt-1 class-dropdown-container">
              <input
                className="w-full pl-3 pr-10 py-2 text-sm bg-[#3c3c3c] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="com.example.service.OrderService"
                value={className}
                onChange={e => {
                  setClassName(e.target.value)
                  if (e.target.value.trim() && !showClassDropdown) {
                    setShowClassDropdown(true)
                  }
                }}
                onFocus={() => {
                  if (className.trim() || cachedClassNames.length > 0) {
                    setShowClassDropdown(true)
                  }
                }}
                disabled={isProfiling}
              />
              <button
                onClick={() => setShowClassDropdown(!showClassDropdown)}
                disabled={isProfiling}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white disabled:opacity-50"
              >
                {showClassDropdown ? '▲' : '▼'}
              </button>
              
              {showClassDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#2d2d2d] border border-gray-700 rounded-lg shadow-lg z-40 max-h-60 overflow-y-auto">
                  {className.trim() && !cachedClassNames.some(c => c.value === className.trim()) && (
                    <div className="border-b border-gray-700">
                      <button
                        onClick={() => {
                          setClassName(className.trim())
                          setShowClassDropdown(false)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-blue-400 hover:bg-white/5 flex items-center gap-2"
                      >
                        <span className="text-xs">➕</span>
                        输入新类: {className.trim()}
                      </button>
                    </div>
                  )}
                  
                  {cachedClassNames.length > 0 ? (
                    cachedClassNames.map((cached, index) => (
                      <div key={cached.value} className={`${index > 0 ? 'border-t border-gray-700' : ''}`}>
                        <button
                          onClick={() => {
                            setClassName(cached.value)
                            setShowClassDropdown(false)
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/5 flex items-center justify-between"
                        >
                          <div className="truncate flex-1 text-left" title={cached.value}>
                            {cached.value}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {cached.successCount > 0 && (
                              <span className="text-[10px] text-green-400 bg-green-900/30 px-1 py-0.5 rounded">
                                ✓{cached.successCount}
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                removeCachedClassName(cached.value)
                                setCachedClassNames(getCachedClassNames())
                              }}
                              className="text-[10px] text-gray-500 hover:text-red-400 p-0.5"
                              title="从缓存中删除"
                            >
                              ×
                            </button>
                          </div>
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-center text-gray-500 text-sm">
                      暂无历史记录
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="text-[10px] text-gray-500 mt-1 ml-1 flex justify-between">
              <span>支持手动输入或从下拉选择</span>
              {cachedClassNames.length > 0 && (
                <button
                  onClick={() => {
                    saveCachedClassNames([])
                    setCachedClassNames([])
                  }}
                  className="text-red-400 hover:text-red-300"
                >
                  清空历史
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
              Duration (sec)
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 text-sm bg-[#3c3c3c] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none mt-1"
              value={duration}
              onChange={e => setDuration(Math.max(3, Number(e.target.value)))}
              disabled={isProfiling}
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
              BFS 最大深度
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 text-sm bg-[#3c3c3c] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none mt-1"
              value={maxDepth}
              min={1}
              max={6}
              onChange={e => setMaxDepth(Math.min(6, Math.max(1, Number(e.target.value))))}
              disabled={isProfiling}
            />
            <div className="text-xs text-gray-500 mt-1 ml-1">
              BFS 探索类引用的层数（推荐 2-4）
            </div>
          </div>

          {!isProfiling ? (
            <button
              onClick={startProfiling}
              disabled={!className.trim()}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              🔍 开始智能 Trace
            </button>
          ) : (
            <button
              onClick={stopProfiling}
              className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 flex items-center justify-center gap-2"
            >
              <StopCircle size={16} fill="currentColor" /> 停止监控
            </button>
          )}
        </div>

        {/* Status */}
        <div className="p-4 bg-[#3c3c3c] rounded-xl border border-gray-600">
          <div className="text-[10px] font-bold text-blue-400 uppercase mb-1">Status</div>
          <p className="text-xs text-gray-300 whitespace-pre-line">{progress}</p>
        </div>

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-xs text-red-400 whitespace-pre-line">
            {error}
          </div>
        )}
      </div>

      {/* ── 右侧内容区 ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 调用树 */}
        <div className="flex-1 flex flex-col overflow-hidden border-b border-gray-700">
          <div className="px-6 py-4 border-b border-gray-700 bg-[#252526] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <h3 className="text-xl font-bold text-gray-100">调用树</h3>
              {treeData && (
                <span className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded">
                  {treeData.calls} 次调用
                  {filteredTreeData && filteredTreeData !== treeData && (
                    <span className="ml-1 text-yellow-400">
                      (筛选后: {filteredTreeData.calls})
                    </span>
                  )}
                </span>
              )}
            </div>
            {treeData && (
              <div className="flex items-center gap-3">
                <div className="relative filter-panel-container">
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, showOnlyHot: !prev.showOnlyHot }))}
                    className={`px-3 py-1 text-xs rounded-lg flex items-center gap-2 ${
                      filters.showOnlyHot 
                        ? 'bg-red-600 text-white' 
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    🔥 只看热点
                    {filters.showOnlyHot && <span className="text-[10px]">✓</span>}
                  </button>
                </div>
                <div className="relative filter-panel-container">
                  <button 
                    onClick={() => setShowFilterPanel(!showFilterPanel)}
                    className={`px-3 py-1 text-xs rounded-lg hover:bg-blue-700 flex items-center gap-1 ${
                      showFilterPanel || Object.values(filters).some(v => {
                        if (typeof v === 'string') return v !== '';
                        if (typeof v === 'number') return v > (v === filters.minCalls ? 1 : 0);
                        if (typeof v === 'boolean') return v;
                        return false;
                      }) 
                        ? 'bg-blue-700 text-white' 
                        : 'bg-blue-600 text-white'
                    }`}
                  >
                    <Filter size={12} />
                    筛选
                    {(filters.className || filters.methodName || filters.minTotalTime > 0 || filters.minSelfTime > 0 || filters.minCalls > 1 || filters.showOnlyHot) && (
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full ml-1"></span>
                    )}
                  </button>
                  {showFilterPanel && (
                    <div className="absolute right-0 top-full mt-1 w-64 bg-[#2d2d2d] border border-gray-700 rounded-lg shadow-lg z-50 p-4">
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                            类名包含
                          </label>
                          <input
                            type="text"
                            className="w-full px-2 py-1 text-xs bg-[#3c3c3c] border border-gray-600 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder="输入类名关键字"
                            value={filters.className}
                            onChange={e => setFilters(prev => ({ ...prev, className: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                            方法名包含
                          </label>
                          <input
                            type="text"
                            className="w-full px-2 py-1 text-xs bg-[#3c3c3c] border border-gray-600 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder="输入方法名关键字"
                            value={filters.methodName}
                            onChange={e => setFilters(prev => ({ ...prev, methodName: e.target.value }))}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                              最小总耗时 (ms)
                            </label>
                            <input
                              type="number"
                              className="w-full px-2 py-1 text-xs bg-[#3c3c3c] border border-gray-600 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                              placeholder="0"
                              value={filters.minTotalTime}
                              onChange={e => setFilters(prev => ({ ...prev, minTotalTime: Math.max(0, Number(e.target.value)) }))}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                              最小自耗时 (ms)
                            </label>
                            <input
                              type="number"
                              className="w-full px-2 py-1 text-xs bg-[#3c3c3c] border border-gray-600 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                              placeholder="0"
                              value={filters.minSelfTime}
                              onChange={e => setFilters(prev => ({ ...prev, minSelfTime: Math.max(0, Number(e.target.value)) }))}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                            最小调用次数
                          </label>
                          <input
                            type="number"
                            className="w-full px-2 py-1 text-xs bg-[#3c3c3c] border border-gray-600 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder="1"
                            min="1"
                            value={filters.minCalls}
                            onChange={e => setFilters(prev => ({ ...prev, minCalls: Math.max(1, Number(e.target.value)) }))}
                          />
                        </div>
                        <div className="pt-2 border-t border-gray-700">
                          <button
                            onClick={() => {
                              setFilters({
                                className: '',
                                methodName: '',
                                minTotalTime: 0,
                                minSelfTime: 0,
                                minCalls: 1,
                                showOnlyHot: false,
                              })
                            }}
                            className="w-full px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
                          >
                            清除所有筛选
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {!treeData && !isProfiling && !error && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Zap size={48} className="opacity-20 mb-4" />
                <p>输入类名并启动 Profiling</p>
              </div>
            )}
            {isProfiling && !treeData && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <Loader2 size={48} className="animate-spin text-blue-400 mb-4" />
                <p className="text-sm">正在捕获调用栈...</p>
                <p className="text-xs text-gray-500 mt-2">⚠️ 请在此期间触发 HTTP 请求</p>
              </div>
            )}
            {treeData && (
              <div className="min-w-[800px]">
                <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-[#2d2d2d] text-[10px] font-bold text-gray-400 uppercase border-b border-gray-700 sticky top-0 z-10">
                  <div className="col-span-5 pl-2">Method</div>
                  <div className="col-span-1 text-center">Calls</div>
                  <div className="col-span-2 text-right">Total Time</div>
                  <div className="col-span-2 text-right">Self Time</div>
                  <div className="col-span-2 flex justify-end pr-4">%</div>
                </div>
                {filteredTreeData ? (
                  <ProfilerTree node={filteredTreeData} />
                ) : (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    没有匹配筛选条件的节点
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 日志 */}
        <div className="h-64 flex flex-col bg-[#1a1a1a] shrink-0">
          <div className="px-4 py-2 border-b border-gray-700 bg-[#252526] flex items-center justify-between">
            <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest">
              执行日志
            </span>
            {log && (
              <button
                onClick={() => setLog('')}
                className="text-[10px] text-gray-500 hover:text-gray-300"
              >
                清空
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] text-gray-300 leading-5 whitespace-pre-wrap">
            {log || <span className="text-gray-600">等待执行...</span>}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}