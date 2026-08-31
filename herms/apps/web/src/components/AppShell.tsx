import { isSuperUser, type SessionUser } from '@herms/shared'
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
  const hasFullAccess = isSuperUser(user.role)
  const canUseCustomers = hasFullAccess || user.role === 'business_owner' || user.role === 'sales'
  const canUseItems =
    hasFullAccess || user.role === 'business_owner' || user.role === 'sales' || user.role === 'system_admin'
  const canUseSales = hasFullAccess || user.role === 'sales'
  const canApprove = hasFullAccess || user.role === 'store_admin' || user.isDeputyAdmin
  const canUseOrders = canUseSales || user.role === 'store_admin'
    || user.role === 'finance'
  const canUseFinance = hasFullAccess || user.role === 'finance' || user.role === 'business_owner'
  const canUseClaims = hasFullAccess || user.role === 'finance' || user.role === 'business_owner'
  const canViewDashboard = hasFullAccess || user.role === 'finance' || user.role === 'business_owner'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-card px-4 py-2 text-sm font-semibold text-primary-strong shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <header className="border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:px-8 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Link to="/" className="text-xl font-bold tracking-tight text-primary-strong">
              HERMS
            </Link>
            <p className="text-xs text-muted-foreground">Rental operations and finance</p>
          </div>
          <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-2">
            {canViewDashboard && (
              <Link
                to="/dashboard"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Dashboard
              </Link>
            )}
            {canUseCustomers && (
              <Link
                to="/customers"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Customers
              </Link>
            )}
            {canUseItems && (
              <Link
                to="/items"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Equipment
              </Link>
            )}
            {canUseSales && (
              <Link
                to="/quotations"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Quotations
              </Link>
            )}
            {canApprove && (
              <Link to="/approvals" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}>
                Approvals
              </Link>
            )}
            {canApprove && (
              <Link to="/stock" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}>
                Stock
              </Link>
            )}
            {canUseOrders && (
              <Link
                to="/orders"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Orders
              </Link>
            )}
            {canUseFinance && (
              <Link
                to="/finance"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Finance
              </Link>
            )}
            {canUseClaims && (
              <Link
                to="/claims"
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
              >
                Claims
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3 xl:ml-auto">
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
      <main id="main-content" className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        {children}
      </main>
    </div>
  )
}
