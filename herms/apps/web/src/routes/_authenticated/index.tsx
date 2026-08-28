import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Navigate } from '@tanstack/react-router'

import { sessionQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/')({ component: WorkspaceHome })

function WorkspaceHome() {
  const { data: user } = useQuery(sessionQuery)
  if (user?.role === 'business_owner' || user?.role === 'finance') {
    return <Navigate to="/dashboard" />
  }
  if (user?.role === 'sales') {
    return <Navigate to="/customers" />
  }
  if (user?.role === 'system_admin') return <Navigate to="/items" />
  return (
    <section className="rounded-3xl border border-border bg-card p-8">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">Phase 1</p>
      <h1 className="mt-3 text-3xl font-semibold">Your account is ready</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        This role has no Phase 1 master-data workspace. Its operational screens arrive in later roadmap phases.
      </p>
    </section>
  )
}
