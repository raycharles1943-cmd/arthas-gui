import axios from 'axios'

const ARTHAS_API_URL = 'http://127.0.0.1:8563/api'

// 🔒 统一请求入口，杜绝传错参数格式
async function arthasRequest(payload: { action: string; [key: string]: any }) {
  console.log(`[Arthas IPC] 发送 -> action: ${payload.action}`, JSON.stringify(payload))
  // @ts-ignore
  return await window.api.arthasApiRequest(payload)
}

export interface ArthasResult {
  type: string
  [key: string]: any
}

export interface ArthasResponse {
  state: 'SUCCEEDED' | 'FAILED' | 'REFUSED' | 'SCHEDULED'
  body: {
    results: ArthasResult[]
    jobId: number
    jobStatus: string
  }
}

// 路径标准化函数：将Windows路径中的反斜杠转换为正斜杠
function normalizePath(path: string): string {
  // 将反斜杠转换为正斜杠，同时处理多个反斜杠的情况
  return path.replace(/\\\\/g, '/').replace(/\\/g, '/')
}

// ─── Session management ────────────────────────────────────────────────────
// async_exec / pull_results require a sessionId from Arthas HTTP API
let cachedSessionId: string | null = null

async function getOrCreateSession(): Promise<string> {
  if (cachedSessionId) return cachedSessionId

  const res = await arthasRequest({ action: 'init_session' })
  const sessionId = 
    res?.data?.body?.sessionId || 
    res?.data?.sessionId || 
    res?.sessionId || 
    res?.body?.sessionId

  if (!sessionId) throw new Error(`获取 sessionId 失败: ${JSON.stringify(res)}`)
  cachedSessionId = sessionId
  console.log(`[Arthas IPC] 新会话创建: ${sessionId}`)
  return sessionId
}

export function clearSession() {
  cachedSessionId = null
}

// ─── Core exec (sync, blocks until command finishes) ──────────────────────
// Use for short commands: reset, sc, jad, version, etc.
export async function execCommand(command: string) {
  const res = await arthasRequest({ action: 'exec', command })
  if (!res.success || res.data?.state !== 'SUCCEEDED') {
    throw new Error(res.data?.message || res.message || '命令执行失败')
  }
  return res.data.body.results || []
}
// ─── 异步执行 (trace/watch 等) ──────────────────────────────────────────
export async function asyncExecCommand(command: string) {
  const sessionId = await getOrCreateSession()
  const res = await arthasRequest({ action: 'async_exec', command, sessionId })
  
  if (!res.success) {
    // 会话失效自动重试一次
    if (res.data?.message?.includes('session') || res.data?.state === 'FAILED') {
      clearSession()
      const newSession = await getOrCreateSession()
      const retry = await arthasRequest({ action: 'async_exec', command, sessionId: newSession })
      if (!retry.success) throw new Error(`异步执行失败: ${retry.message}`)
      return extractJobInfo(retry)
    }
    throw new Error(`异步执行失败: ${res.message}`)
  }
  return extractJobInfo(res)
}

function extractJobInfo(res: any) {
  const jobId = res.data?.body?.jobId ?? res.data?.jobId ?? res.jobId
  if (jobId == null) throw new Error(`未返回 jobId: ${JSON.stringify(res)}`)
  const listenerId = res.data?.body?.results?.find((r: any) => r.type === 'enhancer')?.data?.listenerId 
                   ?? res.data?.body?.results?.find((r: any) => r.type === 'enhancer')?.listenerId
  return { jobId, listenerId: listenerId ?? undefined }
}

// ─── 拉取结果 ────────────────────────────────────────────────────────────
export async function pullJobResults(jobId: number) {
  const sessionId = await getOrCreateSession()
  const res = await arthasRequest({ action: 'pull_results', jobId, sessionId })
  return res.data?.body?.results ?? []
}

// ─── 中断任务 ────────────────────────────────────────────────────────────
export async function interruptJob(jobId: number) {
  const sessionId = await getOrCreateSession()
  await arthasRequest({ action: 'interrupt_job', jobId, sessionId })
}

