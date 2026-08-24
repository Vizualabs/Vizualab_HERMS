import { queryOptions, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api, formatMoney } from '../../api'
import { queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/orders/$orderId')({ component: OrderDetailPage })

function OrderDetailPage() {
  const { orderId } = Route.useParams()
  const order = useQuery(queryOptions({ queryKey: queryKeys.order(orderId), queryFn: () => api.order(orderId) }))
  if (order.isPending) return <p className="text-muted-foreground">Loading order...</p>
  if (!order.data) return <p role="alert" className="text-danger">{order.error instanceof ApiError ? order.error.message : 'Order not found'}</p>
  const data = order.data
  return <div><Link to="/orders" className="text-sm font-medium text-primary hover:underline">Back to orders</Link><section className="mt-5 rounded-2xl border border-border bg-card p-6"><div className="flex items-start justify-between gap-5"><div><p className="text-sm text-muted-foreground">Order</p><h1 className="mt-1 text-3xl font-semibold">{data.orderNumber}</h1><p className="mt-2 text-muted-foreground">{data.customerName}</p></div><span className="rounded-full bg-success-soft px-3 py-1 text-sm font-semibold capitalize text-primary-strong">{data.status.replaceAll('_', ' ')}</span></div><div className="mt-7 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-3">Item</th><th>Quantity</th><th>Unit price</th><th className="text-right">Total</th></tr></thead><tbody>{data.lines.map((line) => <tr key={line.id} className="border-b border-border"><td className="py-4 font-medium">{line.equipmentName}</td><td>{line.quantity} {line.unitOfMeasure}</td><td>{formatMoney(line.unitPriceCents, data.currency)}</td><td className="text-right font-mono">{formatMoney(line.lineTotalCents, data.currency)}</td></tr>)}</tbody></table></div><p className="mt-5 text-right text-xl font-semibold">Total {formatMoney(data.totalValueCents, data.currency)}</p>{data.quotationId && <Link to="/quotations/$quotationId" params={{ quotationId: data.quotationId }} className="mt-6 inline-block text-sm font-medium text-primary hover:underline">View source quotation</Link>}</section></div>
}
