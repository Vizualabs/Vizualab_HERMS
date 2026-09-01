import type { ExpenseInput, PaymentInput, PaymentMethod } from '@herms/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMoney, type MonthlyFinance } from '../../api'
import {
  customerBalanceQuery,
  invoiceQuery,
  monthlyFinanceQuery,
  ordersQuery,
  queryKeys,
  sessionQuery,
} from '../../queries'

export const Route = createFileRoute('/_authenticated/finance')({
  component: FinancePage,
})

function localDateTimeValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatMonth(month: string, style: 'long' | 'short' = 'long') {
  return new Intl.DateTimeFormat('en-US', {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(new Date(value))
}

function formatMethod(method: PaymentMethod) {
  return method.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase())
}

function csvCell(value: string | number) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function downloadFinanceReport(report: MonthlyFinance) {
  const rows: Array<Array<string | number>> = [
    ['HERMS Payments & Finance report'],
    ['Reporting month', formatMonth(report.month)],
    [],
    ['Summary'],
    ['Received', report.incomeCents / 100],
    ['Outstanding', report.outstandingCents / 100],
    ['Expenses', report.expenseCents / 100],
    ['Net position', report.netPositionCents / 100],
    [],
    ['Six-month history'],
    ['Month', 'Income', 'Expenses'],
    ...report.history.map((row) => [row.month, row.incomeCents / 100, row.expenseCents / 100]),
    [],
    ['Payments received'],
    ['Date', 'Customer', 'Order', 'Method', 'Amount'],
    ...report.recentPayments.map((row) => [
      formatDate(row.paymentDate, report.timezone),
      row.customerName,
      row.orderNumber,
      formatMethod(row.method),
      row.amountCents / 100,
    ]),
    [],
    ['Expenses'],
    ['Date', 'Category', 'Description', 'Amount'],
    ...report.recentExpenses.map((row) => [
      formatDate(row.expenseDate, report.timezone),
      row.category,
      row.description ?? '',
      row.amountCents / 100,
    ]),
    [],
    ['Outstanding balances'],
    ['Customer', 'Open orders', 'Invoiced', 'Paid', 'Outstanding'],
    ...report.outstandingBalances.map((row) => [
      row.customerName,
      row.openOrders,
      row.invoicedCents / 100,
      row.paidCents / 100,
      row.outstandingCents / 100,
    ]),
  ]
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `herms-finance-${report.month}.csv`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function FinancePage() {
  const queryClient = useQueryClient()
  const session = useQuery(sessionQuery)
  const isFinance = session.data?.role === 'finance' || session.data?.role === 'super_user'
  const canView = isFinance || session.data?.role === 'business_owner'
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [orderId, setOrderId] = useState('')
  const orders = useQuery({ ...ordersQuery, enabled: isFinance })
  const invoice = useQuery({ ...invoiceQuery(orderId), enabled: isFinance && Boolean(orderId) })
  const customerId = invoice.data?.customerId ?? ''
  const balance = useQuery({
    ...customerBalanceQuery(customerId),
    enabled: isFinance && Boolean(customerId),
  })
  const monthly = useQuery({ ...monthlyFinanceQuery(month), enabled: canView })

  const payment = useMutation({
    mutationFn: (input: PaymentInput) => api.recordPayment(input),
    onSuccess: async (_created, input) => {
      const selectedCustomerId = invoice.data?.customerId
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoice(input.orderId) }),
        selectedCustomerId
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.customerBalance(selectedCustomerId),
            })
          : Promise.resolve(),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlyFinance(month) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ])
    },
  })
  const expense = useMutation({
    mutationFn: (input: ExpenseInput) => api.recordExpense(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlyFinance(month) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ])
    },
  })

  if (!canView) {
    return (
      <p role="alert" className="rounded-xl border border-border bg-card p-6 text-danger">
        Finance access is restricted to Finance and Business Owner roles.
      </p>
    )
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1>Payments & Finance</h1>
          <p className="mt-1 text-base text-muted-foreground">{formatMonth(month)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="finance-report-month">Reporting month</label>
          <input
            id="finance-report-month"
            name="financeReportMonth"
            className="input w-auto min-w-40"
            type="month"
            autoComplete="off"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <button
            type="button"
            className="button-secondary"
            disabled={!monthly.data}
            onClick={() => monthly.data && downloadFinanceReport(monthly.data)}
          >
            Export report
          </button>
        </div>
      </header>

      {monthly.isPending && (
        <p role="status" aria-live="polite" className="rounded-xl border border-border bg-card p-6 text-muted-foreground">
          Loading finance report…
        </p>
      )}
      {monthly.error && <ErrorText error={monthly.error} fallback="Unable to load the finance report" />}

      {monthly.data && (
        <>
          <section aria-label="Finance summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Received this month"
              value={monthly.data.incomeCents}
              currency={monthly.data.currency}
              tone="success"
            />
            <SummaryCard
              label="Outstanding"
              value={monthly.data.outstandingCents}
              currency={monthly.data.currency}
              tone="warning"
            />
            <SummaryCard
              label="Expenses this month"
              value={monthly.data.expenseCents}
              currency={monthly.data.currency}
            />
            <SummaryCard
              label="Net position"
              value={monthly.data.netPositionCents}
              currency={monthly.data.currency}
              tone={monthly.data.netPositionCents >= 0 ? 'success' : 'danger'}
            />
          </section>

          <FinanceChart rows={monthly.data.history} currency={monthly.data.currency} />

          <div className="grid gap-5 2xl:grid-cols-2">
            <PaymentsTable report={monthly.data} />
            <ExpensesTable report={monthly.data} />
          </div>

          <OutstandingBalances report={monthly.data} />
        </>
      )}

      {isFinance && (
        <section className="space-y-5 border-t border-border pt-7" aria-labelledby="finance-management-heading">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-strong">Finance workspace</p>
            <h2 id="finance-management-heading" className="mt-1">Record payments & expenses</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Existing payment, invoice, customer balance, and expense workflows remain available here.
            </p>
          </div>

          <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="order-invoice-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 id="order-invoice-heading" className="text-pretty">Order invoice & balance</h3>
                <p className="mt-1 text-sm text-muted-foreground">Choose an order to review its frozen invoice and current balance before recording payment.</p>
              </div>
              {invoice.data && (
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: invoice.data.id }}
                  className="rounded-sm text-sm font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View frozen order lines
                </Link>
              )}
            </div>

            <label className="mt-5 flex flex-col gap-2 text-sm font-medium">
              Order
              <select
                className="input bg-card"
                name="financeOrder"
                autoComplete="off"
                value={orderId}
                onChange={(event) => {
                  setOrderId(event.target.value)
                  payment.reset()
                }}
              >
                <option value="">Select an order</option>
                {orders.data?.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.orderNumber} — {order.customerName}
                  </option>
                ))}
              </select>
            </label>
            {orders.isPending && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">Loading orders…</p>}
            {orders.error && <ErrorText error={orders.error} fallback="Unable to load orders" />}
            {invoice.isPending && orderId && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">Loading invoice…</p>}
            {invoice.error && <ErrorText error={invoice.error} fallback="Unable to load invoice" />}

            {invoice.data && (
              <div className="mt-5 border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{invoice.data.orderNumber}</p>
                    <p className="mt-1 break-words text-sm text-muted-foreground">{invoice.data.customerName}</p>
                  </div>
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Ready for payment</span>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MoneyCard label="Order value" value={invoice.data.orderValueCents} currency={invoice.data.currency} />
                  <MoneyCard label="Confirmed claims" value={invoice.data.claimAmountCents} currency={invoice.data.currency} />
                  <MoneyCard label="Paid" value={invoice.data.paidAmountCents} currency={invoice.data.currency} />
                  <MoneyCard label="Outstanding" value={invoice.data.outstandingBalanceCents} currency={invoice.data.currency} />
                </dl>
              </div>
            )}
          </section>

          <div className="grid items-stretch gap-5 xl:grid-cols-2">
            <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-primary-strong">Order payment</p>
                  <h3 className="mt-1 text-pretty">Record payment</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Record a full or partial payment against the selected order.</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  {invoice.data ? 'Order selected' : 'Select order above'}
                </span>
              </div>

              <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment applies to</p>
                {invoice.data ? (
                  <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{invoice.data.orderNumber}</p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">{invoice.data.customerName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Outstanding</p>
                      <p className="mt-1 font-mono font-semibold text-danger">{formatMoney(invoice.data.outstandingBalanceCents, invoice.data.currency)}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Select an order in the invoice section above to enable payment.</p>
                )}
              </div>

              <form
                  className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const form = new FormData(event.currentTarget)
                    payment.mutate({
                      orderId,
                      amountCents: Number(form.get('amountCents')),
                      paymentDate: new Date(String(form.get('paymentDate'))).toISOString(),
                      method: String(form.get('method')) as PaymentMethod,
                    })
                  }}
              >
                  <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
                    Amount (minor units)
                    <input
                      className="input"
                      name="amountCents"
                      type="number"
                      min="1"
                      max={invoice.data?.outstandingBalanceCents}
                      step="1"
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      disabled={!invoice.data || invoice.data.outstandingBalanceCents === 0}
                      aria-describedby="payment-amount-help"
                    />
                    <span id="payment-amount-help" className="text-xs font-normal text-muted-foreground">Enter whole minor units; 150000 equals LKR 1,500.00.</span>
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Payment date & time
                    <input className="input" name="paymentDate" type="datetime-local" defaultValue={localDateTimeValue()} autoComplete="off" required disabled={!invoice.data || invoice.data.outstandingBalanceCents === 0} />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Method
                    <select className="input" name="method" defaultValue="bank_transfer" autoComplete="off" required disabled={!invoice.data || invoice.data.outstandingBalanceCents === 0}>
                      <option value="cash">Cash</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  {payment.error && <div className="sm:col-span-2"><ErrorText error={payment.error} fallback="Unable to record payment" /></div>}
                  {payment.data && <p role="status" aria-live="polite" className="text-sm font-medium text-primary-strong sm:col-span-2">Payment recorded and balances updated.</p>}
                  <button
                    type="submit"
                    className="button-primary w-full sm:col-span-2"
                    disabled={payment.isPending || !invoice.data || invoice.data.outstandingBalanceCents === 0}
                  >
                    {payment.isPending ? 'Recording…' : 'Record payment'}
                  </button>
              </form>
            </section>

            <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-primary-strong">Business expense</p>
                  <h3 className="mt-1 text-pretty">Record expense</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Add an operating expense independently from customer orders.</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">No order required</span>
              </div>
                <form
                  className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const formElement = event.currentTarget
                    const form = new FormData(formElement)
                    expense.mutate({
                      category: String(form.get('category')),
                      amountCents: Number(form.get('amountCents')),
                      expenseDate: new Date(String(form.get('expenseDate'))).toISOString(),
                      description: String(form.get('description') ?? ''),
                    }, {
                      onSuccess: () => formElement.reset(),
                    })
                  }}
                >
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Category
                    <input className="input" name="category" maxLength={120} autoComplete="off" required />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Amount (minor units)
                    <input className="input" name="amountCents" type="number" min="1" step="1" inputMode="numeric" autoComplete="off" required aria-describedby="expense-amount-help" />
                    <span id="expense-amount-help" className="text-xs font-normal text-muted-foreground">Enter whole minor units.</span>
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
                    Expense date & time
                    <input className="input" name="expenseDate" type="datetime-local" defaultValue={localDateTimeValue()} autoComplete="off" required />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
                    Description
                    <textarea className="input min-h-24" name="description" maxLength={500} autoComplete="off" />
                  </label>
                  {expense.error && <div className="sm:col-span-2"><ErrorText error={expense.error} fallback="Unable to record expense" /></div>}
                  {expense.data && <p role="status" aria-live="polite" className="text-sm font-medium text-primary-strong sm:col-span-2">Expense recorded.</p>}
                  <button type="submit" className="button-primary w-full sm:col-span-2" disabled={expense.isPending}>
                    {expense.isPending ? 'Recording…' : 'Record expense'}
                  </button>
                </form>
            </section>
          </div>

          {balance.data && (
            <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-pretty">Selected customer balance</h3>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{balance.data.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total outstanding</p>
                  <p className="mt-1 font-mono text-xl font-semibold text-danger">
                    {formatMoney(balance.data.outstandingBalanceCents, balance.data.currency)}
                  </p>
                </div>
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[650px] text-left">
                  <caption className="sr-only">Orders contributing to the selected customer balance</caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-3">Order</th>
                      <th className="text-right">Total billed</th>
                      <th className="text-right">Claims</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.data.orders.map((order) => (
                      <tr key={order.id} className="border-b border-border last:border-0">
                        <td className="py-3 font-medium">{order.orderNumber}</td>
                        <td className="text-right font-mono">{formatMoney(order.invoiceValueCents, balance.data.currency)}</td>
                        <td className="text-right font-mono">{formatMoney(order.claimAmountCents, balance.data.currency)}</td>
                        <td className="text-right font-mono">{formatMoney(order.paidAmountCents, balance.data.currency)}</td>
                        <td className="text-right font-mono font-semibold text-danger">{formatMoney(order.outstandingBalanceCents, balance.data.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      )}
    </section>
  )
}

function SummaryCard({
  label,
  value,
  currency,
  tone = 'default',
}: {
  label: string
  value: number
  currency: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const valueClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-[oklch(65%_0.15_75)]',
    danger: 'text-danger',
  }[tone]
  return (
    <article className="rounded-xl border border-border bg-card px-5 py-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-3 font-mono text-2xl font-medium ${valueClass}`}>{formatMoney(value, currency)}</p>
    </article>
  )
}

function FinanceChart({ rows, currency }: { rows: MonthlyFinance['history']; currency: string }) {
  const maximum = Math.max(...rows.flatMap((row) => [row.incomeCents, row.expenseCents]), 1)
  const magnitude = 10 ** Math.max(Math.floor(Math.log10(maximum)) - 1, 0)
  const chartMaximum = Math.ceil(maximum / magnitude) * magnitude
  const ticks = [1, 0.75, 0.5, 0.25, 0]
  const compactMoney = (value: number) => new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value / 100)

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="finance-chart-title">
      <div className="border-b border-border px-5 py-4">
        <h2 id="finance-chart-title">Income vs expenses — last 6 months</h2>
      </div>
      <div className="overflow-x-auto px-4 pb-4 pt-5 sm:px-5">
        <div className="grid min-w-[640px] grid-cols-[3.25rem_1fr] gap-3">
          <div className="flex h-64 flex-col justify-between pb-8 text-right text-xs text-muted-foreground" aria-hidden="true">
            {ticks.map((tick) => <span key={tick}>{compactMoney(chartMaximum * tick)}</span>)}
          </div>
          <div className="relative h-64">
            <div className="absolute inset-x-0 bottom-8 top-0 flex flex-col justify-between" aria-hidden="true">
              {ticks.map((tick) => <div key={tick} className="border-t border-dashed border-border" />)}
            </div>
            <div className="absolute inset-x-0 bottom-8 top-0 flex items-end gap-3 px-3">
              {rows.map((row) => (
                <div key={row.month} className="flex h-full min-w-0 flex-1 items-end justify-center gap-1">
                  <div
                    className="w-full max-w-[4.5rem] rounded-t bg-[oklch(52%_0.11_194)]"
                    style={{ height: `${Math.max((row.incomeCents / chartMaximum) * 100, row.incomeCents ? 1 : 0)}%` }}
                    title={`${formatMonth(row.month)} income: ${formatMoney(row.incomeCents, currency)}`}
                    aria-hidden="true"
                  />
                  <div
                    className="w-full max-w-[4.5rem] rounded-t bg-[oklch(72%_0.15_75)]"
                    style={{ height: `${Math.max((row.expenseCents / chartMaximum) * 100, row.expenseCents ? 1 : 0)}%` }}
                    title={`${formatMonth(row.month)} expenses: ${formatMoney(row.expenseCents, currency)}`}
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {formatMonth(row.month)}: income {formatMoney(row.incomeCents, currency)}, expenses {formatMoney(row.expenseCents, currency)}
                  </span>
                </div>
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex gap-3 px-3 text-center text-xs text-muted-foreground" aria-hidden="true">
              {rows.map((row) => <span key={row.month} className="min-w-0 flex-1">{formatMonth(row.month, 'short')}</span>)}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-5 text-sm">
          <span className="flex items-center gap-2 text-[oklch(45%_0.11_194)]"><span className="size-3 bg-[oklch(52%_0.11_194)]" aria-hidden="true" />Income</span>
          <span className="flex items-center gap-2 text-[oklch(62%_0.15_75)]"><span className="size-3 bg-[oklch(72%_0.15_75)]" aria-hidden="true" />Expenses</span>
        </div>
      </div>
    </section>
  )
}

function PaymentsTable({ report }: { report: MonthlyFinance }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="payments-received-title">
      <div className="border-b border-border px-5 py-4"><h2 id="payments-received-title">Payments received</h2></div>
      <div className="overflow-x-auto px-5 py-3">
        <table className="w-full min-w-[560px] text-left">
          <caption className="sr-only">Most recently received payments</caption>
          <thead><tr className="border-b border-border"><th className="py-3">Date</th><th>Customer</th><th>Order</th><th>Method</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {report.recentPayments.map((payment) => (
              <tr key={payment.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap py-3 text-muted-foreground">{formatDate(payment.paymentDate, report.timezone)}</td>
                <td className="font-medium">{payment.customerName}</td>
                <td className="whitespace-nowrap text-muted-foreground">{payment.orderNumber}</td>
                <td><span className="whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{formatMethod(payment.method)}</span></td>
                <td className="whitespace-nowrap text-right font-mono">{formatMoney(payment.amountCents, report.currency)}</td>
              </tr>
            ))}
            {report.recentPayments.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ExpensesTable({ report }: { report: MonthlyFinance }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="expenses-title">
      <div className="border-b border-border px-5 py-4"><h2 id="expenses-title">Expenses</h2></div>
      <div className="overflow-x-auto px-5 py-3">
        <table className="w-full min-w-[560px] text-left">
          <caption className="sr-only">Most recently recorded expenses</caption>
          <thead><tr className="border-b border-border"><th className="py-3">Date</th><th>Category</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {report.recentExpenses.map((expense) => (
              <tr key={expense.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap py-3 text-muted-foreground">{formatDate(expense.expenseDate, report.timezone)}</td>
                <td><span className="whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{expense.category}</span></td>
                <td className="max-w-64 truncate text-muted-foreground" title={expense.description ?? undefined}>{expense.description || '—'}</td>
                <td className="whitespace-nowrap text-right font-mono">{formatMoney(expense.amountCents, report.currency)}</td>
              </tr>
            ))}
            {report.recentExpenses.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No expenses recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function OutstandingBalances({ report }: { report: MonthlyFinance }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="outstanding-title">
      <div className="border-b border-border px-5 py-4">
        <h2 id="outstanding-title">Outstanding balances</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Includes confirmed damage claims
          {report.outstandingBalances.length > 5 && ' · Scroll inside the table to view all customers'}
        </p>
      </div>
      <div
        role="region"
        aria-label="Outstanding balances table"
        tabIndex={report.outstandingBalances.length > 5 ? 0 : undefined}
        className="max-h-[20.5rem] overflow-auto overscroll-contain px-5 pb-3 [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <table className="w-full min-w-[760px] text-left">
          <caption className="sr-only">Customers with outstanding balances</caption>
          <thead className="sticky top-0 z-10 bg-card"><tr className="h-12 border-b border-border"><th>Customer</th><th>Open orders</th><th className="text-right">Invoiced</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th></tr></thead>
          <tbody>
            {report.outstandingBalances.map((balance) => (
              <tr key={balance.id} className="h-14 border-b border-border last:border-0">
                <td className="whitespace-nowrap font-medium">{balance.customerName}</td>
                <td className="font-mono text-muted-foreground">{balance.openOrders}</td>
                <td className="text-right font-mono">{formatMoney(balance.invoicedCents, report.currency)}</td>
                <td className="text-right font-mono">{formatMoney(balance.paidCents, report.currency)}</td>
                <td className="text-right font-mono font-semibold text-danger">{formatMoney(balance.outstandingCents, report.currency)}</td>
              </tr>
            ))}
            {report.outstandingBalances.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">All customer balances are settled.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function MoneyCard({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-2 font-mono text-lg font-semibold">{formatMoney(value, currency)}</dd>
    </div>
  )
}

function ErrorText({ error, fallback }: { error: Error; fallback: string }) {
  return <p role="alert" className="mt-4 text-sm text-danger">{error instanceof ApiError ? error.message : fallback}</p>
}
