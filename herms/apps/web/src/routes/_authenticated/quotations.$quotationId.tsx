import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'

import { ApiError, api, formatMoney } from '../../api'
import { queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/quotations/$quotationId')({ component: QuotationDetailPage })

function QuotationDetailPage() {
  const { quotationId } = Route.useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const quotation = useQuery(queryOptions({ queryKey: queryKeys.quotation(quotationId), queryFn: () => api.quotation(quotationId) }))
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.quotation(quotationId) }), queryClient.invalidateQueries({ queryKey: queryKeys.quotations })]) }
  const accept = useMutation({ mutationFn: () => api.acceptQuotation(quotationId), onSuccess: async (order) => { await refresh(); await queryClient.invalidateQueries({ queryKey: queryKeys.orders }); await navigate({ to: '/orders/$orderId', params: { orderId: order.id } }) } })
  const reject = useMutation({ mutationFn: () => api.rejectQuotation(quotationId), onSuccess: refresh })
  const expire = useMutation({ mutationFn: () => api.expireQuotation(quotationId), onSuccess: refresh })

  if (quotation.isPending) return <p className="text-muted-foreground">Loading quotation...</p>
  if (!quotation.data) return <p role="alert" className="text-danger">{quotation.error instanceof ApiError ? quotation.error.message : 'Quotation not found'}</p>
  const data = quotation.data
  const isPastExpiry = Boolean(data.expiresAt && new Date(data.expiresAt) <= new Date())
  const error = accept.error || reject.error || expire.error
  return <div>
    <Link to="/quotations" className="text-sm font-medium text-primary hover:underline">Back to quotations</Link>
    <section className="mt-5 rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-sm text-muted-foreground">Quotation</p><h1 className="mt-1 text-3xl font-semibold">{data.quotationNumber}</h1><p className="mt-2 text-muted-foreground">{data.customerName} · expires {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : '-'}</p></div><span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold capitalize text-primary-strong">{data.status}</span></div>
      <div className="mt-7 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-3">Item</th><th>Quantity</th><th>Unit price</th><th className="text-right">Total</th></tr></thead><tbody>{data.lines.map((line) => <tr key={line.id} className="border-b border-border"><td className="py-4 font-medium">{line.equipmentName}</td><td>{line.quantity} {line.unitOfMeasure}</td><td>{formatMoney(line.unitPriceCents, data.currency)}</td><td className="text-right font-mono">{formatMoney(line.lineTotalCents, data.currency)}</td></tr>)}</tbody></table></div>
      <p className="mt-5 text-right text-xl font-semibold">Total {formatMoney(data.totalValueCents, data.currency)}</p>
      <div className="mt-7 flex flex-wrap gap-3"><a className="button-secondary" href={`/api/quotations/${data.id}/pdf`}>Download PDF</a><button className="button-secondary" onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy link</button>{data.status === 'sent' && <><button className="button-primary" disabled={accept.isPending || isPastExpiry} onClick={() => accept.mutate()}>Accept and create order</button><button className="button-secondary" disabled={reject.isPending} onClick={() => reject.mutate()}>Reject</button>{isPastExpiry && <button className="button-secondary" disabled={expire.isPending} onClick={() => expire.mutate()}>Mark expired</button>}</>}</div>
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error instanceof ApiError ? error.message : 'Unable to update quotation'}</p>}
    </section>
  </div>
}
