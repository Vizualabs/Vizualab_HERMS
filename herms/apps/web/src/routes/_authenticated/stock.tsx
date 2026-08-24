import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ApiError, formatMoney } from '../../api'
import { stockQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/stock')({ component: StockPage })

function StockPage() {
  const stock = useQuery(stockQuery)
  return <section><p className="text-sm font-semibold uppercase tracking-widest text-primary">Append-only ledger</p><h1 className="mt-2 text-3xl font-semibold">Current stock</h1><p className="mt-2 text-muted-foreground">Derived only from approved stock movements.</p><div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-muted-foreground"><th className="px-5 py-4">Equipment</th><th>Quantity</th><th className="text-right">Current value</th></tr></thead><tbody>{stock.data?.map((item) => <tr key={item.equipmentItemId} className="border-b border-border"><td className="px-5 py-4 font-medium">{item.equipmentName}</td><td>{item.quantity} {item.unitOfMeasure}</td><td className="px-5 text-right font-mono">{formatMoney(item.valueCents)}</td></tr>)}</tbody></table>{stock.isPending && <p className="p-6 text-muted-foreground">Loading stock...</p>}{stock.error && <p role="alert" className="p-6 text-danger">{stock.error instanceof ApiError ? stock.error.message : 'Unable to load stock'}</p>}</div></section>
}
