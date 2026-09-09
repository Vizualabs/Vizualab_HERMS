import type { DashboardFilters } from '@herms/shared'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMoney } from '../../api'
import {
  currentColomboMonth,
  REPORTING_REFRESH_INTERVAL_MS,
  useCurrentColomboMonth,
} from '../../reportingTime'
import {
  dashboardDiscrepanciesQuery,
  dashboardFilterOptionsQuery,
  dashboardIncomeExpensesQuery,
  dashboardPaymentsQuery,
  dashboardRankingsQuery,
  dashboardStockQuery,
  monthlyFinanceQuery,
  queryKeys,
  sessionQuery,
} from '../../queries'

type DashboardSearch = {
  month?: string
  from?: string
  to?: string
  customerId?: string
  itemId?: string
}

type ChartPayment = {
  month: string
  receivedAmountCents: number
  pendingAmountCents: number
}

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const longMonthFormatter = new Intl.DateTimeFormat('en-LK', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
})
const shortMonthFormatter = new Intl.DateTimeFormat('en-LK', {
  timeZone: 'UTC',
  month: 'short',
})

export const Route = createFileRoute('/_authenticated/dashboard')({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    ...(typeof search.month === 'string' && monthPattern.test(search.month)
      ? { month: search.month }
      : {}),
    ...(typeof search.from === 'string' && datePattern.test(search.from)
      ? { from: search.from }
      : {}),
    ...(typeof search.to === 'string' && datePattern.test(search.to)
      ? { to: search.to }
      : {}),
    ...(typeof search.customerId === 'string' && uuidPattern.test(search.customerId)
      ? { customerId: search.customerId }
      : {}),
    ...(typeof search.itemId === 'string' && uuidPattern.test(search.itemId)
      ? { itemId: search.itemId }
      : {}),
  }),
  component: DashboardPage,
})

function monthDate(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 1, 1))
}

function monthLabel(month: string, style: 'long' | 'short' = 'short') {
  return (style === 'long' ? longMonthFormatter : shortMonthFormatter).format(monthDate(month))
}

function lastSixMonths(month: string) {
  const anchor = monthDate(month)
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() - (5 - index),
      1,
    ))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

function compactMoney(valueCents: number) {
  const value = valueCents / 100
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return Math.round(value).toLocaleString('en-LK')
}

function exactChartMoney(valueCents: number, currency: string) {
  const value = valueCents / 100
  return `${currency} ${new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

function niceChartCeiling(valueCents: number) {
  const safeValue = Math.max(valueCents, 100)
  const magnitude = 10 ** Math.floor(Math.log10(safeValue))
  const normalized = safeValue / magnitude
  const step = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 3
        ? 3
        : normalized <= 5
          ? 5
          : 10
  return step * magnitude
}

function topRoundedBarPath(x: number, y: number, width: number, height: number) {
  if (height <= 0) return ''
  const radius = Math.min(5, width / 2, height)
  const right = x + width
  const bottom = y + height
  return [
    `M ${x} ${bottom}`,
    `V ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    `H ${right - radius}`,
    `Q ${right} ${y} ${right} ${y + radius}`,
    `V ${bottom}`,
    'Z',
  ].join(' ')
}

function DashboardPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const [filtersOpen, setFiltersOpen] = useState(() => Boolean(
    search.from || search.to || search.customerId || search.itemId,
  ))
  const session = useQuery(sessionQuery)
  const canView = session.data?.role === 'business_owner'
    || session.data?.role === 'finance'
    || session.data?.role === 'super_user'
  const currentMonth = useCurrentColomboMonth()
  const month = search.month ?? currentMonth
  const chartMonths = lastSixMonths(month)
  const filters: DashboardFilters = {
    month,
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.customerId ? { customerId: search.customerId } : {}),
    ...(search.itemId ? { itemId: search.itemId } : {}),
  }
  const activeFilterCount = [search.month, search.from, search.to, search.customerId, search.itemId]
    .filter(Boolean).length
  const liveReportOptions = {
    enabled: canView,
    refetchInterval: REPORTING_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  }
  const options = useQuery({ ...dashboardFilterOptionsQuery, enabled: canView })
  const stock = useQuery({ ...dashboardStockQuery, ...liveReportOptions })
  const payments = useQuery({ ...dashboardPaymentsQuery(month), ...liveReportOptions })
  const incomeExpenses = useQuery({
    ...dashboardIncomeExpensesQuery(month),
    ...liveReportOptions,
  })
  const monthlyFinance = useQuery({ ...monthlyFinanceQuery(month), ...liveReportOptions })
  const paymentHistoryQueries = useQueries({
    queries: chartMonths.map((reportMonth) => ({
      ...dashboardPaymentsQuery(reportMonth),
      enabled: canView,
    })),
  })
  const discrepancies = useQuery({
    ...dashboardDiscrepanciesQuery(filters),
    ...liveReportOptions,
  })
  const rankings = useQuery({ ...dashboardRankingsQuery(filters), ...liveReportOptions })
  const exportReport = useMutation({
    mutationFn: (format: 'pdf' | 'xlsx') => api.downloadDashboardExport(format, filters),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    },
  })
  const refreshReport = useMutation({
    mutationFn: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlyFinanceReports }),
      ])
    },
  })
  const setSearch = (change: Partial<DashboardSearch>) => {
    void navigate({
      search: (previous) => {
        const next = { ...previous, ...change }
        return Object.fromEntries(
          Object.entries(next).filter(([, value]) => Boolean(value)),
        ) as DashboardSearch
      },
      replace: true,
    })
  }
  const clearFilters = () => setSearch({
    month: undefined,
    from: undefined,
    to: undefined,
    customerId: undefined,
    itemId: undefined,
  })

  if (!canView) {
    return (
      <p role="alert" className="rounded-2xl border border-border bg-card p-6 text-danger">
        Management reporting is restricted to Business Owner and Finance roles.
      </p>
    )
  }

  const initialLoading = stock.isPending || payments.isPending || incomeExpenses.isPending
  const firstError = [
    stock.error,
    payments.error,
    incomeExpenses.error,
    monthlyFinance.error,
    discrepancies.error,
    rankings.error,
    options.error,
    ...paymentHistoryQueries.map((query) => query.error),
  ].find(Boolean)
  const paymentHistory = paymentHistoryQueries.flatMap((query) => query.data
    ? [{
        month: query.data.current.month,
        receivedAmountCents: query.data.current.receivedAmountCents,
        pendingAmountCents: query.data.current.pendingAmountCents,
      }]
    : [])

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1>Dashboard</h1>
          <p className="mt-1 text-base text-muted-foreground">
            {monthLabel(month, 'long')} <span aria-hidden="true">&middot;</span> management overview
            <span className="hidden sm:inline"> <span aria-hidden="true">&middot;</span> auto-updates every minute</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:bg-primary-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft disabled:cursor-wait disabled:opacity-60"
            disabled={refreshReport.isPending}
            onClick={() => refreshReport.mutate()}
          >
            <RefreshIcon spinning={refreshReport.isPending} />
            {refreshReport.isPending ? 'Refreshing\u2026' : 'Refresh dashboard'}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:bg-primary-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft"
            aria-controls="dashboard-filter-panel"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <FilterIcon />
            Report filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
          <ExportButton
            label="Download PDF"
            format="pdf"
            pending={exportReport.isPending}
            onClick={() => exportReport.mutate('pdf')}
          />
          <ExportButton
            label="Download Excel"
            format="xlsx"
            pending={exportReport.isPending}
            onClick={() => exportReport.mutate('xlsx')}
          />
        </div>
      </header>

      {exportReport.error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {exportReport.error instanceof ApiError
            ? exportReport.error.message
            : 'Unable to download the report'}
        </p>
      )}

      {filtersOpen && (
        <section
          id="dashboard-filter-panel"
          aria-labelledby="dashboard-filters"
          className="rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="dashboard-filters" className="text-base font-semibold">Report filters</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The month updates finance charts. Date, customer, and equipment narrow issue reporting.
              </p>
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-semibold text-primary-strong hover:bg-primary-soft"
                onClick={clearFilters}
              >
                Clear all filters
              </button>
            )}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <FilterField label="Financial month">
              <input
                aria-label="Financial month"
                autoComplete="off"
                className="input"
                name="month"
                type="month"
                value={month}
                onChange={(event) => setSearch({ month: event.target.value || undefined })}
              />
            </FilterField>
            <FilterField label="Issues from">
              <input
                aria-label="Issues from"
                autoComplete="off"
                className="input"
                name="from"
                type="date"
                value={search.from ?? ''}
                max={search.to}
                onChange={(event) => setSearch({ from: event.target.value || undefined })}
              />
            </FilterField>
            <FilterField label="Issues to">
              <input
                aria-label="Issues to"
                autoComplete="off"
                className="input"
                name="to"
                type="date"
                value={search.to ?? ''}
                min={search.from}
                onChange={(event) => setSearch({ to: event.target.value || undefined })}
              />
            </FilterField>
            <FilterField label="Customer">
              <select
                aria-label="Customer"
                autoComplete="off"
                className="input"
                name="customerId"
                value={search.customerId ?? ''}
                onChange={(event) => setSearch({ customerId: event.target.value || undefined })}
              >
                <option value="">All customers</option>
                {options.data?.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Equipment">
              <select
                aria-label="Equipment"
                autoComplete="off"
                className="input"
                name="itemId"
                value={search.itemId ?? ''}
                onChange={(event) => setSearch({ itemId: event.target.value || undefined })}
              >
                <option value="">All equipment</option>
                {options.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </FilterField>
          </div>
        </section>
      )}

      {initialLoading && (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Loading reconciled dashboard&hellip;
        </p>
      )}
      {firstError && <ErrorNotice error={firstError} />}

      {stock.data && payments.data && incomeExpenses.data && (
        <section aria-label="Key business measures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Stock value"
            value={formatMoney(stock.data.totalValueCents, stock.data.currency)}
            detail={`${stock.data.items.length} equipment types`}
          />
          <MetricCard
            label="Pending payments"
            value={formatMoney(payments.data.current.pendingAmountCents, payments.data.currency)}
            detail={monthlyFinance.data
              ? `Across ${monthlyFinance.data.outstandingBalances.length} customers`
              : 'Outstanding customer balances'}
            tone="warning"
          />
          <MetricCard
            label="Received this month"
            value={formatMoney(payments.data.current.receivedAmountCents, payments.data.currency)}
            detail={monthlyFinance.data
              ? `${monthlyFinance.data.recentPayments.length} payments recorded`
              : monthLabel(month, 'long')}
            tone="success"
          />
          <MetricCard
            label="Net position"
            value={formatMoney(incomeExpenses.data.current.netPositionCents, incomeExpenses.data.currency)}
            detail={`Expenses ${formatMoney(incomeExpenses.data.current.expenseCents, incomeExpenses.data.currency)}`}
            tone={incomeExpenses.data.current.netPositionCents < 0 ? 'danger' : 'success'}
          />
        </section>
      )}

      <section aria-label="Financial trends" className="grid gap-5 xl:grid-cols-2">
        <DashboardCard title="Monthly income vs expenses">
          {monthlyFinance.isPending && <PanelLoading label="Loading income and expenses" />}
          {monthlyFinance.data && (
            <IncomeExpenseChart
              rows={monthlyFinance.data.history}
              currency={monthlyFinance.data.currency}
            />
          )}
        </DashboardCard>
        <DashboardCard title="Received vs pending payments">
          {paymentHistoryQueries.some((query) => query.isPending) && (
            <PanelLoading label="Loading payment history" />
          )}
          {paymentHistory.length === chartMonths.length && (
            <PaymentLineChart
              rows={paymentHistory}
              currency={payments.data?.currency ?? 'LKR'}
            />
          )}
        </DashboardCard>
      </section>

      <section aria-label="Operational breakdown" className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <DashboardCard title="Stock quantity & value by item">
          {stock.isPending && <PanelLoading label="Loading stock" />}
          {stock.data && (
            <ul className="space-y-4">
              {stock.data.items.slice(0, 6).map((item) => (
                <li key={item.equipmentItemId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-4 text-sm">
                  <span className="truncate font-medium">{item.equipmentName}</span>
                  <span className="text-muted-foreground">{item.quantity.toLocaleString('en-LK')}</span>
                  <span className="whitespace-nowrap font-semibold">
                    {formatMoney(item.valueCents, stock.data.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
        <RankingPanel
          title="Most missing / damaged items"
          rows={rankings.data?.items.slice(0, 5) ?? []}
          currency={rankings.data?.currency ?? 'LKR'}
          tone="danger"
          loading={rankings.isPending}
        />
        <RankingPanel
          title="Customers most associated with loss"
          rows={rankings.data?.customers.slice(0, 5) ?? []}
          currency={rankings.data?.currency ?? 'LKR'}
          tone="primary"
          loading={rankings.isPending}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
          <h2 className="text-base font-semibold">Open missing / damaged records</h2>
          {discrepancies.data && (
            <p className="text-sm text-muted-foreground">
              {discrepancies.data.openCount} open <span aria-hidden="true">&middot;</span>{' '}
              {formatMoney(discrepancies.data.totalValueCents, discrepancies.data.currency)}
            </p>
          )}
        </div>
        {discrepancies.isPending && <PanelLoading label="Loading equipment issues" />}
        {discrepancies.data?.rows.length === 0 && (
          <p className="mx-5 mb-5 rounded-xl bg-success-soft p-4 text-sm text-primary-strong">
            No open missing or damaged equipment matches these filters.
          </p>
        )}
        {discrepancies.data && discrepancies.data.rows.length > 0 && (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-3 pr-4">Item</th>
                  <th className="px-3 py-3">Qty</th>
                  <th className="px-3 py-3">Reason</th>
                  <th className="px-3 py-3">Responsible</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="py-3 pl-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.data.rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 font-medium">{row.equipmentName}</td>
                    <td className="px-3 py-3">{row.quantity}</td>
                    <td className="max-w-72 px-3 py-3 text-muted-foreground">
                      {row.reason || `${row.discrepancyType === 'damaged' ? 'Damaged' : 'Missing'} equipment`}
                    </td>
                    <td className="px-3 py-3 capitalize">
                      {row.responsibleParty?.replaceAll('_', ' ') ?? '-'}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {row.customerName ?? 'No customer'}
                    </td>
                    <td className="whitespace-nowrap py-3 pl-3 text-right font-semibold">
                      {formatMoney(row.valueCents, discrepancies.data.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </section>
  )
}

function FilterIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="1.8">
      <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
    </svg>
  )
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-4 fill-none stroke-current ${spinning ? 'animate-spin' : ''}`}
      strokeWidth="1.8"
    >
      <path d="M20 7v5h-5M4 17v-5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.1 9A7 7 0 0 1 18.5 6.5L20 8M4 16l1.5 1.5A7 7 0 0 0 17.9 15" strokeLinecap="round" />
    </svg>
  )
}

function ExportButton({
  label,
  format,
  pending,
  onClick,
}: {
  label: string
  format: 'pdf' | 'xlsx'
  pending: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="rounded-xl border border-primary-soft/60 bg-card px-4 py-2.5 text-sm font-semibold text-primary-strong transition hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft disabled:cursor-wait disabled:opacity-60"
      disabled={pending}
      onClick={onClick}
    >
      <span className="mr-2 rounded bg-primary-soft px-1.5 py-0.5 text-[10px] uppercase">{format}</span>
      {pending ? 'Preparing\u2026' : label}
    </button>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  )
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail: React.ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const valueClass = tone === 'danger'
    ? 'text-danger'
    : tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-foreground'
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h2>
      <p className={`mt-3 break-words text-2xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
      <div className="mt-1.5 text-xs text-muted-foreground">{detail}</div>
    </article>
  )
}

function DashboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function PanelLoading({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="py-10 text-center text-sm text-muted-foreground">
      {label}&hellip;
    </p>
  )
}

function IncomeExpenseChart({
  rows,
  currency,
}: {
  rows: Array<{ month: string; incomeCents: number; expenseCents: number }>
  currency: string
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const width = 620
  const height = 275
  const left = 56
  const right = 32
  const top = 10
  const bottom = 54
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const maximum = Math.max(...rows.flatMap((row) => [row.incomeCents, row.expenseCents]), 1)
  const ceiling = niceChartCeiling(maximum)
  const y = (value: number) => top + plotHeight - (value / ceiling) * plotHeight
  const groupWidth = plotWidth / Math.max(rows.length, 1)
  const barWidth = Math.min(groupWidth * 0.34, 32)
  const activeRow = activeIndex === null ? null : rows[activeIndex]
  const activeX = activeIndex === null
    ? null
    : left + groupWidth * activeIndex + groupWidth / 2
  const tooltipWidth = 250
  const tooltipHeight = 112
  const tooltipOnRight = activeX !== null && activeX + tooltipWidth + 14 <= width - right
  const tooltipX = activeX === null ? 0 : tooltipOnRight
    ? activeX + 14
    : activeX - tooltipWidth - 14
  const activeY = activeRow
    ? Math.min(y(activeRow.incomeCents), y(activeRow.expenseCents))
    : top
  const tooltipY = Math.max(
    top + 4,
    Math.min(top + plotHeight - tooltipHeight - 4, activeY - tooltipHeight / 2),
  )
  const connectorY = Math.max(tooltipY + 16, Math.min(tooltipY + tooltipHeight - 16, activeY))

  return (
    <figure>
      <div className="overflow-x-auto pb-1">
        <svg
          role="group"
          aria-labelledby="income-expense-chart-title income-expense-chart-description"
          className="h-auto w-full min-w-[430px]"
          viewBox={`0 0 ${width} ${height}`}
        >
          <title id="income-expense-chart-title">Monthly income versus expenses</title>
          <desc id="income-expense-chart-description">
            Grouped bar chart showing income and expenses for the six months ending {monthLabel(rows.at(-1)?.month ?? currentColomboMonth(), 'long')}.
            Focus, hover, or tap a month to show exact values.
          </desc>
          {Array.from({ length: 5 }, (_, index) => {
            const value = (ceiling / 4) * index
            const lineY = y(value)
            return (
              <g key={value}>
                <line x1={left} x2={width - right} y1={lineY} y2={lineY} className="stroke-border" strokeDasharray="4 4" />
                <text x={left - 8} y={lineY + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                  {compactMoney(value)}
                </text>
              </g>
            )
          })}
          {activeX !== null && (
            <rect
              aria-hidden="true"
              x={Math.max(left, activeX - groupWidth / 2 + 2)}
              y={top}
              width={Math.min(groupWidth - 4, width - right - Math.max(left, activeX - groupWidth / 2 + 2))}
              height={plotHeight}
              className="fill-muted-foreground/15"
            />
          )}
          {rows.map((row, index) => {
            const center = left + groupWidth * index + groupWidth / 2
            return (
              <g key={row.month}>
                <path
                  d={topRoundedBarPath(
                    center - barWidth - 2,
                    y(row.incomeCents),
                    barWidth,
                    top + plotHeight - y(row.incomeCents),
                  )}
                  className="fill-primary"
                />
                <path
                  d={topRoundedBarPath(
                    center + 2,
                    y(row.expenseCents),
                    barWidth,
                    top + plotHeight - y(row.expenseCents),
                  )}
                  className="fill-warning"
                />
                <text x={center} y={height - 31} textAnchor="middle" className="fill-muted-foreground text-xs">
                  {monthLabel(row.month)}
                </text>
              </g>
            )
          })}
          <line x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} className="stroke-muted-foreground" />
          {activeRow && activeX !== null && (
            <g
              role="tooltip"
              aria-label={`${monthLabel(activeRow.month, 'long')} income and expense details`}
              className="dashboard-chart-tooltip pointer-events-none"
            >
              <line
                x1={activeX}
                x2={tooltipOnRight ? tooltipX : tooltipX + tooltipWidth}
                y1={activeY}
                y2={connectorY}
                className="stroke-border"
                strokeWidth="1.5"
              />
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipWidth}
                height={tooltipHeight}
                rx="3"
                className="fill-card stroke-border drop-shadow-sm"
              />
              <text x={tooltipX + 16} y={tooltipY + 31} className="fill-foreground text-[19px] font-semibold">
                {monthLabel(activeRow.month, 'long')}
              </text>
              <text x={tooltipX + 16} y={tooltipY + 62} className="fill-primary text-[17px] font-medium">
                Income: {exactChartMoney(activeRow.incomeCents, currency)}
              </text>
              <text x={tooltipX + 16} y={tooltipY + 90} className="fill-warning text-[17px] font-medium">
                Expenses: {exactChartMoney(activeRow.expenseCents, currency)}
              </text>
            </g>
          )}
          {rows.map((row, index) => {
            const label = `${monthLabel(row.month, 'long')}: Income ${exactChartMoney(row.incomeCents, currency)}; Expenses ${exactChartMoney(row.expenseCents, currency)}`
            return (
              <rect
                key={`hit-${row.month}`}
                role="button"
                tabIndex={0}
                aria-label={label}
                x={left + groupWidth * index}
                y={top}
                width={groupWidth}
                height={plotHeight}
                fill="transparent"
                className="cursor-pointer outline-none focus-visible:stroke-primary"
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                onClick={() => setActiveIndex(index)}
              />
            )
          })}
        </svg>
      </div>
      <figcaption className="text-center">
        <div className="flex justify-center gap-5 text-sm">
          <ChartLegend color="bg-primary" label="Income" />
          <ChartLegend color="bg-warning" label="Expenses" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Hover, tap, or focus a month to see exact amounts.
        </p>
      </figcaption>
    </figure>
  )
}

function PaymentLineChart({ rows, currency }: { rows: ChartPayment[]; currency: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const width = 620
  const height = 275
  const left = 56
  const right = 32
  const top = 10
  const bottom = 54
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const maximum = Math.max(...rows.flatMap((row) => [row.receivedAmountCents, row.pendingAmountCents]), 1)
  const ceiling = niceChartCeiling(maximum)
  const x = (index: number) => left + (plotWidth * index) / Math.max(rows.length - 1, 1)
  const y = (value: number) => top + plotHeight - (value / ceiling) * plotHeight
  const receivedPoints = rows.map((row, index) => `${x(index)},${y(row.receivedAmountCents)}`).join(' ')
  const pendingPoints = rows.map((row, index) => `${x(index)},${y(row.pendingAmountCents)}`).join(' ')
  const activeRow = activeIndex === null ? null : rows[activeIndex]
  const activeX = activeIndex === null ? null : x(activeIndex)
  const tooltipWidth = 250
  const tooltipHeight = 112
  const tooltipOnRight = activeX !== null && activeX + tooltipWidth + 14 <= width - right
  const tooltipX = activeX === null ? 0 : tooltipOnRight
    ? activeX + 14
    : activeX - tooltipWidth - 14
  const activeY = activeRow
    ? (y(activeRow.receivedAmountCents) + y(activeRow.pendingAmountCents)) / 2
    : top
  const tooltipY = Math.max(
    top + 4,
    Math.min(top + plotHeight - tooltipHeight - 4, activeY - tooltipHeight / 2),
  )
  const connectorY = Math.max(tooltipY + 16, Math.min(tooltipY + tooltipHeight - 16, activeY))

  return (
    <figure>
      <div className="overflow-x-auto pb-1">
        <svg
          role="group"
          aria-labelledby="payment-chart-title payment-chart-description"
          className="h-auto w-full min-w-[430px]"
          viewBox={`0 0 ${width} ${height}`}
        >
          <title id="payment-chart-title">Received versus pending payments</title>
          <desc id="payment-chart-description">
            Line chart showing received and pending payment totals for six months.
            Focus, hover, or tap a month to show exact values.
          </desc>
          {Array.from({ length: 5 }, (_, index) => {
            const value = (ceiling / 4) * index
            const lineY = y(value)
            return (
              <g key={value}>
                <line x1={left} x2={width - right} y1={lineY} y2={lineY} className="stroke-border" strokeDasharray="4 4" />
                <text x={left - 8} y={lineY + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                  {compactMoney(value)}
                </text>
              </g>
            )
          })}
          <polyline points={receivedPoints} fill="none" className="stroke-success" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={pendingPoints} fill="none" className="stroke-danger" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {rows.map((row, index) => (
            <g key={row.month}>
              <circle cx={x(index)} cy={y(row.receivedAmountCents)} r="3" className="fill-card stroke-success" strokeWidth="2" />
              <circle cx={x(index)} cy={y(row.pendingAmountCents)} r="3" className="fill-card stroke-danger" strokeWidth="2" />
              <text x={x(index)} y={height - 31} textAnchor="middle" className="fill-muted-foreground text-xs">
                {monthLabel(row.month)}
              </text>
            </g>
          ))}
          <line x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} className="stroke-muted-foreground" />
          {activeRow && activeX !== null && (
            <line
              aria-hidden="true"
              x1={activeX}
              x2={activeX}
              y1={top}
              y2={top + plotHeight}
              className="stroke-muted-foreground/50"
              strokeWidth="1"
            />
          )}
          {activeRow && activeX !== null && (
            <g
              role="tooltip"
              aria-label={`${monthLabel(activeRow.month, 'long')} received and pending payment details`}
              className="dashboard-chart-tooltip pointer-events-none"
            >
              <line
                x1={activeX}
                x2={tooltipOnRight ? tooltipX : tooltipX + tooltipWidth}
                y1={activeY}
                y2={connectorY}
                className="stroke-border"
                strokeWidth="1.5"
              />
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipWidth}
                height={tooltipHeight}
                rx="3"
                className="fill-card stroke-border drop-shadow-sm"
              />
              <text x={tooltipX + 16} y={tooltipY + 31} className="fill-foreground text-[19px] font-semibold">
                {monthLabel(activeRow.month, 'long')}
              </text>
              <text x={tooltipX + 16} y={tooltipY + 62} className="fill-success text-[17px] font-medium">
                Received: {exactChartMoney(activeRow.receivedAmountCents, currency)}
              </text>
              <text x={tooltipX + 16} y={tooltipY + 90} className="fill-danger text-[17px] font-medium">
                Pending: {exactChartMoney(activeRow.pendingAmountCents, currency)}
              </text>
            </g>
          )}
          {rows.map((row, index) => {
            const pointX = x(index)
            const previousX = index === 0 ? left : x(index - 1)
            const nextX = index === rows.length - 1 ? width - right : x(index + 1)
            const hitStart = index === 0 ? left : (previousX + pointX) / 2
            const hitEnd = index === rows.length - 1 ? width - right : (pointX + nextX) / 2
            const label = `${monthLabel(row.month, 'long')}: Received ${exactChartMoney(row.receivedAmountCents, currency)}; Pending ${exactChartMoney(row.pendingAmountCents, currency)}`
            return (
              <rect
                key={`hit-${row.month}`}
                role="button"
                tabIndex={0}
                aria-label={label}
                x={hitStart}
                y={top}
                width={hitEnd - hitStart}
                height={plotHeight}
                fill="transparent"
                className="cursor-pointer outline-none focus-visible:stroke-primary"
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                onClick={() => setActiveIndex(index)}
              />
            )
          })}
        </svg>
      </div>
      <figcaption className="text-center">
        <div className="flex justify-center gap-5 text-sm">
          <ChartLegend color="bg-success" label="Received" />
          <ChartLegend color="bg-danger" label="Pending" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Hover, tap, or focus a month to see exact amounts.
        </p>
      </figcaption>
    </figure>
  )
}

function ChartLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      <span aria-hidden="true" className={`size-3 rounded-sm ${color}`} />
      {label}
    </span>
  )
}

function RankingPanel({
  title,
  rows,
  currency,
  tone,
  loading,
}: {
  title: string
  rows: Array<{ id: string; name: string; caseCount: number; quantity: number; valueCents: number }>
  currency: string
  tone: 'danger' | 'primary'
  loading: boolean
}) {
  const maximum = Math.max(...rows.map((row) => row.quantity), 1)
  return (
    <DashboardCard title={title}>
      {loading && <PanelLoading label={`Loading ${title.toLowerCase()}`} />}
      {!loading && rows.length === 0 && (
        <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
          No approved missing or damaged cases match these filters.
        </p>
      )}
      <ol className="space-y-4">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <p className="truncate font-medium">{row.name}</p>
              <p className="whitespace-nowrap text-muted-foreground">
                {row.quantity} pcs <span aria-hidden="true">&middot;</span>{' '}
                {formatMoney(row.valueCents, currency)}
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={`h-full rounded-full ${tone === 'danger' ? 'bg-danger' : 'bg-primary'}`}
                style={{ width: `${Math.max((row.quantity / maximum) * 100, 4)}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </DashboardCard>
  )
}

function ErrorNotice({ error }: { error: Error }) {
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      {error instanceof ApiError ? error.message : 'Unable to load dashboard reporting'}
    </p>
  )
}
