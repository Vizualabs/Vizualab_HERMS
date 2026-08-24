import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api, formatMinorUnits } from '../../api'
import { itemsQuery, queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/customers/$customerId')({
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
  const setRecurring = useMutation({
    mutationFn: (prices: Array<{ equipmentItemId: string; unitPriceCents: number }>) =>
      api.setRecurring(customerId, { prices }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.customer(customerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers }),
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
          <h2 className="text-xl font-semibold">Fixed price list</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Saving this list marks the customer Recurring and versions all current fixed prices.
          </p>
          {items.isPending ? (
            <p className="mt-6 text-muted-foreground">Loading equipment…</p>
          ) : (
            <form
              className="mt-6 space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                setRecurring.mutate(
                  (items.data ?? []).map((item) => ({
                    equipmentItemId: item.id,
                    unitPriceCents: Number(form.get(item.id)),
                  })),
                )
              }}
            >
              {(items.data ?? []).map((item) => (
                <label key={item.id} className="grid grid-cols-[1fr_9rem] items-center gap-4 text-sm">
                  <span>
                    <span className="font-medium">{item.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      Current {formatMinorUnits(item.currentUnitPriceCents)}
                    </span>
                  </span>
                  <input
                    className="input"
                    name={item.id}
                    type="number"
                    min="0"
                    step="1"
                    required
                    aria-label={`${item.name} fixed price in minor units`}
                    defaultValue={currentPrices.get(item.id) ?? item.currentUnitPriceCents}
                  />
                </label>
              ))}
              {setRecurring.error && <MutationError error={setRecurring.error} />}
              <button type="submit" disabled={setRecurring.isPending} className="button-primary w-full">
                {setRecurring.isPending ? 'Saving prices…' : 'Save recurring price list'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  )
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
