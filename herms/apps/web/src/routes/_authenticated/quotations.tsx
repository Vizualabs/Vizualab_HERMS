import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMoney } from '../../api'
import { customersQuery, itemsQuery, queryKeys, quotationsQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/quotations')({ component: QuotationsPage })

function QuotationsPage() {
  const quotations = useQuery(quotationsQuery)
  const customers = useQuery(customersQuery)
  const items = useQuery(itemsQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [customerId, setCustomerId] = useState('')
  const [lines, setLines] = useState([{ key: 'line-1', equipmentItemId: '', quantity: 1, manualUnitPriceCents: '' }])
  const selectedCustomer = customers.data?.find((customer) => customer.id === customerId)
  const create = useMutation({
    mutationFn: api.createQuotation,
    onSuccess: async (quotation) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.quotations })
      await navigate({ to: '/quotations/$quotationId', params: { quotationId: quotation.id } })
    },
  })

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <section>
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Sales</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Quotations</h1>
        <p className="mt-2 text-muted-foreground">Frozen prices, controlled status changes, and one-click order conversion.</p>
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          {quotations.isPending && <p className="p-6 text-muted-foreground">Loading quotations...</p>}
          {quotations.error && <ErrorMessage error={quotations.error} fallback="Unable to load quotations" />}
          {quotations.data?.length === 0 && <p className="p-6 text-muted-foreground">No quotations have been created.</p>}
          <ul className="divide-y divide-border">
            {quotations.data?.map((quotation) => (
              <li key={quotation.id}>
                <Link to="/quotations/$quotationId" params={{ quotationId: quotation.id }} className="flex items-center justify-between gap-5 px-5 py-4 hover:bg-muted">
                  <div><p className="font-semibold">{quotation.quotationNumber}</p><p className="mt-1 text-sm text-muted-foreground">{quotation.customerName}</p></div>
                  <div className="text-right"><p className="font-mono text-sm font-semibold">{formatMoney(quotation.totalValueCents)}</p><Status value={quotation.status} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <aside className="h-fit rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Create quotation</h2>
        <p className="mt-2 text-sm text-muted-foreground">Add each required item once. Prices freeze when the quotation is created.</p>
        <form className="mt-5 space-y-4" onSubmit={(event) => {
          event.preventDefault()
          create.mutate({ customerId, lines: lines.map((line) => ({
            equipmentItemId: line.equipmentItemId,
            quantity: line.quantity,
            ...(selectedCustomer?.type === 'new' ? { manualUnitPriceCents: Number(line.manualUnitPriceCents) } : {}),
          })) })
        }}>
          <label className="block text-sm font-medium">Customer
            <select className="input mt-2" required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Select customer</option>
              {customers.data?.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.type})</option>)}
            </select>
          </label>
          <div className="space-y-3">
            {lines.map((line, index) => <div key={line.key} className="rounded-xl border border-border p-3">
              <div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold">Line {index + 1}</p>{lines.length > 1 && <button type="button" className="text-xs font-medium text-danger" onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>Remove</button>}</div>
              <select className="input" required value={line.equipmentItemId} aria-label={`Equipment for line ${index + 1}`} onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, equipmentItemId: event.target.value } : entry))}>
                <option value="">Select equipment</option>{items.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <div className={`mt-3 grid gap-3 ${selectedCustomer?.type === 'new' ? 'grid-cols-2' : ''}`}>
                <label className="text-xs font-medium">Quantity<input className="input mt-1" type="number" min="1" step="1" value={line.quantity} required onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: Number(event.target.value) } : entry))} /></label>
                {selectedCustomer?.type === 'new' && <label className="text-xs font-medium">Unit price (minor units)<input className="input mt-1" type="number" min="1" step="1" value={line.manualUnitPriceCents} required onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, manualUnitPriceCents: event.target.value } : entry))} /></label>}
              </div>
            </div>)}
            <button type="button" className="button-secondary w-full" disabled={lines.length >= 100} onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), equipmentItemId: '', quantity: 1, manualUnitPriceCents: '' }])}>Add line</button>
          </div>
          {selectedCustomer?.type === 'recurring' && <p className="rounded-xl bg-primary-soft px-4 py-3 text-sm text-primary-strong">Current fixed customer prices are applied automatically to every line.</p>}
          {create.error && <ErrorMessage error={create.error} fallback="Unable to create quotation" />}
          <button className="button-primary w-full" disabled={create.isPending || !customerId}>{create.isPending ? 'Creating...' : 'Create and send'}</button>
        </form>
      </aside>
    </div>
  )
}

function Status({ value }: { value: string }) { return <span className="mt-1 inline-block rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold capitalize text-primary-strong">{value}</span> }
function ErrorMessage({ error, fallback }: { error: Error; fallback: string }) { return <p role="alert" className="p-4 text-sm text-danger">{error instanceof ApiError ? error.message : fallback}</p> }
