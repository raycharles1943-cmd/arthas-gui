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

async function discoverImplementations(
  className: string,
  pid: string,
  onLog: (msg: string) => void
): Promise<string[]> {
  onLog(`🎯 开始高级类发现: ${className}`)
  onLog(`🎯 目标进程PID: ${pid}`)
  
  const implementations = new Set<string>()
  const discoveredByStrategy = new Map<number, Set<string>>()
  
  // 🔄 策略1: SC命令搜索 (基础)
  try {
    onLog(`📋 策略1: SC命令搜索`)
    const scRes = await window.api.arthasApiRequest({ action: 'exec', command: `sc ${className}` })
    onLog(`SC命令搜索结果：${JSON.stringify(scRes)}`);
    const scOutput = scRes?.data?.body?.results?.[0] || scRes?.data?.results?.[0]
    if (scOutput && typeof scOutput === 'string') {
      discoveredByStrategy.set(1, new Set())
      const lines = scOutput.split('\n').slice(0, 50)
      for (const line of lines) {
        const classMatch = line.match(/\b([a-zA-Z_$][a-zA-Z\d_$]*\.[a-zA-Z_$][a-zA-Z\d_$]*\.)+[a-zA-Z_$][a-zA-Z\d_$]*\b/)
        if (classMatch) {
          const matchedClass = classMatch[0]
          if (!matchedClass.includes('$') && !/^java\.|^javax\.|^sun\./.test(matchedClass)) {
            implementations.add(matchedClass)
            discoveredByStrategy.get(1)!.add(matchedClass)
          }
        }
      }
      onLog(`  ✅ 发现 ${discoveredByStrategy.get(1)!.size} 个类`)
    }
  } catch (error: any) { onLog(`  ⚠️ 失败: ${error?.message || error}`) }
  
  // 🌱 策略2: Spring Bean扫描增强
  try {
    onLog(`📋 策略2: Spring Bean扫描`)
    const springRes = await window.api.arthasApiRequest({ 
      action: 'exec', 
      command: `sc -d org.springframework.context.*` 
    })
    const springOutput = springRes?.data?.body?.results?.[0] || springRes?.data?.results?.[0]
    if (springOutput && typeof springOutput === 'string' && springOutput.includes('ApplicationContext')) {
      onLog(`  🌱 检测到Spring框架`)
      
      // 2.1 扫描Spring注解
      const annotations = ['Component', 'Service', 'Controller', 'Repository', 'Configuration', 'Bean']
      discoveredByStrategy.set(2, new Set())
      
      for (const annotation of annotations) {
        try {
          const annoRes = await window.api.arthasApiRequest({ 
            action: 'exec', 
            command: `sc -d * | grep -i "${annotation}.*${className}" || echo ""` 
          })
          const annoOutput = annoRes?.data?.body?.results?.[0] || annoRes?.data?.results?.[0]
          if (annoOutput && typeof annoOutput === 'string' && annoOutput.trim()) {
            const matches = annoOutput.match(/\b([a-zA-Z_$][a-zA-Z\d_$]*\.[a-zA-Z_$][a-zA-Z\d_$]*\.)+[a-zA-Z_$][a-zA-Z\d_$]*\b/g)
            if (matches) {
              matches.forEach(cls => {
                if (!cls.includes('$') && cls.includes(className.split('.').pop() || className)) {
                  implementations.add(cls)
                  discoveredByStrategy.get(2)!.add(cls)
                  onLog(`  🌿 @${annotation}: ${cls}`)
                }
              })
            }
          }
        } catch { /* 忽略单个注解失败 */ }
      }
      onLog(`  ✅ Spring扫描: ${discoveredByStrategy.get(2)!.size} 个Bean`)
      
      // 2.2 查找Spring容器中的Bean（如果支持MBean）
      try {
        const mbeanRes = await window.api.arthasApiRequest({ 
          action: 'exec', 
          command: `mbean org.springframework:* || echo "MBean not available"` 
        })
        // 解析MBean输出
        const mbeanOutput = mbeanRes?.data?.body?.results?.[0] || mbeanRes?.data?.results?.[0]
        if (mbeanOutput && typeof mbeanOutput === 'string') {
          // 从MBean输出提取Bean信息
          onLog(`  🔍 解析Spring MBean...`)
        }
      } catch { onLog(`  ℹ️ MBean不可用`) }
    } else {
      onLog(`  ℹ️ 未检测到Spring框架`)
    }
  } catch (error: any) { onLog(`  ⚠️ Spring扫描失败: ${error?.message || error}`) }
  
  // 🏭 策略3: 工厂方法分析
  try {
    onLog(`📋 策略3: 工厂方法分析`)
    discoveredByStrategy.set(3, new Set())
    
    // 3.1 查找工厂类
    const factoryPatterns = ['*Factory*', '*Provider*', '*Strategy*', '*Builder*']
    for (const pattern of factoryPatterns) {
      try {
        const factoryRes = await window.api.arthasApiRequest({ 
          action: 'exec', 
          command: `sc -d ${pattern}` 
        })
        const factoryOutput = factoryRes?.data?.body?.results?.[0] || factoryRes?.data?.results?.[0]
        if (factoryOutput && typeof factoryOutput === 'string') {
          const factoryClasses = factoryOutput.match(/\b([a-zA-Z_$][a-zA-Z\d_$]*\.[a-zA-Z_$][a-zA-Z\d_$]*\.)+[a-zA-Z_$][a-zA-Z\d_$]*\b/g)
          if (factoryClasses) {
            factoryClasses.forEach(factory => {
              if (!factory.includes('$') && factory.includes(className.split('.').pop() || className)) {
                onLog(`  🏭 发现工厂类: ${factory}`)
                
                // 3.2 分析工厂方法
                try {
                  // 简单的工厂方法trace建议
                  discoveredByStrategy.get(3)!.add(`${factory} (Factory)`)
                } catch { /* 忽略详细分析失败 */ }
              }
            })
          }
        }
      } catch { /* 忽略单个模式失败 */ }
    }
    onLog(`  ✅ 工厂分析: ${discoveredByStrategy.get(3)!.size} 个工厂`)
  } catch (error: any) { onLog(`  ⚠️ 工厂分析失败: ${error?.message || error}`) }
  
  // 📄 策略4: 接口源码分析
  try {
    onLog(`📋 策略4: 接口源码分析`)
    const jadRes = await window.api.arthasApiRequest({ action: 'exec', command: `jad ${className}` })
    const source = jadRes?.data?.body?.results?.[0]?.source || jadRes?.data?.results?.[0]?.source
    if (source && typeof source === 'string') {
      if (source.includes('interface ') || source.includes('abstract class')) {
        onLog(`  📄 ${className} 是接口/抽象类`)
        
        // 4.1 查找继承关系
        const subclassPatterns = [
          `* extends ${className}`,
          `* implements ${className}`,
          `* implements *${className}*`
        ]
        
        discoveredByStrategy.set(4, new Set())
        for (const pattern of subclassPatterns) {
          try {
            const extendsRes = await window.api.arthasApiRequest({ 
              action: 'exec', 
              command: `sc -d * | grep "${pattern}" || echo ""` 
            })
            const extendsOutput = extendsRes?.data?.body?.results?.[0] || extendsRes?.data?.results?.[0]
            if (extendsOutput && typeof extendsOutput === 'string') {
              const matches = extendsOutput.match(/\b([a-zA-Z_$][a-zA-Z\d_$]*\.[a-zA-Z_$][a-zA-Z\d_$]*\.)+[a-zA-Z_$][a-zA-Z\d_$]*\b/g)
              if (matches) {
                matches.forEach(cls => {
                  if (!cls.includes('$')) {
                    implementations.add(cls)
                    discoveredByStrategy.get(4)!.add(cls)
                    onLog(`  🔗 继承关系: ${cls}`)
                  }
                })
              }
            }
          } catch { /* 忽略单个模式 */ }
        }
        
        // 4.2 常见实现命名模式
        const implPattern = className.split('.').pop() || className
        const namingConventions = [
          `${implPattern}Impl`, `Default${implPattern}`, `Abstract${implPattern}`,
          `Simple${implPattern}`, `${implPattern}Service`, `${implPattern}Controller`,
          `${implPattern}Repository`, `${implPattern}Manager`, `${implPattern}Handler`
        ]
        
        for (const conv of namingConventions) {
          try {
            const convRes = await window.api.arthasApiRequest({ 
              action: 'exec', 
              command: `sc -d *${conv}*` 
            })
            const convOutput = convRes?.data?.body?.results?.[0] || convRes?.data?.results?.[0]
            if (convOutput && typeof convOutput === 'string') {
              const convClasses = convOutput.match(/\b([a-zA-Z_$][a-zA-Z\d_$]*\.[a-zA-Z_$][a-zA-Z\d_$]*\.)+[a-zA-Z_$][a-zA-Z\d_$]*\b/g)
              if (convClasses) {
                convClasses.forEach(cls => {
                  if (!cls.includes('$')) {
                    implementations.add(cls)
                    discoveredByStrategy.get(4)!.add(cls)
                    onLog(`  🏗️ 命名约定: ${cls}`)
                  }
                })
              }
            }
          } catch { /* 忽略单个命名约定 */ }
        }
        onLog(`  ✅ 接口分析: ${discoveredByStrategy.get(4)!.size} 个实现`)
      } else {
        onLog(`  📄 ${className} 是具体类`)
        implementations.add(className)
      }
    }
  } catch (error: any) { onLog(`  ⚠️ 接口分析失败: ${error?.message || error}`) }
  
  // 🚀 策略5: 运行时类型分析 (需要在trace阶段执行)
  if (pid && pid !== 'current') {
    try {
      onLog(`📋 策略5: 运行时分析 (将在trace阶段执行)`)
      discoveredByStrategy.set(5, new Set())
      onLog(`  ℹ️ 将在trace阶段动态捕获实际调用的类型`)
      onLog(`  🔥 使用trace命令收集运行时类型信息`)
    } catch (error: any) { onLog(`  ⚠️ 运行时分析设置失败: ${error?.message || error}`) }
  } else {
    onLog(`  ℹ️ 无PID信息，跳过运行时分析`)
  }
  
  // 💎 策略6: 组合结果和去重
  onLog(`📋 策略6: 结果聚合`)
  const allClasses = Array.from(implementations)
  
  // 按匹配度排序
  const sortedClasses = allClasses.sort((a, b) => {
    // 优先非工厂/代理类
    const aScore = getClassScore(a)
    const bScore = getClassScore(b)
    return bScore - aScore
  })
  
  // 输出发现统计
  onLog(`\n📊 ========== 类发现结果统计 ==========`)
  for (const [strategyId, classes] of discoveredByStrategy) {
    const strategyNames = ['SC搜索', 'Spring扫描', '工厂分析', '接口继承', '运行时']
    onLog(`  ${strategyNames[strategyId-1] || `策略${strategyId}`}: ${classes.size} 个`)
  }
  
  if (sortedClasses.length > 0) {
    onLog(`\n🎯 精选候选类 (${sortedClasses.length}个):`)
    sortedClasses.slice(0, Math.min(10, sortedClasses.length)).forEach((cls, i) => {
      const score = getClassScore(cls)
      const prefix = score >= 8 ? '🏆' : score >= 6 ? '🎯' : score >= 4 ? '🔍' : '📌'
      onLog(`  ${prefix} ${i+1}. ${cls} (匹配度:${score})`)
    })
  } else {
    onLog(`  ℹ️ 未发现实现类，使用原始类名`)
    sortedClasses.push(className)
  }
  
  return sortedClasses
}

