import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ApiError, type StockMovement } from '../../api'
import { stockMovementsQuery, stockQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/stock')({ component: StockPage })

const integerFormatter = new Intl.NumberFormat('en-LK')
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Colombo',
})

function formatCurrency(valueCents: number) {
  return `LKR ${integerFormatter.format(Math.round(valueCents / 100))}`
}

function StockPage() {
  const stock = useQuery(stockQuery)
  const movements = useQuery(stockMovementsQuery)
  const totals = stock.data?.reduce(
    (result, item) => ({
      valueCents: result.valueCents + item.valueCents,
      inStore: result.inStore + Math.max(item.quantity, 0),
      onRent: result.onRent + item.onRentQuantity,
      belowReorder: result.belowReorder + Number(item.isBelowReorderThreshold),
    }),
    { valueCents: 0, inStore: 0, onRent: 0, belowReorder: 0 },
  )

  return (
    <section aria-labelledby="stock-ledger-title">
      <header>
        <h1 id="stock-ledger-title">Stock Ledger</h1>
        <p className="mt-1 text-sm text-[#60727e]">
          Updated only from approved delivery and retention notes
        </p>
      </header>

      <dl className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total stock value" value={totals ? formatCurrency(totals.valueCents) : '—'} />
        <MetricCard label="Units in store" value={totals ? integerFormatter.format(totals.inStore) : '—'} />
        <MetricCard
          label="Units on rent"
          value={totals ? integerFormatter.format(totals.onRent) : '—'}
          valueClassName="text-[#d99620]"
        />
        <MetricCard
          label="Below reorder level"
          value={totals ? integerFormatter.format(totals.belowReorder) : '—'}
          valueClassName={totals?.belowReorder ? 'text-danger' : 'text-[#159563]'}
        />
      </dl>

      <section className="mt-5 overflow-hidden rounded-xl border border-[#d6e0e2] bg-white" aria-labelledby="stock-by-item-title">
        <div className="border-b border-[#d6e0e2] px-5 py-4">
          <h2 id="stock-by-item-title" className="text-[#10252a]">Stock by item</h2>
        </div>

        {stock.isPending && (
          <p aria-live="polite" className="px-5 py-8 text-[#60727e]">Loading stock…</p>
        )}
        {stock.error && (
          <p role="alert" className="px-5 py-8 text-danger">
            {stock.error instanceof ApiError ? stock.error.message : 'Unable to load stock'}
          </p>
        )}
        {stock.data && stock.data.length === 0 && (
          <p className="px-5 py-8 text-[#60727e]">No stock items are available.</p>
        )}
        {stock.data && stock.data.length > 0 && (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[920px] text-left">
              <caption className="sr-only">Current stock quantities and values by equipment item</caption>
              <thead>
                <tr className="border-b border-[#dce5e6]">
                  <th className="w-[24%] py-4 pr-5">Item</th>
                  <th className="w-[16%] px-3 py-4">Category</th>
                  <th className="w-[14%] px-3 py-4 text-right">Unit price</th>
                  <th className="w-[10%] px-3 py-4 text-right">In store</th>
                  <th className="w-[10%] px-3 py-4 text-right">On rent</th>
                  <th className="w-[12%] px-3 py-4 text-right">Reorder at</th>
                  <th className="w-[14%] py-4 pl-3 text-right">Stock value</th>
                </tr>
              </thead>
              <tbody>
                {stock.data.map((item) => (
                  <tr key={item.equipmentItemId} className="border-b border-[#e1e8e9] last:border-0">
                    <td className="py-4 pr-5">
                      <p className="font-semibold text-[#071c23]">{item.equipmentName}</p>
                      <p className="mt-0.5 text-xs text-[#587080]">
                        {item.unitOfMeasure}
                        {item.isBelowReorderThreshold && (
                          <span className="ml-2 font-semibold text-danger">Reorder</span>
                        )}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-[#526977]">{item.category}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-[#071c23]">
                      {formatCurrency(item.currentUnitPriceCents)}
                    </td>
                    <td className={`px-3 py-4 text-right tabular-nums ${item.isBelowReorderThreshold ? 'font-semibold text-danger' : 'text-[#071c23]'}`}>
                      {integerFormatter.format(item.quantity)}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-[#071c23]">
                      {integerFormatter.format(item.onRentQuantity)}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-[#071c23]">
                      {item.reorderThreshold === null ? '—' : integerFormatter.format(item.reorderThreshold)}
                    </td>
                    <td className="py-4 pl-3 text-right font-medium tabular-nums text-[#071c23]">
                      {formatCurrency(item.valueCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 overflow-hidden rounded-xl border border-[#d6e0e2] bg-white" aria-labelledby="recent-movements-title">
        <div className="border-b border-[#d6e0e2] px-5 py-4">
          <h2 id="recent-movements-title" className="text-[#10252a]">Recent stock movements</h2>
          <p className="mt-0.5 text-xs text-[#60727e]">
            Every movement traces back to an approved source document
          </p>
        </div>

        {movements.isPending && (
          <p aria-live="polite" className="px-5 py-8 text-[#60727e]">Loading recent movements…</p>
        )}
        {movements.error && (
          <p role="alert" className="px-5 py-8 text-danger">
            {movements.error instanceof ApiError
              ? movements.error.message
              : 'Unable to load recent stock movements'}
          </p>
        )}
        {movements.data && movements.data.length === 0 && (
          <p className="px-5 py-8 text-[#60727e]">No approved stock movements yet.</p>
        )}
        {movements.data && movements.data.length > 0 && (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[700px] text-left">
              <caption className="sr-only">Five most recent approved stock movements</caption>
              <thead>
                <tr className="border-b border-[#dce5e6]">
                  <th className="w-[22%] py-4 pr-4">Date</th>
                  <th className="w-[18%] px-3 py-4">Source</th>
                  <th className="w-[31%] px-3 py-4">Item</th>
                  <th className="w-[18%] px-3 py-4">Type</th>
                  <th className="w-[11%] py-4 pl-3 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {movements.data.map((movement) => (
                  <tr key={movement.id} className="border-b border-[#e1e8e9] last:border-0">
                    <td className="py-3.5 pr-4 tabular-nums text-[#526977]">
                      {dateFormatter.format(new Date(movement.createdAt))}
                    </td>
                    <td className="px-3 py-3.5 font-medium text-[#071c23]">{movement.source}</td>
                    <td className="px-3 py-3.5 text-[#071c23]">{movement.equipmentName}</td>
                    <td className="px-3 py-3.5"><MovementBadge movement={movement} /></td>
                    <td className="py-3.5 pl-3 text-right font-medium tabular-nums text-[#071c23]">
                      {movement.quantityDelta > 0 ? '+' : ''}{integerFormatter.format(movement.quantityDelta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}

function MetricCard({
  label,
  value,
  valueClassName = 'text-[#071c23]',
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="min-h-28 rounded-xl border border-[#d6e0e2] bg-white px-5 py-5">
      <dt className="text-xs font-medium uppercase tracking-[0.025em] text-[#415867]">{label}</dt>
      <dd className={`mt-3 text-2xl font-medium leading-none tabular-nums ${valueClassName}`}>{value}</dd>
    </div>
  )
}

function MovementBadge({ movement }: { movement: StockMovement }) {
  const presentation = movement.direction === 'write_off'
    ? { label: 'Write-off', className: 'bg-[#fce5e5] text-[#d52b2b]' }
    : movement.direction === 'out'
      ? { label: 'Stock out', className: 'bg-[#d9f2f3] text-[#087a7d]' }
      : { label: 'Stock in', className: 'bg-[#e2f3ea] text-[#158653]' }

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold leading-none ${presentation.className}`}>
      {presentation.label}
    </span>
  )
}
