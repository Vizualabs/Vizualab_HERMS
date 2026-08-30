const baseUrl = process.env.PHASE9_BASE_URL?.replace(/\/$/, '')
if (!baseUrl) throw new Error('PHASE9_BASE_URL is required')

const requestCount = Number(process.env.PHASE9_LOAD_REQUESTS ?? 120)
const concurrency = Number(process.env.PHASE9_LOAD_CONCURRENCY ?? 10)
if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 10_000) {
  throw new Error('PHASE9_LOAD_REQUESTS must be an integer from 1 to 10000')
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  throw new Error('PHASE9_LOAD_CONCURRENCY must be an integer from 1 to 100')
}

async function sessionCookie() {
  if (process.env.PHASE9_SESSION_COOKIE) return process.env.PHASE9_SESSION_COOKIE
  const email = process.env.PHASE9_EMAIL
  const password = process.env.PHASE9_PASSWORD
  if (!email || !password) {
    throw new Error('Set PHASE9_SESSION_COOKIE or both PHASE9_EMAIL and PHASE9_PASSWORD')
  }
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`Load-test login failed with ${response.status}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Load-test login did not return a session cookie')
  return cookie
}

const paths = [
  '/api/dashboard/filter-options',
  '/api/dashboard/stock',
  '/api/dashboard/payments',
  '/api/dashboard/income-expenses',
  '/api/dashboard/discrepancies',
  '/api/dashboard/rankings',
]
const cookie = await sessionCookie()
const latencies: number[] = []
const statuses = new Map<number, number>()
let cursor = 0

async function worker() {
  while (true) {
    const index = cursor++
    if (index >= requestCount) return
    const path = paths[index % paths.length]!
    const startedAt = performance.now()
    const response = await fetch(baseUrl + path, {
      headers: {
        Cookie: cookie,
        'Cache-Control': 'no-cache',
        'x-request-id': `phase9-load-${index}-${crypto.randomUUID()}`,
      },
    })
    latencies.push(performance.now() - startedAt)
    statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1)
    await response.arrayBuffer()
  }
}

const startedAt = performance.now()
await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker))
const elapsedMs = performance.now() - startedAt
const ordered = latencies.toSorted((left, right) => left - right)
const percentile = (value: number) => ordered[Math.max(0, Math.ceil(ordered.length * value) - 1)] ?? 0
const failures = [...statuses.entries()]
  .filter(([status]) => status < 200 || status >= 300)
  .reduce((sum, [, count]) => sum + count, 0)
const summary = {
  event: 'phase_9_dashboard_load_complete',
  baseUrl,
  requests: requestCount,
  concurrency,
  elapsedMs: Number(elapsedMs.toFixed(1)),
  requestsPerSecond: Number((requestCount / (elapsedMs / 1_000)).toFixed(2)),
  p50Ms: Number(percentile(0.5).toFixed(1)),
  p95Ms: Number(percentile(0.95).toFixed(1)),
  p99Ms: Number(percentile(0.99).toFixed(1)),
  maxMs: Number((ordered.at(-1) ?? 0).toFixed(1)),
  failures,
  statuses: Object.fromEntries(statuses),
}
console.log(JSON.stringify(summary))
if (failures > 0) throw new Error(`Dashboard load test had ${failures} failed responses`)
if (summary.p95Ms >= 3_000) throw new Error(`Dashboard p95 exceeded 3 seconds: ${summary.p95Ms}ms`)
