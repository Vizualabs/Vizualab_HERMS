import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMoney, type EquipmentItem } from '../../api'
import { SearchableSelect } from '../../components/SearchableSelect'
import { parseMajorCurrencyToMinorUnits } from '../../money'
import { itemsQuery, queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/customers_/$customerId')({
  component: CustomerDetailPage,
})

function CustomerDetailPage() {
  const { customerId } = Route.useParams()
  const queryClient = useQueryClient()
  const customer = useQuery(
    queryOptions({
      queryKey: queryKeys.customer(customerId),
      queryFn: () => api.customer(customerId),
    }),
  )
  const items = useQuery(itemsQuery)
  const update = useMutation({
    mutationFn: (input: { name: string; email: string; phone: string; address: string }) =>
      api.updateCustomer(customerId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.customer(customerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers }),
      ])
    },
  })
  const savePrices = useMutation({
    mutationFn: (prices: Array<{ equipmentItemId: string; unitPriceCents: number }>) =>
      customer.data?.type === 'recurring'
        ? api.replaceCustomerPrices(customerId, { prices })
        : api.setRecurring(customerId, { prices }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.customer(customerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customerPricing }),
      ])
    },
  })

  if (customer.isPending) return <p className="text-muted-foreground">Loading customer…</p>
  if (!customer.data) {
    return (
      <p role="alert" className="text-danger">
        {customer.error instanceof ApiError ? customer.error.message : 'Customer not found'}
      </p>
    )
  }
  const currentPrices = new Map(
    customer.data.prices.map((price) => [price.equipmentItemId, price.unitPriceCents]),
  )

  return (
    <div>
      <Link to="/customers" className="text-sm font-medium text-primary hover:underline">
        ← Customers
      </Link>
      <div className="mt-5 grid gap-8 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Customer</p>
              <h1 className="mt-1 text-3xl font-semibold">{customer.data.name}</h1>
            </div>
            <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold capitalize text-primary-strong">
              {customer.data.type}
            </span>
          </div>
          <form
            className="mt-7 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              update.mutate({
                name: String(form.get('name') ?? ''),
                email: String(form.get('email') ?? ''),
                phone: String(form.get('phone') ?? ''),
                address: String(form.get('address') ?? ''),
              })
            }}
          >
            <EditField label="Name" name="name" defaultValue={customer.data.name} required />
            <EditField label="Email" name="email" type="email" defaultValue={customer.data.email ?? ''} />
            <EditField label="Phone" name="phone" defaultValue={customer.data.phone ?? ''} />
            <EditField label="Address" name="address" defaultValue={customer.data.address ?? ''} />
            {update.error && <MutationError error={update.error} />}
            <button type="submit" disabled={update.isPending} className="button-secondary">
              {update.isPending ? 'Saving…' : 'Save customer'}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Customer special prices</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Select only negotiated exceptions. Unselected items use their equipment standard price.
          </p>
          {items.isPending ? (
            <p className="mt-6 text-muted-foreground">Loading equipment…</p>
          ) : (
            <SpecialPriceForm
              key={customer.data.updatedAt}
              items={items.data ?? []}
              currentPrices={currentPrices}
              requirePrice={customer.data.type !== 'recurring'}
              pending={savePrices.isPending}
              error={savePrices.error}
              onSave={(prices) => savePrices.mutate(prices)}
            />
          )}
        </section>
      </div>
    </div>
  )
}

