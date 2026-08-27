import type { ExpenseInput, PaymentInput, PaymentMethod } from '@herms/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMoney } from '../../api'
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

function FinancePage() {
  const queryClient = useQueryClient()
  const session = useQuery(sessionQuery)
  const isFinance = session.data?.role === 'finance'
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
      ])
    },
  })
  const expense = useMutation({
    mutationFn: (input: ExpenseInput) => api.recordExpense(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.monthlyFinance(month) })
    },
  })

  if (!canView) {
    return (
      <p role="alert" className="rounded-2xl border border-border bg-card p-6 text-danger">
        Finance access is restricted to Finance and Business Owner roles.
      </p>
    )
  }

  return (
    <section>
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">Finance</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Payments and expenses</h1>
      <p className="mt-2 text-muted-foreground">
        Invoice values come from frozen order lines. All amounts are stored as integer minor units.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Monthly position</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Payments received minus independent business expenses.
            </p>
          </div>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Reporting month
            <input
              className="input"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
        </div>
        {monthly.isPending && <p className="mt-5 text-muted-foreground">Loading monthly totals...</p>}
        {monthly.error && <ErrorText error={monthly.error} fallback="Unable to load monthly totals" />}
        {monthly.data && (
          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <MoneyCard label="Income received" value={monthly.data.incomeCents} currency={monthly.data.currency} />
            <MoneyCard label="Expenses" value={monthly.data.expenseCents} currency={monthly.data.currency} />
            <MoneyCard label="Net position" value={monthly.data.netPositionCents} currency={monthly.data.currency} />
          </dl>
        )}
      </div>

      {isFinance && (
        <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="flex flex-col gap-8">
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Order invoice and balance</h2>
              <label className="mt-5 flex flex-col gap-2 text-sm font-medium">
                Order
                <select
                  className="input"
                  value={orderId}
                  onChange={(event) => {
                    setOrderId(event.target.value)
                    payment.reset()
                  }}
                >
                  <option value="">Select an order</option>
                  {orders.data?.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.orderNumber} - {order.customerName}
                    </option>
                  ))}
                </select>
              </label>
              {orders.isPending && <p className="mt-4 text-sm text-muted-foreground">Loading orders...</p>}
              {orders.error && <ErrorText error={orders.error} fallback="Unable to load orders" />}
              {invoice.isPending && orderId && <p className="mt-4 text-sm text-muted-foreground">Loading invoice...</p>}
              {invoice.error && <ErrorText error={invoice.error} fallback="Unable to load invoice" />}
              {invoice.data && (
                <div className="mt-6 flex flex-col gap-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold">{invoice.data.orderNumber}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{invoice.data.customerName}</p>
                    </div>
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: invoice.data.id }}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      View frozen order lines
                    </Link>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <MoneyCard label="Invoice value" value={invoice.data.invoiceValueCents} currency={invoice.data.currency} />
                    <MoneyCard label="Paid" value={invoice.data.paidAmountCents} currency={invoice.data.currency} />
                    <MoneyCard label="Outstanding" value={invoice.data.outstandingBalanceCents} currency={invoice.data.currency} />
                  </dl>
                </div>
              )}
            </section>

            {balance.data && (
              <section className="rounded-2xl border border-border bg-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Customer balance</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{balance.data.name}</p>
                  </div>
                  <p className="font-mono text-xl font-semibold">
                    {formatMoney(balance.data.outstandingBalanceCents, balance.data.currency)}
                  </p>
                </div>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-3">Order</th>
                        <th className="text-right">Invoice</th>
                        <th className="text-right">Paid</th>
                        <th className="text-right">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balance.data.orders.map((order) => (
                        <tr key={order.id} className="border-b border-border">
                          <td className="py-3 font-medium">{order.orderNumber}</td>
                          <td className="text-right font-mono">{formatMoney(order.invoiceValueCents, balance.data.currency)}</td>
                          <td className="text-right font-mono">{formatMoney(order.paidAmountCents, balance.data.currency)}</td>
                          <td className="text-right font-mono">{formatMoney(order.outstandingBalanceCents, balance.data.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          <aside className="flex h-fit flex-col gap-8">
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Record payment</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Partial payments are allowed. Overpayments are rejected.
              </p>
              <form
                className="mt-5 flex flex-col gap-4"
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
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Amount (minor units)
                  <input
                    className="input"
                    name="amountCents"
                    type="number"
                    min="1"
                    max={invoice.data?.outstandingBalanceCents}
                    step="1"
                    required
                    disabled={!invoice.data || invoice.data.outstandingBalanceCents === 0}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Payment date and time
                  <input className="input" name="paymentDate" type="datetime-local" defaultValue={localDateTimeValue()} required />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Method
                  <select className="input" name="method" defaultValue="bank_transfer" required>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                {payment.error && <ErrorText error={payment.error} fallback="Unable to record payment" />}
                {payment.data && <p role="status" className="text-sm font-medium text-primary-strong">Payment recorded and balances updated.</p>}
                <button
                  className="button-primary w-full"
                  disabled={payment.isPending || !invoice.data || invoice.data.outstandingBalanceCents === 0}
                >
                  {payment.isPending ? 'Recording...' : 'Record payment'}
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Record expense</h2>
              <p className="mt-2 text-sm text-muted-foreground">Expenses are independent of customer orders.</p>
              <form
                className="mt-5 flex flex-col gap-4"
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
                  <input className="input" name="category" maxLength={120} required />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Amount (minor units)
                  <input className="input" name="amountCents" type="number" min="1" step="1" required />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Expense date and time
                  <input className="input" name="expenseDate" type="datetime-local" defaultValue={localDateTimeValue()} required />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Description
                  <textarea className="input min-h-24" name="description" maxLength={500} />
                </label>
                {expense.error && <ErrorText error={expense.error} fallback="Unable to record expense" />}
                {expense.data && <p role="status" className="text-sm font-medium text-primary-strong">Expense recorded.</p>}
                <button className="button-primary w-full" disabled={expense.isPending}>
                  {expense.isPending ? 'Recording...' : 'Record expense'}
                </button>
              </form>
            </section>
          </aside>
        </div>
      )}
    </section>
  )
}

function MoneyCard({
  label,
  value,
  currency,
}: {
  label: string
  value: number
  currency: string
}) {
  return (
    <div className="rounded-xl bg-muted p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-2 font-mono text-lg font-semibold">{formatMoney(value, currency)}</dd>
    </div>
  )
}

function ErrorText({ error, fallback }: { error: Error; fallback: string }) {
  return (
    <p role="alert" className="mt-4 text-sm text-danger">
      {error instanceof ApiError ? error.message : fallback}
    </p>
  )
}
