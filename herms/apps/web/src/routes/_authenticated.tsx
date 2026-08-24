import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Navigate, Outlet } from '@tanstack/react-router'

import { AppShell } from '../components/AppShell'
import { sessionQuery } from '../queries'

export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const session = useQuery(sessionQuery)
  if (session.isPending) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading session…</div>
  }
  if (!session.data) return <Navigate to="/login" />
  return (
    <AppShell user={session.data}>
      <Outlet />
    </AppShell>
  )
}
