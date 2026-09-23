import { formatEscalationPercent, parseOwnerEscalationPercent } from '@herms/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMinorUnits } from '../../api'
import { useConfirm } from '../../components/ConfirmDialog'
import { parseMajorCurrencyToMinorUnits } from '../../money'
import {
  itemsQuery,
  priceEscalationQuery,
  queryKeys,
  sessionQuery,
} from '../../queries'

export const Route = createFileRoute('/_authenticated/items')({ component: ItemsPage })

function ItemsPage() {
  const items = useQuery(itemsQuery)
  const session = useQuery(sessionQuery)
  const confirm = useConfirm()
  const isOwner = session.data?.role === 'business_owner' || session.data?.role === 'super_user'
  const [percentInput, setPercentInput] = useState('')
  const percent = parseOwnerEscalationPercent(percentInput)
  const percentLabel = percent === null ? null : formatEscalationPercent(percent)
  const escalation = useQuery({
    ...priceEscalationQuery(percent ?? 0),
    enabled: isOwner && percent !== null,
  })
  const queryClient = useQueryClient()
  const createItem = useMutation({
    mutationFn: api.createItem,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stock }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ])
    },
  })
  const applyEscalation = useMutation({
    mutationFn: api.applyPriceEscalation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.priceEscalation }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ])
    },
  })

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <section>
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Master data</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Equipment</h1>
        <p className="mt-2 text-muted-foreground">
          Enter prices in LKR. Select any equipment item to edit its details or change its price.
        </p>
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          {items.isPending && <p className="p-6 text-muted-foreground">Loading equipment…</p>}
          {items.error && (
            <p role="alert" className="p-6 text-danger">
              {items.error instanceof ApiError ? items.error.message : 'Unable to load equipment'}
            </p>
          )}
          <ul className="divide-y divide-border">
            {items.data?.map((item) => (
              <li key={item.id}>
                <Link
                  to="/items/$itemId"
                  params={{ itemId: item.id }}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.category} · {item.unitOfMeasure}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-sm font-semibold">
                      LKR {formatMinorUnits(item.currentUnitPriceCents)}
                    </span>
                    <span className="text-xs font-medium text-primary">Edit details</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <aside className="h-fit rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Add equipment</h2>
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const formElement = event.currentTarget
            const form = new FormData(formElement)
            const priceInput = formElement.elements.namedItem('currentUnitPrice')
            const purchasePriceInput = formElement.elements.namedItem('purchasePrice')
            if (!(priceInput instanceof HTMLInputElement) || !(purchasePriceInput instanceof HTMLInputElement)) return
            const currentUnitPriceCents = parseMajorCurrencyToMinorUnits(priceInput.value)
            if (currentUnitPriceCents === null) {
              priceInput.setCustomValidity('Enter a valid price with no more than two decimal places.')
              priceInput.reportValidity()
              return
            }
            priceInput.setCustomValidity('')
            const purchasePriceCents = parseMajorCurrencyToMinorUnits(purchasePriceInput.value)
            if (purchasePriceCents === null) {
              purchasePriceInput.setCustomValidity('Enter a valid price with no more than two decimal places.')
              purchasePriceInput.reportValidity()
              return
            }
            purchasePriceInput.setCustomValidity('')
            const reorderThreshold = String(form.get('reorderThreshold') ?? '').trim()
            const openingQuantity = Number(form.get('openingQuantity'))
            createItem.mutate({
              name: String(form.get('name') ?? ''),
              category: String(form.get('category') ?? ''),
              unitOfMeasure: String(form.get('unitOfMeasure') ?? 'unit'),
              currentUnitPriceCents,
              purchasePriceCents,
              reorderThreshold: reorderThreshold === '' ? null : Number(reorderThreshold),
              openingQuantity,
            }, {
              onSuccess: () => formElement.reset(),
            })
          }}
        >
          <ItemField label="Name" name="name" required />
          <ItemField label="Category" name="category" required />
          <ItemField label="Unit of measure" name="unitOfMeasure" defaultValue="unit" required />
          <ItemField
            label="Opening price (LKR)"
            name="currentUnitPrice"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="500.00"
            required
          />
          <ItemField
            label="Purchase price (LKR)"
            name="purchasePrice"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="350.00"
            required
          />
          <ItemField label="Reorder threshold (optional)" name="reorderThreshold" type="number" />
          <ItemField
            label="Opening quantity"
            name="openingQuantity"
            type="number"
            defaultValue="0"
            max="1000000"
            required
          />
          <p className="text-xs text-muted-foreground">
            Opening quantity is added to available stock immediately. Administrators are
            alerted when stock drops below the reorder threshold.
          </p>
          {createItem.error && (
            <p role="alert" className="text-sm text-danger">
              {createItem.error instanceof ApiError ? createItem.error.message : 'Unable to create equipment'}
            </p>
          )}
          {createItem.data && (
            <p role="status" className="text-sm font-medium text-primary-strong">
              {createItem.data.openingBalanceStatus
                ? `Equipment created with ${createItem.data.openingQuantity} units available in stock.`
                : 'Equipment created with zero opening stock.'}
            </p>
          )}
          <button type="submit" disabled={createItem.isPending} className="button-primary w-full">
            {createItem.isPending ? 'Creating…' : 'Create equipment'}
          </button>
        </form>
        {isOwner && (
          <section className="mt-6 border-t border-border pt-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Owner control
            </p>
            <h2 className="mt-2 text-lg font-semibold">Increase all catalogue prices</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the increase you want, review the new prices, then apply. The change takes
              effect immediately and is permanently recorded in price history.
            </p>
            <label className="mt-4 block text-sm font-medium" htmlFor="owner-price-increase-percent">
              Increase by (%)
              <input
                id="owner-price-increase-percent"
                className="input mt-2"
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                inputMode="decimal"
                placeholder="15"
                value={percentInput}
                onChange={(event) => {
                  setPercentInput(event.target.value)
                  applyEscalation.reset()
                }}
              />
            </label>
            {escalation.isPending && percent !== null && (
              <p className="mt-4 text-sm text-muted-foreground">Checking equipment prices...</p>
            )}
            {percent === null && percentInput.trim() !== '' && (
              <p role="alert" className="mt-4 text-sm text-danger">
                Enter a percent between 0.01 and 100, with at most two decimal places.
              </p>
            )}
            {escalation.data && percentLabel && (
              <div className="mt-4 space-y-3">
                <p className="rounded-xl bg-muted p-3 text-sm">
                  {escalation.data.length} equipment price
                  {escalation.data.length === 1 ? '' : 's'} will increase by {percentLabel}%.
                </p>
                {escalation.data.length > 0 && (
                  <ul className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-border p-3 text-sm">
                    {escalation.data.map((row) => (
                      <li key={row.itemId} className="flex items-baseline justify-between gap-3">
                        <span className="truncate">{row.itemName}</span>
                        <span className="shrink-0 font-mono text-xs">
                          LKR {formatMinorUnits(row.oldPriceCents)} → {formatMinorUnits(row.newPriceCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {escalation.error && (
              <p role="alert" className="mt-4 text-sm text-danger">
                {escalation.error instanceof ApiError
                  ? escalation.error.message
                  : 'Unable to preview the price increase'}
              </p>
            )}
            {applyEscalation.data && !applyEscalation.data.replayed && (
              <p role="status" className="mt-4 text-sm font-medium text-primary-strong">
                Increased {applyEscalation.data.items.length} equipment prices successfully.
              </p>
            )}
            {applyEscalation.error && (
              <p role="alert" className="mt-4 text-sm text-danger">
                {applyEscalation.error instanceof ApiError
                  ? applyEscalation.error.message
                  : 'Unable to increase equipment prices'}
              </p>
            )}
            <button
              type="button"
              className="button-primary mt-4 w-full"
              disabled={
                applyEscalation.isPending
                || percent === null
                || !escalation.data?.length
              }
              onClick={() => {
                if (percent === null || percentLabel === null) return
                void confirm({
                  title: `Increase all prices by ${percentLabel}%?`,
                  message: `Increase all ${escalation.data?.length ?? 0} equipment prices by ${percentLabel}% now? This price-history entry cannot be removed.`,
                  confirmLabel: 'Increase prices',
                  tone: 'danger',
                }).then((ok) => { if (ok) applyEscalation.mutate(percent) })
              }}
            >
              {applyEscalation.isPending
                ? 'Increasing prices...'
                : percentLabel
                  ? `Increase prices by ${percentLabel}%`
                  : 'Increase prices'}
            </button>
          </section>
        )}
      </aside>
    </div>
  )
}

function ItemField({
  label,
  name,
  type = 'text',
  required = false,
  defaultValue,
  min,
  max,
  step,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
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
        required={required}
        defaultValue={defaultValue}
      />
    </label>
  )
}
