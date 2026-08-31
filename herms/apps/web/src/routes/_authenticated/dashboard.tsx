import type { DashboardFilters } from '@herms/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { ApiError, api, formatMoney } from '../../api'
import {
  dashboardDiscrepanciesQuery,
  dashboardEscalationsQuery,
  dashboardFilterOptionsQuery,
  dashboardIncomeExpensesQuery,
  dashboardPaymentsQuery,
  dashboardRankingsQuery,
  dashboardStockQuery,
  sessionQuery,
} from '../../queries'

type DashboardSearch = {
  month?: string
  from?: string
  to?: string
  customerId?: string
  itemId?: string
}

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const dashboardDateFormatter = new Intl.DateTimeFormat('en-LK', {
  timeZone: 'Asia/Colombo',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
const dashboardDateTimeFormatter = new Intl.DateTimeFormat('en-LK', {
  timeZone: 'Asia/Colombo',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
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

function currentColomboMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`
}

function DashboardPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const session = useQuery(sessionQuery)
  const canView = session.data?.role === 'business_owner'
    || session.data?.role === 'finance'
    || session.data?.role === 'super_user'
  const isOwner = session.data?.role === 'business_owner' || session.data?.role === 'super_user'
  const month = search.month ?? currentColomboMonth()
  const filters: DashboardFilters = {
    month,
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.customerId ? { customerId: search.customerId } : {}),
    ...(search.itemId ? { itemId: search.itemId } : {}),
  }
  const options = useQuery({ ...dashboardFilterOptionsQuery, enabled: canView })
  const stock = useQuery({ ...dashboardStockQuery, enabled: canView })
  const payments = useQuery({ ...dashboardPaymentsQuery(month), enabled: canView })
  const incomeExpenses = useQuery({
    ...dashboardIncomeExpensesQuery(month),
    enabled: canView,
  })
  const discrepancies = useQuery({
    ...dashboardDiscrepanciesQuery(filters),
    enabled: canView,
  })
  const rankings = useQuery({ ...dashboardRankingsQuery(filters), enabled: canView })
  const escalations = useQuery({
    ...dashboardEscalationsQuery,
    enabled: canView && isOwner,
  })
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
    discrepancies.error,
    rankings.error,
    options.error,
  ].find(Boolean)

  return (
    <section className="space-y-6">
      <header className="border-b border-border pb-5">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1>Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Reconciled stock, receivables, cash movement, and approved equipment issues.
              Periods use Asia/Colombo time.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
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
        </div>
        {exportReport.error && (
          <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {exportReport.error instanceof ApiError
              ? exportReport.error.message
              : 'Unable to download the report'}
          </p>
        )}
      </header>

      <section aria-labelledby="dashboard-filters" className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="dashboard-filters" className="font-semibold">Report filters</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Month controls financial trends. Date and entity filters control discrepancies and rankings.
            </p>
          </div>
          {(search.from || search.to || search.customerId || search.itemId) && (
            <button
              type="button"
              className="text-sm font-semibold text-primary-strong hover:underline"
              onClick={() => setSearch({ from: undefined, to: undefined, customerId: undefined, itemId: undefined })}
            >
              Clear detail filters
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
              onChange={(event) => setSearch({ month: event.target.value })}
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

      {initialLoading && (
        <p role="status" aria-live="polite" className="text-muted-foreground">
          Loading reconciled dashboard&hellip;
        </p>
      )}
      {firstError && <ErrorNotice error={firstError} />}

      {stock.data && payments.data && incomeExpenses.data && (
        <section aria-label="Key business measures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            eyebrow="Inventory"
            label="Current stock value"
            value={formatMoney(stock.data.totalValueCents, stock.data.currency)}
            detail={`${stock.data.totalQuantity.toLocaleString('en-LK')} units across ${stock.data.items.length} equipment items`}
          />
          <MetricCard
            eyebrow="Receivables"
            label="Pending payments"
            value={formatMoney(payments.data.current.pendingAmountCents, payments.data.currency)}
            detail={<Trend
              current={payments.data.current.pendingAmountCents}
              previous={payments.data.previous.pendingAmountCents}
              previousMonth={payments.data.previous.month}
              inverse
            />}
            tone="warning"
          />
          <MetricCard
            eyebrow="Cash received"
            label="Received this month"
            value={formatMoney(payments.data.current.receivedAmountCents, payments.data.currency)}
            detail={<Trend
              current={payments.data.current.receivedAmountCents}
              previous={payments.data.previous.receivedAmountCents}
              previousMonth={payments.data.previous.month}
            />}
            tone="success"
          />
          <MetricCard
            eyebrow="Income"
            label="Monthly income"
            value={formatMoney(incomeExpenses.data.current.incomeCents, incomeExpenses.data.currency)}
            detail={<Trend
              current={incomeExpenses.data.current.incomeCents}
              previous={incomeExpenses.data.previous.incomeCents}
              previousMonth={incomeExpenses.data.previous.month}
            />}
            tone="success"
          />
          <MetricCard
            eyebrow="Expenses"
            label="Monthly expenses"
            value={formatMoney(incomeExpenses.data.current.expenseCents, incomeExpenses.data.currency)}
            detail={<Trend
              current={incomeExpenses.data.current.expenseCents}
              previous={incomeExpenses.data.previous.expenseCents}
              previousMonth={incomeExpenses.data.previous.month}
              inverse
            />}
          />
          <MetricCard
            eyebrow="Position"
            label="Net this month"
            value={formatMoney(incomeExpenses.data.current.netPositionCents, incomeExpenses.data.currency)}
            detail={<Trend
              current={incomeExpenses.data.current.netPositionCents}
              previous={incomeExpenses.data.previous.netPositionCents}
              previousMonth={incomeExpenses.data.previous.month}
            />}
            tone={incomeExpenses.data.current.netPositionCents < 0 ? 'danger' : 'success'}
          />
        </section>
      )}

      <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Approved issues</p>
              <h2 className="mt-2 text-xl font-semibold">Open missing and damaged equipment</h2>
            </div>
            {discrepancies.data && (
              <div className="text-right">
                <p className="text-2xl font-semibold">{discrepancies.data.openCount}</p>
                <p className="text-xs text-muted-foreground">
                  {formatMoney(discrepancies.data.totalValueCents, discrepancies.data.currency)}
                </p>
              </div>
            )}
          </div>
          {discrepancies.isPending && (
            <p role="status" aria-live="polite" className="p-6 text-muted-foreground">
              Loading equipment issues&hellip;
            </p>
          )}
          {discrepancies.data?.rows.length === 0 && (
            <p className="m-5 rounded-xl bg-success-soft p-4 text-sm text-primary-strong">
              No open missing or damaged equipment matches these filters.
            </p>
          )}
          {discrepancies.data && discrepancies.data.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3">Recorded</th>
                    <th className="px-3 py-3">Customer / order</th>
                    <th className="px-3 py-3">Equipment</th>
                    <th className="px-3 py-3">Issue</th>
                    <th className="px-3 py-3">Responsible</th>
                    <th className="px-5 py-3 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {discrepancies.data.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">
                        {dashboardDateFormatter.format(new Date(row.recordedAt))}
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-medium">{row.customerName ?? 'No customer'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{row.orderNumber ?? '-'}</p>
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-medium">{row.equipmentName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.quantity} at {formatMoney(row.unitPriceCents, discrepancies.data.currency)}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <span className={row.discrepancyType === 'damaged'
                          ? 'rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger'
                          : 'rounded-full bg-muted px-2.5 py-1 text-xs font-semibold'}>
                          {row.discrepancyType}
                        </span>
                        {row.reason && (
                          <p className="mt-2 max-w-52 text-xs text-muted-foreground">{row.reason}</p>
                        )}
                      </td>
                      <td className="px-3 py-4 capitalize">
                        {row.responsibleParty?.replaceAll('_', ' ') ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right font-mono font-semibold">
                        {formatMoney(row.valueCents, discrepancies.data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Current inventory</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <h2 className="text-xl font-semibold">Stock by equipment</h2>
            <p className="text-xs text-muted-foreground">Live price value</p>
          </div>
          <div className="mt-5 max-h-[34rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-3">Equipment</th>
                  <th className="py-3 text-right">Quantity</th>
                  <th className="py-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {stock.data?.items.map((item) => (
                  <tr key={item.equipmentItemId} className="border-b border-border last:border-0">
                    <td className="py-3 pr-3">
                      <p className="font-medium">{item.equipmentName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.category}</p>
                    </td>
                    <td className="py-3 text-right">{item.quantity} {item.unitOfMeasure}</td>
                    <td className="py-3 text-right font-mono">
                      {formatMoney(item.valueCents, stock.data.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {rankings.data && (
        <section className="grid gap-6 lg:grid-cols-2">
          <RankingPanel
            title="Most affected equipment"
            eyebrow="Top 10 equipment"
            rows={rankings.data.items}
            currency={rankings.data.currency}
          />
          <RankingPanel
            title="Most associated customers"
            eyebrow="Top 10 customers"
            rows={rankings.data.customers}
            currency={rankings.data.currency}
          />
        </section>
      )}

      {isOwner && (
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                Owner-only
              </p>
              <h2 className="mt-2 text-xl font-semibold">Price escalation history</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Escalations happen only when the Business Owner runs them. This shows the latest
                owner action and what another 10% increase would do now.
              </p>
            </div>
            {escalations.data && (
              <div className="min-w-64 rounded-2xl bg-primary-soft p-4 text-primary-strong">
                <p className="text-xs font-semibold uppercase tracking-wide">Current 10% preview</p>
                <p className="mt-2 text-lg font-semibold">
                  {formatMoney(escalations.data.preview.currentValueCents, escalations.data.currency)}
                  <span aria-hidden="true"> &rarr; </span>
                  {formatMoney(escalations.data.preview.escalatedValueCents, escalations.data.currency)}
                </p>
                <p className="mt-1 text-xs">{escalations.data.preview.itemCount} equipment prices</p>
              </div>
            )}
          </div>
          {escalations.isPending && (
            <p role="status" aria-live="polite" className="mt-5 text-muted-foreground">
              Loading escalation history&hellip;
            </p>
          )}
          {escalations.data?.lastEscalation && (
            <div className="mt-6 grid gap-4 rounded-2xl border border-border p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Last applied</p>
                <p className="mt-1 font-semibold">
                  {dashboardDateTimeFormatter.format(
                    new Date(escalations.data.lastEscalation.effectiveDate),
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Owner</p>
                <p className="mt-1 font-semibold">{escalations.data.lastEscalation.ownerName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Items changed</p>
                <p className="mt-1 font-semibold">{escalations.data.lastEscalation.itemCount}</p>
              </div>
            </div>
          )}
          {escalations.data?.history.length === 0 && (
            <p className="mt-5 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              No owner-triggered escalation has been recorded.
            </p>
          )}
          {escalations.data && escalations.data.history.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-3">Applied</th>
                    <th className="py-3">Owner</th>
                    <th className="py-3 text-right">Items</th>
                    <th className="py-3 text-right">Previous price book</th>
                    <th className="py-3 text-right">Escalated price book</th>
                  </tr>
                </thead>
                <tbody>
                  {escalations.data.history.map((row) => (
                    <tr key={`${row.effectiveDate}-${row.ownerId ?? 'unknown'}`} className="border-b border-border last:border-0">
                      <td className="py-3">
                        {dashboardDateTimeFormatter.format(new Date(row.effectiveDate))}
                      </td>
                      <td className="py-3">{row.ownerName}</td>
                      <td className="py-3 text-right">{row.itemCount}</td>
                      <td className="py-3 text-right font-mono">
                        {formatMoney(row.previousValueCents, escalations.data.currency)}
                      </td>
                      <td className="py-3 text-right font-mono">
                        {formatMoney(row.escalatedValueCents, escalations.data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </section>
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
      className="rounded-xl border border-primary-soft/60 bg-card px-4 py-2.5 text-sm font-semibold text-primary-strong transition hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft"
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
  eyebrow,
  label,
  value,
  detail,
  tone = 'default',
}: {
  eyebrow: string
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
    <article aria-label={`${eyebrow}: ${label}`} className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h2>
      <p className={`mt-2 break-words text-2xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
      <div className="mt-1.5 text-xs text-muted-foreground">{detail}</div>
    </article>
  )
}

function Trend({
  current,
  previous,
  previousMonth,
  inverse = false,
}: {
  current: number
  previous: number
  previousMonth: string
  inverse?: boolean
}) {
  const difference = current - previous
  const improved = inverse ? difference <= 0 : difference >= 0
  return (
    <span className={improved ? 'text-primary-strong' : 'text-danger'}>
      {difference === 0 ? 'No change' : `${difference > 0 ? '+' : ''}${formatMoney(difference)}`}
      <span className="text-muted-foreground"> vs {previousMonth}</span>
    </span>
  )
}

function RankingPanel({
  title,
  eyebrow,
  rows,
  currency,
}: {
  title: string
  eyebrow: string
  rows: Array<{ id: string; name: string; caseCount: number; quantity: number; valueCents: number }>
  currency: string
}) {
  const maximum = Math.max(...rows.map((row) => row.caseCount), 1)
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-semibold">{title}</h2>
      {rows.length === 0 && (
        <p className="mt-5 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
          No approved missing or damaged cases match these filters.
        </p>
      )}
      <ol className="mt-5 space-y-4">
        {rows.map((row, index) => (
          <li key={row.id}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="truncate text-sm font-semibold">
                <span className="mr-2 text-muted-foreground">{index + 1}.</span>{row.name}
              </p>
              <p className="whitespace-nowrap text-xs text-muted-foreground">
                {row.caseCount} cases &middot; {row.quantity} units &middot;{' '}
                {formatMoney(row.valueCents, currency)}
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={`h-full rounded-full ${eyebrow.includes('equipment') ? 'bg-danger' : 'bg-primary-strong'}`}
                style={{ width: `${Math.max((row.caseCount / maximum) * 100, 4)}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ErrorNotice({ error }: { error: Error }) {
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      {error instanceof ApiError ? error.message : 'Unable to load dashboard reporting'}
    </p>
  )
}
