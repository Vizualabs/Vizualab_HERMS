import type { ManualPriceChangeReason } from '@herms/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api, formatMinorUnits } from '../../api'
import { parseMajorCurrencyToMinorUnits } from '../../money'
import { queryKeys, sessionQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/items_/$itemId')({
  component: ItemDetailPage,
})

function ItemDetailPage() {
  const { itemId } = Route.useParams()
  const queryClient = useQueryClient()
  const session = useQuery(sessionQuery)
  const canChangePrice = session.data?.role === 'business_owner'
    || session.data?.role === 'sales'
    || session.data?.role === 'super_user'
  const canAddStock = session.data?.role === 'business_owner'
    || session.data?.role === 'sales'
    || session.data?.role === 'system_admin'
    || session.data?.role === 'super_user'
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
    mutationFn: (input: { name: string; category: string; unitOfMeasure: string; reorderThreshold: number | null }) =>
      api.updateItem(itemId, input),
    onSuccess: invalidateItem,
  })
  const changePrice = useMutation({
    mutationFn: (input: { newPriceCents: number; reason: ManualPriceChangeReason }) =>
      api.changePrice(itemId, input.newPriceCents, input.reason),
    onSuccess: invalidateItem,
  })
  const addStock = useMutation({
    mutationFn: (quantity: number) => api.addItemStock(itemId, quantity),
    onSuccess: invalidateItem,
  })

  async function invalidateItem() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.item(itemId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.priceHistory(itemId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.items }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stock }),
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
      queryClient.invalidateQueries({ queryKey: queryKeys.approvalMetrics }),
      queryClient.invalidateQueries({ queryKey: queryKeys.orders }),
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
              LKR {formatMinorUnits(item.data.currentUnitPriceCents)}
            </p>
            <p className="text-xs text-muted-foreground">current unit price</p>
            <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6">
              <StockTotal label="Available now" value={item.data.currentStockQty} />
              <StockTotal label="Opening stock" value={item.data.openingStockQty} />
              <StockTotal label="Total stock received" value={item.data.totalReceivedQty} />
              <StockTotal label="Awaiting approval" value={item.data.pendingReceiptQty} />
            </dl>
            <form
              className="mt-7 space-y-4 border-t border-border pt-6"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                const reorderThreshold = String(form.get('reorderThreshold') ?? '').trim()
                update.mutate({
                  name: String(form.get('name') ?? ''),
                  category: String(form.get('category') ?? ''),
                  unitOfMeasure: String(form.get('unitOfMeasure') ?? ''),
                  reorderThreshold: reorderThreshold === '' ? null : Number(reorderThreshold),
                })
              }}
            >
              <h2 className="text-lg font-semibold">Edit equipment details</h2>
              <Edit label="Name" name="name" defaultValue={item.data.name} />
              <Edit label="Category" name="category" defaultValue={item.data.category} />
              <Edit label="Unit" name="unitOfMeasure" defaultValue={item.data.unitOfMeasure} />
              <Edit
                label="Reorder threshold (optional)"
                name="reorderThreshold"
                type="number"
                defaultValue={item.data.reorderThreshold === null ? '' : String(item.data.reorderThreshold)}
                required={false}
              />
              {update.error && <ErrorText error={update.error} />}
              {update.data && (
                <p role="status" className="text-sm font-medium text-primary-strong">
                  Equipment details saved.
                </p>
              )}
              <button type="submit" disabled={update.isPending} className="button-secondary w-full">
                {update.isPending ? 'Saving…' : 'Save equipment'}
              </button>
            </form>
          </div>

          {canAddStock && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Add equipment stock</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Register newly received units here. The quantity is added to available stock
                immediately without an approval step.
              </p>
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  addStock.mutate(Number(form.get('stockAdditionQuantity')))
                }}
              >
                <Edit
                  label="New units received"
                  name="stockAdditionQuantity"
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  placeholder="150"
                  defaultValue=""
                />
                {addStock.error && <ErrorText error={addStock.error} />}
                {addStock.data && (
                  <p role="status" className="text-sm font-medium text-primary-strong">
                    Added {addStock.data.quantity} units successfully. Available stock is now updated.
                  </p>
                )}
                <button type="submit" disabled={addStock.isPending} className="button-primary w-full">
                  {addStock.isPending ? 'Adding stock...' : 'Add stock'}
                </button>
              </form>
            </div>
          )}

          {canChangePrice && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Change price</h2>
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  const priceInput = event.currentTarget.elements.namedItem('newPrice')
                  if (!(priceInput instanceof HTMLInputElement)) return
                  const newPriceCents = parseMajorCurrencyToMinorUnits(priceInput.value)
                  if (newPriceCents === null) {
                    priceInput.setCustomValidity('Enter a valid price with no more than two decimal places.')
                    priceInput.reportValidity()
                    return
                  }
                  priceInput.setCustomValidity('')
                  changePrice.mutate({
                    newPriceCents,
                    reason: String(form.get('reason')) as ManualPriceChangeReason,
                  })
                }}
              >
                <Edit
                  label="New price (LKR)"
                  name="newPrice"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="500.00"
                  defaultValue={(item.data.currentUnitPriceCents / 100).toFixed(2)}
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
                    <span className="font-semibold">LKR {formatMinorUnits(entry.newPriceCents)}</span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {entry.reason.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.oldPriceCents === null
                      ? 'Opening price'
                      : `Changed from LKR ${formatMinorUnits(entry.oldPriceCents)}`}{' '}
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

function StockTotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold">{value}</dd>
    </div>
  )
}

function Edit({
  label,
  name,
  defaultValue,
  type = 'text',
  required = true,
  min,
  max,
  step,
  placeholder,
}: {
  label: string
  name: string
  defaultValue: string
  type?: string
  required?: boolean
  min?: string
  max?: string
  step?: string
  placeholder?: string
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        className="input mt-2"
        name={name}
        type={type}
        min={min ?? (type === 'number' ? '0' : undefined)}
        max={max}
        step={step ?? (type === 'number' ? '1' : undefined)}
        inputMode={type === 'number' ? (step === '0.01' ? 'decimal' : 'numeric') : undefined}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
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
