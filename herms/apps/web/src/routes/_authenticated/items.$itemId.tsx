import type { ManualPriceChangeReason } from '@herms/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api, formatMinorUnits } from '../../api'
import { queryKeys, sessionQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/items/$itemId')({
  component: ItemDetailPage,
})

function ItemDetailPage() {
  const { itemId } = Route.useParams()
  const queryClient = useQueryClient()
  const session = useQuery(sessionQuery)
  const canChangePrice = session.data?.role === 'business_owner' || session.data?.role === 'sales'
  const item = useQuery(
    queryOptions({ queryKey: queryKeys.item(itemId), queryFn: () => api.item(itemId) }),
  )
  const history = useQuery(
    queryOptions({
      queryKey: queryKeys.priceHistory(itemId),
      queryFn: () => api.priceHistory(itemId),
      enabled: canChangePrice,
    }),
  )
  const update = useMutation({
    mutationFn: (input: { name: string; category: string; unitOfMeasure: string }) =>
      api.updateItem(itemId, input),
    onSuccess: invalidateItem,
  })
  const changePrice = useMutation({
    mutationFn: (input: { newPriceCents: number; reason: ManualPriceChangeReason }) =>
      api.changePrice(itemId, input.newPriceCents, input.reason),
    onSuccess: invalidateItem,
  })

  async function invalidateItem() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.item(itemId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.priceHistory(itemId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.items }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ])
  }

  if (item.isPending) return <p className="text-muted-foreground">Loading equipment…</p>
  if (!item.data) {
    return (
      <p role="alert" className="text-danger">
        {item.error instanceof ApiError ? item.error.message : 'Equipment item not found'}
      </p>
    )
  }

  return (
    <div>
      <Link to="/items" className="text-sm font-medium text-primary hover:underline">
        ← Equipment
      </Link>
      <div className="mt-5 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">{item.data.category}</p>
            <h1 className="mt-1 text-3xl font-semibold">{item.data.name}</h1>
            <p className="mt-4 font-mono text-2xl font-semibold text-primary-strong">
              {formatMinorUnits(item.data.currentUnitPriceCents)}
            </p>
            <p className="text-xs text-muted-foreground">current unit price</p>
            <form
              className="mt-7 space-y-4 border-t border-border pt-6"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                update.mutate({
                  name: String(form.get('name') ?? ''),
                  category: String(form.get('category') ?? ''),
                  unitOfMeasure: String(form.get('unitOfMeasure') ?? ''),
                })
              }}
            >
              <Edit label="Name" name="name" defaultValue={item.data.name} />
              <Edit label="Category" name="category" defaultValue={item.data.category} />
              <Edit label="Unit" name="unitOfMeasure" defaultValue={item.data.unitOfMeasure} />
              {update.error && <ErrorText error={update.error} />}
              <button type="submit" disabled={update.isPending} className="button-secondary w-full">
                {update.isPending ? 'Saving…' : 'Save equipment'}
              </button>
            </form>
          </div>

          {canChangePrice && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Change price</h2>
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  changePrice.mutate({
                    newPriceCents: Number(form.get('newPriceCents')),
                    reason: String(form.get('reason')) as ManualPriceChangeReason,
                  })
                }}
              >
                <Edit
                  label="New price (minor units)"
                  name="newPriceCents"
                  type="number"
                  defaultValue={String(item.data.currentUnitPriceCents)}
                />
                <label className="block text-sm font-medium">
                  Reason
                  <select name="reason" className="input mt-2">
                    <option value="negotiated">Negotiated</option>
                    <option value="correction">Correction</option>
                  </select>
                </label>
                {changePrice.error && <ErrorText error={changePrice.error} />}
                <button type="submit" disabled={changePrice.isPending} className="button-primary w-full">
                  {changePrice.isPending ? 'Recording…' : 'Record price change'}
                </button>
              </form>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Immutable price history</h2>
          {!canChangePrice ? (
            <p className="mt-4 text-muted-foreground">
              Price history is restricted to Business Owner and Sales roles.
            </p>
          ) : history.isPending ? (
            <p className="mt-4 text-muted-foreground">Loading price history…</p>
          ) : (
            <ol className="mt-6 space-y-4">
              {history.data?.map((entry) => (
                <li key={entry.id} className="rounded-xl bg-muted p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold">{formatMinorUnits(entry.newPriceCents)}</span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {entry.reason.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.oldPriceCents === null
                      ? 'Opening price'
                      : `Changed from ${formatMinorUnits(entry.oldPriceCents)}`}{' '}
                    · {new Date(entry.effectiveDate).toLocaleString()}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}

function Edit({
  label,
  name,
  defaultValue,
  type = 'text',
}: {
  label: string
  name: string
  defaultValue: string
  type?: string
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        className="input mt-2"
        name={name}
        type={type}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 1 : undefined}
        defaultValue={defaultValue}
        required
      />
    </label>
  )
}

function ErrorText({ error }: { error: Error }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {error instanceof ApiError ? error.message : 'Unable to save changes'}
    </p>
  )
}