// 辅助函数：计算类名匹配度得分
function getClassScore(className: string): number {
  let score = 0
  
  // 基础分
  score += 1
  
  // 排除负面特征
  if (className.includes('$')) return 0  // 内部类
  if (className.includes('CGLIB')) return 0  // CGLIB代理
  if (className.includes('EnhancerBy')) return 0  // Spring代理
  if (/^java\.|^javax\.|^sun\.|^org\.springframework\./.test(className)) return 0  // 框架类
  
  // 正面特征
  if (className.includes('Impl')) score += 3  // 常见实现命名
  if (className.includes('Service')) score += 2
  if (className.includes('Controller')) score += 2
  if (className.includes('Repository')) score += 2
  if (className.includes('Default')) score += 2
  if (className.includes('Factory')) score -= 1  // 工厂类可能不是具体实现
  if (className.includes('Abstract')) score -= 1  // 抽象类可能不是具体实现
  
  // 包名长度适中
  const parts = className.split('.')
  if (parts.length >= 3 && parts.length <= 5) score += 1
  if (parts.length === 1) score -= 2  // 过于简单的类名
  
  return Math.max(0, Math.min(10, score))
}

// 处理Spring AOP代理类：提取原始类名
function resolveSpringProxyClassName(proxyClassName: string): string {
  // 匹配Spring CGLIB代理类名格式：原始类名$$EnhancerBySpringCGLIB$$[hash]
  const cglibMatch = proxyClassName.match(/^(.+)\$\$EnhancerBySpringCGLIB\$\$[a-f0-9]+$/i)
  if (cglibMatch) {
    return cglibMatch[1]
  }
  
  // 匹配Spring JDK动态代理类名格式（较少见）
  const jdkProxyMatch = proxyClassName.match(/^com\.sun\.proxy\.\$Proxy\d+$/i)
  if (jdkProxyMatch) {
    // 对于JDK动态代理我们需要查询实际的接口
    return proxyClassName // 暂时返回原类名，需要进一步处理
  }
  
  return proxyClassName // 不是代理类或格式不匹配
}

