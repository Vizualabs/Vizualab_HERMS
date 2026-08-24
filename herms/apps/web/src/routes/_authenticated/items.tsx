import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api, formatMinorUnits } from '../../api'
import { itemsQuery, queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/items')({ component: ItemsPage })

function ItemsPage() {
  const items = useQuery(itemsQuery)
  const queryClient = useQueryClient()
  const createItem = useMutation({
    mutationFn: api.createItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.items })
    },
  })

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <section>
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Master data</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Equipment</h1>
        <p className="mt-2 text-muted-foreground">
          Current prices are cached here; immutable history remains the source of truth.
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
                  <span className="font-mono text-sm font-semibold">
                    {formatMinorUnits(item.currentUnitPriceCents)}
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
            const form = new FormData(event.currentTarget)
            createItem.mutate({
              name: String(form.get('name') ?? ''),
              category: String(form.get('category') ?? ''),
              unitOfMeasure: String(form.get('unitOfMeasure') ?? 'unit'),
              currentUnitPriceCents: Number(form.get('currentUnitPriceCents')),
              reorderThreshold: null,
            })
          }}
        >
          <ItemField label="Name" name="name" required />
          <ItemField label="Category" name="category" required />
          <ItemField label="Unit of measure" name="unitOfMeasure" defaultValue="unit" required />
          <ItemField label="Opening price (minor units)" name="currentUnitPriceCents" type="number" required />
          {createItem.error && (
            <p role="alert" className="text-sm text-danger">
              {createItem.error instanceof ApiError ? createItem.error.message : 'Unable to create equipment'}
            </p>
          )}
          <button type="submit" disabled={createItem.isPending} className="button-primary w-full">
            {createItem.isPending ? 'Creating…' : 'Create equipment'}
          </button>
        </form>
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
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
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
        required={required}
        defaultValue={defaultValue}
      />
    </label>
  )
}
