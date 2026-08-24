import type { SessionUser } from '@herms/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

import { api } from '../api'

export function AppShell({
  user,
  children,
}: {
  user: SessionUser
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: async () => {
      queryClient.removeQueries()
      await navigate({ to: '/login' })
    },
  })
  const canUseCustomers = user.role === 'business_owner' || user.role === 'sales'
  const canUseItems =
    user.role === 'business_owner' || user.role === 'sales' || user.role === 'system_admin'
  const canUseSales = user.role === 'sales'
  const canApprove = user.role === 'store_admin' || user.isDeputyAdmin

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
          <div>
            <Link to="/" className="text-xl font-bold tracking-tight text-primary-strong">
              HERMS
            </Link>
            <p className="text-xs text-muted-foreground">Identity & master data</p>
          </div>
          <nav aria-label="Primary navigation" className="flex items-center gap-2">
            {canUseCustomers && (
              <Link
                to="/customers"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Customers
              </Link>
            )}
            {canUseItems && (
              <Link
                to="/items"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Equipment
              </Link>
            )}
            {canUseSales && (
              <Link
                to="/quotations"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Quotations
              </Link>
            )}
            {canApprove && (
              <Link to="/approvals" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted" activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}>
                Approvals
              </Link>
            )}
            {canApprove && (
              <Link to="/stock" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted" activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}>
                Stock
              </Link>
            )}
            {canUseSales && (
              <Link
                to="/orders"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Orders
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.role.replaceAll('_', ' ')}</p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">{children}</main>
    </div>
  )
}