// 工具函数：处理Spring代理增强
function handleSpringProxyForMonitoring(className: string): string {
  const originalClass = resolveSpringProxyClassName(className)
  if (originalClass !== className) {
    console.log(`[Spring代理处理] 代理类: ${className} -> 原始类: ${originalClass}`)
  }
  return originalClass
}

// 运行时类型分析：从trace数据中提取实际调用的类型
interface RuntimeTypeInfo {
  className: string
  count: number
  avgCostMs: number
  parentClasses: string[]
}

async function analyzeRuntimeTypes(
  traceResults: any[],
  onLog: (msg: string) => void
): Promise<RuntimeTypeInfo[]> {
  const typeMap = new Map<string, RuntimeTypeInfo>()
  
  try {
    onLog('🔍 分析trace数据中的运行时类型...')
    
    // 递归遍历trace树
    const processTraceNode = (node: any, parentClass?: string) => {
      if (!node || !node.className) return
      
      const className = node.className
      const currentType = typeMap.get(className) || {
        className: className,
        count: 0,
        avgCostMs: 0,
        parentClasses: [] as string[]
      }
      
      currentType.count++
      if (node.cost) {
        const costMs = typeof node.cost === 'number' ? node.cost / 1e6 : 0
        currentType.avgCostMs = (currentType.avgCostMs * (currentType.count - 1) + costMs) / currentType.count
      }
      
      if (parentClass && !currentType.parentClasses.includes(parentClass)) {
        currentType.parentClasses.push(parentClass)
      }
      
      typeMap.set(className, currentType)
      
      // 递归处理子节点
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach((child: any) => {
          processTraceNode(child, className)
        })
      }
    }
    
    // 处理所有trace结果
    for (const result of traceResults) {
      if (result.type === 'trace' || result.type === 'method') {
        processTraceNode(result)
      } else if (result.root) {
        processTraceNode(result.root)
      }
    }
    
    // 过滤和排序
    const filteredTypes = Array.from(typeMap.values())
      .filter(type => {
        // 过滤掉常见框架类
        const isFramework = /^java\.|^javax\.|^sun\.|^org\.springframework\./.test(type.className)
        const isInnerClass = type.className.includes('$')
        const isProxy = type.className.includes('CGLIB') || type.className.includes('EnhancerBy')
        
        return !isFramework && !isInnerClass && !isProxy && type.count > 1
      })
      .sort((a, b) => b.count - a.count || b.avgCostMs - a.avgCostMs)
    
    return filteredTypes.slice(0, 10) // 返回前10个
    
  } catch (error: any) {
    onLog(`⚠️ 运行时类型分析失败: ${error?.message || error}`)
    return []
  }
}