// ─── Exported arthas helpers ───────────────────────────────────────────────
export const arthas = {
  version: () => execCommand('version'),
  dashboard: () => execCommand('dashboard -n 1'),
  thread: (options = '') => execCommand(`thread ${options}`),
  jvm: () => execCommand('jvm'),
  memory: () => execCommand('memory'),
  sysprop: () => execCommand('sysprop'),
  sysenv: () => execCommand('sysenv'),
  vmoption: () => execCommand('vmoption'),
  updateVmoption: (name: string, value: string) => execCommand(`vmoption ${name} ${value}`),
  updateSysprop: (name: string, value: string) => execCommand(`sysprop ${name} ${value}`),
  logger: () => execCommand('logger'),
  updateLogger: (name: string, level: string) => execCommand(`logger --name ${name} --level ${level}`),
  ttList: () => execCommand('tt -l'),
  ttPlay: (index: string) => execCommand(`tt -play -i ${index}`),
  ttRecord: (className: string, methodName: string, n = 10) => execCommand(`tt -t ${className} ${methodName} -n ${n}`),
  ttSearch: (className: string, methodName: string) => execCommand(`tt -s 'className.contains("${className}") && methodName.contains("${methodName}")'`),
  ttShow: (index: string) => execCommand(`tt -i ${index}`),
  ttDelete: (index: string) => execCommand(`tt -delete -i ${index}`),
  mc: (path: string, outputDir: string, options?: string) => {
    // 将Windows路径中的反斜杠转换为正斜杠，避免在HTTP请求中转义问题
    const normalizedPath = normalizePath(path)
    const normalizedOutputDir = normalizePath(outputDir)
    
    let cmd = `mc ${normalizedPath} -d ${normalizedOutputDir}`
    if (options && options.trim()) {
      cmd += ` ${options.trim()}`
    }
    console.log(`[MC 命令构建] 原始路径: ${path}, 转换后路径: ${normalizedPath}`)
    console.log(`[MC 命令构建] 原始输出目录: ${outputDir}, 转换后输出目录: ${normalizedOutputDir}`)
    console.log(`[MC 命令构建] 最终命令: ${cmd}`)
    return execCommand(cmd)
  },
  retransform: (path: string) => execCommand(`retransform "${path}"`),
  retransformList: () => execCommand('retransform -l'),
  retransformDelete: (id: string) => execCommand(`retransform --delete ${id}`),
  retransformReadAll: () => execCommand('retransform --retransform-all'),
  sc: (className: string) => execCommand(`sc -d ${className}`),
  sm: (className: string, methodName = '*') => execCommand(`sm -d ${className} ${methodName}`),
  jad: (className: string) => execCommand(`jad --source-only ${className}`),
  watch: (className: string, methodName: string, express: string, condition = '', n = 10) =>
    execCommand(`watch ${className} ${methodName} "${express}" ${condition} -n ${n} -x 3`),
  trace: (className: string, methodName: string, condition = '', n = 1) =>
    execCommand(`trace ${className} ${methodName} ${condition} -n ${n}`),

  // Async trace: submit job, poll separately
  startTrace: (packagePattern: string, n = 100) =>
    // 1. 去掉 --lazy（已加载类也能被增强）
    // 2. 给 pattern 加单引号防止 API 解析丢失通配符
    // 3. 增加 --limit 放宽 Arthas 默认 100 类的限制（生产环境慎用）
    asyncExecCommand(`trace '${packagePattern}' '*' -n ${n} --skipJDKMethod false --limit 9999`),

  pullTrace: (jobId: number) => pullJobResults(jobId),
  stopTrace: (jobId: number) => interruptJob(jobId),

  // Dynamic deep trace: attach to existing listenerId
  dynamicTrace: (className: string, listenerId: number, n = 100) =>
    asyncExecCommand(`trace ${className} * --listenerId ${listenerId} -n ${n} --skipJDKMethod false`),

  stopAll: () => execCommand('stop'),
  reset: (className = '*') => execCommand(`reset ${className}`),
}