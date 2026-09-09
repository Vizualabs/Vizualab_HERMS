import type { PriceChangeReason } from '@herms/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { ApiError, api } from '../../api'
import { customerPricingQuery, queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/customers')({
  component: CustomersPage,
})

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Colombo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function CustomersPage() {
  const overview = useQuery(customerPricingQuery)
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const createCustomer = useMutation({
    mutationFn: api.createCustomer,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.customers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customerPricing }),
      ])
      formRef.current?.reset()
      setIsCreateOpen(false)
    },
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isCreateOpen && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLInputElement>('input[name="name"]')?.focus()
    }
    if (!isCreateOpen && dialog.open) dialog.close()
  }, [isCreateOpen])

  const firstError = overview.error

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Customers &amp; Pricing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recurring customers use a fixed price list; new customers are quoted per order.
          </p>
        </div>
        <button className="button-primary shrink-0" type="button" onClick={() => setIsCreateOpen(true)}>
          New customer
        </button>
      </header>

      {overview.isPending && (
        <p role="status" aria-live="polite" className="text-muted-foreground">
          Loading customers and pricing&hellip;
        </p>
      )}
      {firstError && <ErrorNotice error={firstError} />}

      {overview.data && (
        <>
          <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
            <section aria-labelledby="customer-register-title" className="flex max-h-[36rem] flex-col overflow-hidden rounded-xl border border-border bg-card xl:h-[36rem]">
              <div className="border-b border-border px-5 py-4">
                <h2 id="customer-register-title">Customer register</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {overview.data.customers.length} {overview.data.customers.length === 1 ? 'customer' : 'customers'}
                </p>
              </div>
              {overview.data.customers.length === 0 ? (
                <p className="px-5 py-8 text-muted-foreground">No customers have been created.</p>
              ) : (
                <div aria-label="Customer register table" role="region" className="min-h-0 flex-1 overflow-auto px-5 pb-4 pt-3">
                  <table className="w-full min-w-[770px] text-left">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-3 pr-4">Customer</th>
                        <th className="px-3 py-3">Type</th>
                        <th className="px-3 py-3">Contact</th>
                        <th className="px-3 py-3">Orders</th>
                        <th className="py-3 pl-3 text-right">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.data.customers.map((customer) => (
                        <tr key={customer.id} className="border-b border-border last:border-0">
                          <td className="py-3 pr-4">
                            <Link
                              to="/customers/$customerId"
                              params={{ customerId: customer.id }}
                              className="font-semibold text-foreground underline-offset-4 hover:text-primary-strong hover:underline"
                            >
                              {customer.name}
                            </Link>
                            <p className="mt-0.5 text-xs text-muted-foreground">{customer.reference}</p>
                          </td>
                          <td className="px-3 py-3">
                            <CustomerTypeBadge type={customer.type} />
                          </td>
                          <td className="px-3 py-3">
                            <p className="max-w-56 truncate text-muted-foreground">
                              {customer.email || 'No email'}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {customer.phone || 'No phone'}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{customer.orderCount}</td>
                          <td className={`whitespace-nowrap py-3 pl-3 text-right ${customer.outstandingBalanceCents > 0 ? 'font-semibold text-danger' : 'text-muted-foreground'}`}>
                            {customer.outstandingBalanceCents > 0
                              ? compactMoney(customer.outstandingBalanceCents)
                              : 'Settled'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-labelledby="fixed-price-list-title" className="flex max-h-[36rem] flex-col overflow-hidden rounded-xl border border-border bg-card xl:h-[36rem]">
              <div className="border-b border-border px-5 py-4">
                <h2 id="fixed-price-list-title">Fixed price list</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Applied to every recurring-customer quotation
                </p>
              </div>
              {overview.data.fixedPrices.length === 0 ? (
                <p className="px-5 py-8 text-muted-foreground">No equipment prices are available.</p>
              ) : (
                <ul className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto px-5 py-3">
                  {overview.data.fixedPrices.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-5 py-2">
                      <Link
                        to="/items/$itemId"
                        params={{ itemId: item.id }}
                        className="font-medium text-foreground underline-offset-4 hover:text-primary-strong hover:underline"
                      >
                        {item.name}
                      </Link>
                      <span className="whitespace-nowrap font-semibold tabular-nums">
                        {compactMoney(item.currentUnitPriceCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section aria-labelledby="price-history-title" className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 id="price-history-title">Price history</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Every published equipment price change is recorded permanently.
              </p>
            </div>
            {overview.data.priceHistory.length === 0 ? (
              <p className="px-5 py-8 text-muted-foreground">No price changes have been recorded.</p>
            ) : (
              <div aria-label="Price history table" role="region" className="max-h-[32rem] overflow-auto px-5 pb-4 pt-3">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-3 pr-4">Item</th>
                      <th className="px-3 py-3">Previous</th>
                      <th className="px-3 py-3">New</th>
                      <th className="px-3 py-3">Effective</th>
                      <th className="py-3 pl-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.data.priceHistory.map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0">
                        <td className="py-3 pr-4 font-medium">{entry.itemName}</td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {entry.oldPriceCents === null ? 'Initial price' : compactMoney(entry.oldPriceCents)}
                        </td>
                        <td className="px-3 py-3 font-medium">{compactMoney(entry.newPriceCents)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                          {dateFormatter.format(new Date(entry.effectiveDate))}
                        </td>
                        <td className="py-3 pl-3"><PriceReasonBadge reason={entry.reason} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="new-customer-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-foreground/35"
        onClose={() => setIsCreateOpen(false)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="new-customer-title">New customer</h2>
            <p className="mt-1 text-sm text-muted-foreground">Add contact details now; pricing can be configured later.</p>
          </div>
          <button
            type="button"
            aria-label="Close new customer dialog"
            className="flex size-8 items-center justify-center rounded-lg text-xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setIsCreateOpen(false)}
          >
            &times;
          </button>
        </div>
        <form
          ref={formRef}
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            createCustomer.mutate({
              name: String(form.get('name') ?? ''),
              type: 'new',
              email: String(form.get('email') ?? ''),
              phone: String(form.get('phone') ?? ''),
              address: String(form.get('address') ?? ''),
            })
          }}
        >
          <Field label="Name" name="name" required autoFocus />
          <Field label="Email" name="email" type="email" />
          <Field label="Phone" name="phone" />
          <Field label="Address" name="address" />
          {createCustomer.error && (
            <ErrorNotice error={createCustomer.error} compact fallback="Unable to create customer" />
          )}
          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <button className="button-secondary" type="button" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </button>
            <button className="button-primary" type="submit" disabled={createCustomer.isPending}>
              {createCustomer.isPending ? 'Creating…' : 'Create customer'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}

function CustomerTypeBadge({ type }: { type: 'new' | 'recurring' }) {
  return (
    <span className={type === 'recurring'
      ? 'inline-flex rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold capitalize text-primary-strong'
      : 'inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-muted-foreground'}>
      {type}
    </span>
  )
}

const reasonLabels: Record<PriceChangeReason, string> = {
  scheduled_escalation: 'Scheduled 10% escalation',
  owner_escalation: 'Owner 10% escalation',
  negotiated: 'Negotiated rate',
  correction: 'Price correction',
}

function PriceReasonBadge({ reason }: { reason: PriceChangeReason }) {
  const highlighted = reason === 'scheduled_escalation' || reason === 'owner_escalation'
  return (
    <span className={highlighted
      ? 'inline-flex whitespace-nowrap rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-strong'
      : 'inline-flex whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground'}>
      {reasonLabels[reason]}
    </span>
  )
}

function compactMoney(value: number) {
  return `LKR ${new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: value % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value / 100)}`
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
  autoFocus = false,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  autoFocus?: boolean
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <input
        className="input"
        name={name}
        type={type}
        required={required}
        autoFocus={autoFocus}
        autoComplete={name === 'name' ? 'organization' : name}
      />
    </label>
  )
}

function ErrorNotice({
  error,
  compact = false,
  fallback = 'Unable to load customers and pricing',
}: {
  error: Error
  compact?: boolean
  fallback?: string
}) {
  return (
    <p role="alert" className={`rounded-xl bg-danger-soft text-sm text-danger ${compact ? 'px-4 py-3' : 'border border-danger/30 p-4'}`}>
      {error instanceof ApiError ? error.message : fallback}
    </p>
  )
}