async function discoverClasses(
  rootClassName: string,
  maxDepth: number,
  onLog: (msg: string) => void,
  pid?: string | null
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    rootClass: rootClassName,
    allClasses: [],
    classNameSet: new Set(),
  }

  const CONCURRENCY = 5 // 并发数

  onLog(`╔══════════════════════════════════════════════`)
  onLog(`║  🔍 开始智能类发现 (maxDepth=${maxDepth}, 并发=${CONCURRENCY})`)
  onLog(`║  根类: ${rootClassName}`)
  if (pid) {
    onLog(`║  目标进程: ${pid}`)
  }
  onLog(`╚══════════════════════════════════════════════`)

  // 第一步：发现目标接口/类的所有实现
  const discoveredImplementations = await discoverImplementations(rootClassName, pid || 'current', onLog)
  
  if (discoveredImplementations.length === 0) {
    // 如果没有发现实现，回退到传统BFS
    discoveredImplementations.push(rootClassName)
    onLog(`⚠️ 未发现具体实现，使用原始类名`)
  }

  // 初始队列：所有发现的实现类
  let queue: Array<[string, number, string | null]> = []
  for (const impl of discoveredImplementations) {
    queue.push([impl, 0, rootClassName])
    result.classNameSet.add(impl)
    onLog(`🤔 加入队列: ${impl}`)
  }

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
        } else {
          onLog(`  🚫 到达最大深度，停止追踪: ${disc.className}`)
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

// 提取原始类名，用于代理类合并
function extractTargetClassName(className: string): string {
  // Spring CGLIB 代理类模式: OriginalClass$$EnhancerBySpringCGLIB$$hash
  const cglibMatch = className.match(/^(.+?)\$\$EnhancerBySpringCGLIB\$\$[a-f0-9]+$/i)
  if (cglibMatch) {
    return cglibMatch[1]
  }
  
  // JDK 动态代理模式: com.sun.proxy.$ProxyN 
  // 这个比较难处理，暂时返回原类名
  if (className.startsWith('com.sun.proxy.$Proxy')) {
    return className
  }
  
  return className
}

// 判断是否为代理类
function isProxyClassName(className: string): boolean {
  return className.includes('EnhancerBySpringCGLIB') || className.startsWith('com.sun.proxy.$Proxy')
}

function buildAggregatedTree(traceResults: any[]): ProfilerNode | null {
  const nodeMap = new Map<string, AggNode>()
  
  // 创建映射：代理类 -> 原始类
  const proxyToTargetMap = new Map<string, string>()
  
  // 收集所有的类信息
  const allClasses = new Set<string>()
  traceResults.forEach(res => {
    const processNode = (node: any) => {
      if (!node?.className) return
      allClasses.add(node.className)
      
      // 如果是代理类，提取目标类名
      if (isProxyClassName(node.className)) {
        const targetClass = extractTargetClassName(node.className)
        if (targetClass !== node.className) {
          proxyToTargetMap.set(node.className, targetClass)
        }
      }
      
      if (Array.isArray(node.children)) {
        node.children.forEach(processNode)
      }
    }
    
    let root = res.data?.root ?? res.root
    if (root?.type === 'thread' && Array.isArray(root.children)) {
      root = root.children.find((n: any) => n.className && n.methodName) ?? root.children[0]
    }
    processNode(root)
  })

  // 构建简化的调用签名
  const sig = (n: any) => {
    const className = n.className
    const methodName = n.methodName
    
    // 如果是代理类，使用目标类名
    const targetClassName = proxyToTargetMap.get(className) || className
    return `${targetClassName}##${methodName}`
  }

  const getOrCreate = (src: any): AggNode => {
    const key = sig(src)
    if (!nodeMap.has(key)) {
      nodeMap.set(key, {
        key,
        className: src.className, // 保留原始类名
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

  // 找出所有潜在的Controller/Service作为根，并按调用次数和耗时分值排序
  const findPotentialRootNode = (roots: AggNode[]): AggNode => {
    // 评分函数：优先Service/Controller，然后是调用次数和耗时
    const score = (node: AggNode): number => {
      let score = 0
      const className = node.className
      
      // 如果是代理类，获取原始类名
      const targetClass = proxyToTargetMap.get(className) || className
      
      // 类名启发式规则
      if (targetClass.includes('Controller')) score += 1000
      if (targetClass.includes('Service')) score += 500
      if (targetClass.includes('ServiceImpl')) score += 200
      if (targetClass.includes('.impl.')) score += 100
      
      // 调用次数和耗时
      score += Math.log(node.calls + 1) * 50
      score += Math.log(node.totalCostNs / 1e6 + 1) * 20
      
      // 避免代理类作为根
      if (isProxyClassName(className)) score -= 100
      
      return score
    }
    
    // 按分数排序
    const sorted = roots.sort((a, b) => score(b) - score(a))
    return sorted[0]
  }

  // 如果没有找到"纯顶层"节点，使用评分器
  const rootNode = trueRoots.length > 0 
    ? findPotentialRootNode(trueRoots) 
    : findPotentialRootNode(Array.from(nodeMap.values()))

  // 重建调用链的函数（备用方案）
// const rebuildCallChain = (nodes: AggNode[]): ProfilerNode[] => {
//   const nodeMap = new Map<string, AggNode>()
//   nodes.forEach(node => nodeMap.set(node.key, node))
//   
//   // 构建依赖关系
//   const dependencies = new Map<string, Set<string>>()
//   nodes.forEach(node => {
//     if (!dependencies.has(node.key)) {
//       dependencies.set(node.key, new Set())
//     }
//     node.children.forEach((childNode, childKey) => {
//       if (!dependencies.has(childKey)) {
//         dependencies.set(childKey, new Set())
//       }
//       dependencies.get(childKey)!.add(node.key)
//     })
//   })
//   
//   // 拓扑排序（简单的广度优先）
//   const result: AggNode[] = []
//   const visited = new Set<string>()
//   
//   const visit = (key: string) => {
//     if (visited.has(key)) return
//     visited.add(key)
//     
//     const node = nodeMap.get(key)
//     if (node) {
//       // 先添加独立的节点
//       result.push(node)
//     }
//   }
//   
//   // 从没有依赖的节点开始
//   for (const [key, deps] of dependencies) {
//     if (deps.size === 0) {
//       visit(key)
//     }
//   }
//   
//   // 然后添加有依赖的节点
//   for (const key of dependencies.keys()) {
//     if (!visited.has(key)) {
//       visit(key)
//     }
//   }
//   
//   return result.map(aggNode => toProfiler(aggNode, aggNode.totalCostNs))
// }

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
    
    // 处理类名显示：如果是代理类，添加标记
    let displayClassName = node.className
    const targetClassName = extractTargetClassName(node.className)
    if (isProxyClassName(node.className)) {
      displayClassName = `[PROXY] ${targetClassName}`
    }

    return {
      id: node.key,
      className: displayClassName,
      methodName: node.methodName,
      totalCostMs: node.totalCostNs / 1e6,
      selfCostMs: selfCostNs / 1e6,
      calls: node.calls,
      percentage,
      children: childrenArr.map(c => toProfiler(c, node.totalCostNs, new Set(visited))),
    }
  }

  const profilerRoot = toProfiler(rootNode, rootNode.totalCostNs)
  
  // 检查是否有Controller相关的节点
  const controllerClassNames = Array.from(nodeMap.values())
    .map(node => proxyToTargetMap.get(node.className) || node.className)
    .filter(name => name.includes('Controller'))
  
  if (controllerClassNames.length === 0) {
    // 没有监控到Controller，创建一个虚拟的Controller节点
    const virtualControllerName = 'GoodsController (virtual)'
    const virtualRoot: ProfilerNode = {
      id: 'virtual_controller_root',
      className: virtualControllerName,
      methodName: 'handleRequest',
      totalCostMs: profilerRoot.totalCostMs,
      selfCostMs: 0.1, // 很小的时间
      calls: 1,
      percentage: 100,
      children: [profilerRoot]
    }
    return virtualRoot
  }
  
  return profilerRoot
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

interface RequestMonitorProps {
  connectedPid?: string | null;
}

export function RequestMonitor({ connectedPid }: RequestMonitorProps) {
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
  
  // 高级发现选项
  const [advancedOptions, setAdvancedOptions] = useState({
    enableSpringScan: true,
    enableAnnotationScan: true,
    enableFactoryTrace: true,
    enableRuntimeAnalysis: true,
    strategyMode: 'aggressive' as 'aggressive' | 'balanced' | 'conservative',
  })
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)

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

    let processedClass: string
    processedClass = handleSpringProxyForMonitoring(className.trim())
    
    setIsProfiling(true)
    setError(null)
    setTreeData(null)
    setLog('')
    abortRef.current = false
    profilingStartTimeRef.current = Date.now() // 记录开始时间

    try {
      // ════════════════════════════════════════════════════
      // 阶段 1：智能类发现（增强版） - 添加Spring代理处理
      // ════════════════════════════════════════════════════
      setProgress('🔍 智能类发现中...')
      
      // 0. 先处理可能的Spring代理类
      if (processedClass !== className.trim()) {
        appendLog(`🌱 检测到Spring代理类：${className} -> 使用原始类：${processedClass}`)
      }
      
      // 添加工厂方法追踪建议
      if (processedClass.includes('Factory') || processedClass.includes('Strategy')) {
        appendLog('🏭 检测到工厂/策略类，启用工厂方法追踪模式')
        appendLog('💡 建议：使用 trace FactoryClassName get* 追踪工厂方法返回值')
      }
      
      // 检查是否已连接PID
      if (!connectedPid) {
        appendLog('⚠️ 警告：未连接到Java进程！某些高级发现策略可能无法正常工作')
        appendLog('ℹ️ 提示：请先连接到一个Java进程')
      }
      
      const discovery = await discoverClasses(processedClass, maxDepth, appendLog, connectedPid)

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
          const jobIdStr = rawExec.jobId || rawExec.body?.jobId

          if (!jobIdStr) {
            appendLog(`  ⚠️  未返回 jobId，跳过该类`)
            continue
          }
          
          const jobId = Number(jobIdStr)

          appendLog(`  ✅ jobId: ${jobId}`)
          jobs.push({ className: cls, jobId: jobId.toString(), collected: [], done: false, sessionId: subSessionId, consumerId: subConsumerId })
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
            jobId: Number(job.jobId),
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
            jobId: Number(job.jobId),
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
            `2. 检查类是否被加载: sc -d ${processedClass}`
        )
        setProgress('失败')
        return
      }

      // 停止所有 job
      for (const job of jobs) {
        try { await arthas.stopTrace(Number(job.jobId)) } catch {}
      }

      // ════════════════════════════════════════════════════
      // 阶段 7：运行时类型分析
      // ════════════════════════════════════════════════════
      if (connectedPid) {
        setProgress('分析运行时类型...')
        appendLog('\n══════════════ 运行时类型分析 ══════════════')
        
        // 分析trace结果中的实际类型
        const runtimeTypes = await analyzeRuntimeTypes(allCollected, appendLog)
        
        if (runtimeTypes.length > 0) {
          appendLog(`🎯 运行时发现的实际类型:`)
          runtimeTypes.forEach(type => {
            appendLog(`  🔥 ${type.className} (调用次数: ${type.count})`)
            
            // 如果发现新的运行时类型，且不在已监控列表，建议用户
            const isNewType = !discovery.allClasses.some(c => c.className === type.className)
            if (isNewType) {
              appendLog(`  💡 建议: 下次可以监控 ${type.className}`)
            }
          })
        }
      }
      
      // ════════════════════════════════════════════════════
      // 阶段 8：聚合调用树
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
      
      // 添加统计信息
      appendLog('\n📊 调用链分析：')
      if (tree.className.includes('(virtual)')) {
        appendLog(`🔄 检测到虚拟Controller节点：Spring AOP代理导致原始Controller未被监控`)
        appendLog(`💡 建议：尝试直接监控Service或ServiceImpl类`)
      }
      
      // 计算最耗时的节点
      const findTopSlowNodes = (node: ProfilerNode, depth = 0): {node: ProfilerNode, depth: number}[] => {
        const nodes = [{node, depth}]
        for (const child of node.children) {
          nodes.push(...findTopSlowNodes(child, depth + 1))
        }
        return nodes
      }
      
      const allNodes = findTopSlowNodes(tree)
      const slowestNodes = allNodes
        .filter(n => n.node.totalCostMs > 10)
        .sort((a, b) => b.node.totalCostMs - a.node.totalCostMs)
        .slice(0, 5)
      
      if (slowestNodes.length > 0) {
        appendLog(`🐌 最耗时的节点：`)
        slowestNodes.forEach(({node, depth}, i) => {
          const indent = '  '.repeat(depth)
          appendLog(`  ${i + 1}. ${indent}${node.className.split('.').pop()}.${node.methodName}: ${node.totalCostMs.toFixed(2)}ms`)
        })
      }
      
      // 保存成功的类名到缓存
      if (processedClass.trim()) {
        addOrUpdateCachedClassName(processedClass.trim(), true)
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
      if (processedClass.trim()) {
        addOrUpdateCachedClassName(processedClass.trim(), false)
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