import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, formatMoney } from '../../api'
import { ordersQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/orders')({ component: OrdersPage })

function OrdersPage() {
  const orders = useQuery(ordersQuery)
  return <section><p className="text-sm font-semibold uppercase tracking-widest text-primary">Sales</p><h1 className="mt-2 text-3xl font-semibold">Orders</h1><p className="mt-2 text-muted-foreground">Orders converted verbatim from accepted quotations.</p><div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">{orders.isPending && <p className="p-6 text-muted-foreground">Loading orders...</p>}{orders.error && <p role="alert" className="p-6 text-danger">{orders.error instanceof ApiError ? orders.error.message : 'Unable to load orders'}</p>}{orders.data?.length === 0 && <p className="p-6 text-muted-foreground">No orders have been created.</p>}<ul className="divide-y divide-border">{orders.data?.map((order) => <li key={order.id}><Link to="/orders/$orderId" params={{ orderId: order.id }} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted"><div><p className="font-semibold">{order.orderNumber}</p><p className="mt-1 text-sm text-muted-foreground">{order.customerName}</p></div><div className="text-right"><p className="font-mono text-sm font-semibold">{formatMoney(order.totalValueCents)}</p><p className="mt-1 text-xs capitalize text-primary-strong">{order.status.replaceAll('_', ' ')}</p></div></Link></li>)}</ul></div></section>
}