function SpecialPriceForm({ items, currentPrices, requirePrice, pending, error, onSave }: {
  items: EquipmentItem[]
  currentPrices: Map<string, number>
  requirePrice: boolean
  pending: boolean
  error: Error | null
  onSave: (prices: Array<{ equipmentItemId: string; unitPriceCents: number }>) => void
}) {
  const [prices, setPrices] = useState(() => [...currentPrices].map(
    ([equipmentItemId, unitPriceCents]) => ({
      equipmentItemId,
      value: (unitPriceCents / 100).toFixed(2),
    }),
  ))
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const selectedIds = new Set(prices.map((price) => price.equipmentItemId))

  function parsePrices(candidatePrices: typeof prices) {
    const parsedPrices: Array<{ equipmentItemId: string; unitPriceCents: number }> = []
    for (const price of candidatePrices) {
      const unitPriceCents = parseMajorCurrencyToMinorUnits(price.value)
      if (unitPriceCents === null) {
        const itemName = items.find((item) => item.id === price.equipmentItemId)?.name ?? 'equipment'
        setSelectionError(`Enter a valid special price for ${itemName} with no more than two decimal places.`)
        return null
      }
      parsedPrices.push({ equipmentItemId: price.equipmentItemId, unitPriceCents })
    }
    setSelectionError(null)
    return parsedPrices
  }

  return <form className="mt-6 space-y-3" onSubmit={(event) => {
    event.preventDefault()
    if (requirePrice && prices.length === 0) {
      setSelectionError('Add at least one customer-specific price to make this customer recurring.')
      return
    }
    const parsedPrices = parsePrices(prices)
    if (!parsedPrices) return
    onSave(parsedPrices)
  }}>
    <SearchableSelect
      aria-label="Equipment for special price"
      value=""
      disabled={pending}
      placeholder="Select equipment to add"
      options={items.map((item) => ({
        value: item.id,
        label: item.name,
        disabled: selectedIds.has(item.id),
      }))}
      onChange={(equipmentItemId) => {
        const item = items.find((entry) => entry.id === equipmentItemId)
        if (!item) return
        setPrices((current) => [...current, {
          equipmentItemId: item.id,
          value: (item.currentUnitPriceCents / 100).toFixed(2),
        }])
        setSelectionError(null)
      }}
    />
    {prices.length === 0 && <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">No exceptions selected. Add only equipment with a negotiated customer price.</p>}
    {prices.map((price) => {
      const item = items.find((entry) => entry.id === price.equipmentItemId)
      if (!item) return null
      return <div key={item.id} className="grid grid-cols-[1fr_9rem_auto] items-center gap-3 rounded-lg border border-border p-3 text-sm">
        <span><span className="font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">Standard {formatMoney(item.currentUnitPriceCents)}</span></span>
        <input aria-label={`${item.name} special price in LKR`} className="input" inputMode="decimal" min="0.01" step="0.01" type="number" value={price.value} onChange={(event) => {
          const value = event.currentTarget.value
          setSelectionError(null)
          setPrices((current) => current.map((entry) => entry.equipmentItemId === item.id ? { ...entry, value } : entry))
        }} />
        <button aria-label={`Remove ${item.name} special price`} className="text-xs font-medium text-danger hover:underline" disabled={pending} type="button" onClick={() => {
          const remainingPrices = prices.filter((entry) => entry.equipmentItemId !== item.id)
          setPrices(remainingPrices)
          if (!requirePrice) {
            const parsedPrices = parsePrices(remainingPrices)
            if (parsedPrices) onSave(parsedPrices)
          }
        }}>Remove</button>
      </div>
    })}
    {selectionError && <p role="alert" className="text-sm text-danger">{selectionError}</p>}
    {error && <MutationError error={error} />}
    <button type="submit" disabled={pending} className="button-primary w-full">{pending ? 'Saving prices...' : 'Save special prices'}</button>
  </form>
}

function EditField({
  label,
  name,
  defaultValue,
  type = 'text',
  required = false,
}: {
  label: string
  name: string
  defaultValue: string
  type?: string
  required?: boolean
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input className="input mt-2" name={name} type={type} defaultValue={defaultValue} required={required} />
    </label>
  )
}

function MutationError({ error }: { error: Error }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {error instanceof ApiError ? error.message : 'Unable to save changes'}
    </p>
  )
}
