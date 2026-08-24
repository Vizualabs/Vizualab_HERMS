import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({ component: Home })

type HealthState =
  | { status: 'checking' }
  | { status: 'healthy'; dbRoundTripMs: number; requestId: string }
  | { status: 'unavailable'; requestId?: string }

function Home() {
  const [health, setHealth] = useState<HealthState>({ status: 'checking' })

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    setHealth({ status: 'checking' })
    const requestId = crypto.randomUUID()

    try {
      const response = await fetch('/api/health', {
        cache: 'no-store',
        headers: { 'X-Request-ID': requestId },
        signal,
      })
      const payload: unknown = await response.json()

      if (
        !response.ok ||
        typeof payload !== 'object' ||
        payload === null ||
        !('ok' in payload) ||
        payload.ok !== true ||
        !('dbRoundTripMs' in payload) ||
        typeof payload.dbRoundTripMs !== 'number'
      ) {
        throw new Error('Health endpoint returned an invalid response')
      }

      setHealth({
        status: 'healthy',
        dbRoundTripMs: payload.dbRoundTripMs,
        requestId: response.headers.get('X-Request-ID') ?? requestId,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      setHealth({
        status: 'unavailable',
        requestId,
      })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void checkHealth(controller.signal)
    return () => controller.abort()
  }, [checkHealth])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-16 sm:px-10">
        <div className="mb-8 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground shadow-sm">
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
          Phase 0 walking skeleton
        </div>

        <div className="grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-primary">
              HERMS
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight sm:text-7xl">
              Hotel equipment, connected end to end.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              The application shell is ready. This checkpoint proves the path from
              the browser to the Hono API and Neon PostgreSQL before business
              workflows are introduced.
            </p>
          </div>

          <aside className="rounded-3xl border border-border bg-card p-6 shadow-xl shadow-shadow/10">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">System health</p>
                <h2 className="mt-1 text-xl font-semibold">
                  {health.status === 'checking' && 'Checking connection'}
                  {health.status === 'healthy' && 'All seams healthy'}
                  {health.status === 'unavailable' && 'Connection unavailable'}
                </h2>
              </div>
              <span
                className={
                  health.status === 'healthy'
                    ? 'h-4 w-4 rounded-full bg-success shadow-[0_0_0_6px_var(--color-success-soft)]'
                    : health.status === 'checking'
                      ? 'h-4 w-4 animate-pulse rounded-full bg-warning'
                      : 'h-4 w-4 rounded-full bg-danger'
                }
                aria-label={health.status}
              />
            </div>

            <dl className="mt-8 space-y-4 border-t border-border pt-6 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">API route</dt>
                <dd className="font-mono">/api/health</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Database round trip</dt>
                <dd className="font-mono">
                  {health.status === 'healthy'
                    ? `${health.dbRoundTripMs.toFixed(2)} ms`
                    : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Request ID</dt>
                <dd className="max-w-44 truncate font-mono text-xs">
                  {'requestId' in health && health.requestId ? health.requestId : '—'}
                </dd>
              </div>
            </dl>

            <button
              className="mt-8 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              type="button"
              onClick={() => void checkHealth()}
              disabled={health.status === 'checking'}
            >
              {health.status === 'checking' ? 'Checking…' : 'Run health check'}
            </button>
          </aside>
        </div>
      </section>
    </main>
  )
}
