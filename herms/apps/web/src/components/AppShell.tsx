import { isSuperUser, type SessionUser } from '@herms/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

import { api } from '../api'

type AppRoute =
  | '/dashboard'
  | '/customers'
  | '/items'
  | '/quotations'
  | '/orders'
  | '/approvals'
  | '/stock'
  | '/claims'
  | '/finance'

type IconName =
  | 'dashboard'
  | 'customers'
  | 'equipment'
  | 'quotations'
  | 'orders'
  | 'approvals'
  | 'stock'
  | 'claims'
  | 'finance'

type NavigationItem = {
  to: AppRoute
  label: string
  icon: IconName
  visible: boolean
}

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
  const canUseOrders = canUseSales || user.role === 'store_admin' || user.role === 'finance'
  const canUseFinance = hasFullAccess || user.role === 'finance' || user.role === 'business_owner'
  const canUseClaims = hasFullAccess || user.role === 'finance' || user.role === 'business_owner'
  const canViewDashboard = hasFullAccess || user.role === 'finance' || user.role === 'business_owner'

  const navigation: NavigationItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', visible: canViewDashboard },
    { to: '/customers', label: 'Customers & Pricing', icon: 'customers', visible: canUseCustomers },
    { to: '/items', label: 'Equipment', icon: 'equipment', visible: canUseItems },
    { to: '/quotations', label: 'Quotations', icon: 'quotations', visible: canUseSales },
    { to: '/orders', label: 'Orders & Notes', icon: 'orders', visible: canUseOrders },
    { to: '/approvals', label: 'Approvals', icon: 'approvals', visible: canApprove },
    { to: '/stock', label: 'Stock', icon: 'stock', visible: canApprove },
    { to: '/claims', label: 'Discrepancies & Claims', icon: 'claims', visible: canUseClaims },
    { to: '/finance', label: 'Payments & Finance', icon: 'finance', visible: canUseFinance },
  ]

  const signOut = () => logout.mutate()

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-semibold text-primary-strong focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      <aside className="app-sidebar sticky top-0 hidden h-screen w-64 shrink-0 flex-col lg:flex">
        <Brand />
        <nav aria-label="Primary navigation" className="flex-1 space-y-1 px-3 py-5">
          <NavigationLinks items={navigation} />
        </nav>
        <div className="app-sidebar-border border-t px-3 py-4">
          <div className="mb-3 px-3">
            <p className="truncate text-sm font-medium text-sidebar-accent-foreground">{user.name}</p>
            <p className="mt-0.5 truncate text-xs capitalize text-sidebar-foreground/65">
              {user.role.replaceAll('_', ' ')}
            </p>
          </div>
          <button
            type="button"
            className="app-nav-link flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary"
            onClick={signOut}
            disabled={logout.isPending}
          >
            <SignOutIcon />
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="app-sidebar app-sidebar-border border-b lg:hidden">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <Brand compact />
            <div className="min-w-0 text-right">
              <p className="truncate text-xs font-medium text-sidebar-accent-foreground">{user.name}</p>
              <button
                type="button"
                className="mt-1 text-xs text-sidebar-foreground/75 underline-offset-4 hover:text-sidebar-accent-foreground hover:underline"
                onClick={signOut}
                disabled={logout.isPending}
              >
                Sign out
              </button>
            </div>
          </div>
          <nav
            aria-label="Primary navigation"
            className="mobile-nav-scroll flex gap-1 overflow-x-auto px-3 pb-3"
          >
            <NavigationLinks items={navigation} mobile />
          </nav>
        </header>

        <main
          id="main-content"
          className="app-main mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-7 lg:py-6"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'flex items-center gap-2.5' : 'flex items-center gap-2.5 px-5 py-5'}>
      <Link
        to="/"
        aria-label="HERMS home"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary"
      >
        H
      </Link>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-4 text-sidebar-accent-foreground">HERMS</p>
        <p className="mt-0.5 text-[11px] leading-4 text-sidebar-foreground/65">Equipment Rental</p>
      </div>
    </div>
  )
}

function NavigationLinks({
  items,
  mobile = false,
}: {
  items: NavigationItem[]
  mobile?: boolean
}) {
  return items.filter((item) => item.visible).map((item) => (
    <Link
      key={item.to}
      to={item.to}
      className={mobile
        ? 'app-nav-link flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary'
        : 'app-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary'}
      activeProps={{ className: 'app-nav-link-active' }}
    >
      <NavIcon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  ))
}

function NavIcon({ name }: { name: IconName }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  if (name === 'dashboard') {
    return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
  }
  if (name === 'customers') {
    return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
  }
  if (name === 'equipment') {
    return <svg {...common}><path d="M4 7 12 3l8 4-8 4-8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></svg>
  }
  if (name === 'quotations') {
    return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg>
  }
  if (name === 'orders') {
    return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3.5h6V6H9zM9 11h6M9 15h6" /></svg>
  }
  if (name === 'approvals') {
    return <svg {...common}><path d="M20 6 9 17l-5-5" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
  }
  if (name === 'stock') {
    return <svg {...common}><path d="m12 2 4 4-4 4-4-4 4-4ZM6 9l4 4-4 4-4-4 4-4ZM18 9l4 4-4 4-4-4 4-4ZM12 14l4 4-4 4-4-4 4-4Z" /></svg>
  }
  if (name === 'claims') {
    return <svg {...common}><path d="M10.3 2.8 2.4 17a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 2.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
  }
  return <svg {...common}><path d="M4 6h16M4 10h16M6 3v3M18 3v3" /><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 15h4M7 18h7" /></svg>
}

function SignOutIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    </svg>
  )
}
