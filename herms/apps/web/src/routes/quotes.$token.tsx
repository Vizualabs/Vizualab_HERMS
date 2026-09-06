import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ApiError, api, formatMoney, type PublicQuotation } from '../api'

export const Route = createFileRoute('/quotes/$token')({ component: PublicQuotationPage })

function PublicQuotationPage() {
  const { token } = Route.useParams()
  const queryClient = useQueryClient()
  const key = ['public-quotation', token] as const
  const quotation = useQuery(queryOptions({ queryKey: key, queryFn: () => api.publicQuotation(token), retry: false }))
  const update = (data: PublicQuotation) => queryClient.setQueryData(key, data)
  const accept = useMutation({ mutationFn: () => api.acceptPublicQuotation(token), onSuccess: update })
  const reject = useMutation({ mutationFn: () => api.rejectPublicQuotation(token), onSuccess: update })

  if (quotation.isPending) return <PublicShell><p className="text-[#60727e]">Opening secure quotation...</p></PublicShell>
  if (!quotation.data) return <PublicShell><Unavailable message={quotation.error instanceof ApiError ? quotation.error.message : 'This quotation link is unavailable'} /></PublicShell>
  const data = quotation.data
  const error = accept.error || reject.error

  return <PublicShell>
    <header className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#078486]">Quotation</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#071c23]">{data.quotationNumber} · {data.customerName}</h1>
      <p className="mt-2 text-sm text-[#526977]">Secure link · {expiryLabel(data.tokenExpiresAt)}</p>
    </header>

    <section className="overflow-hidden rounded-xl border border-[#d6e0e2] bg-white">
      <div className="border-b border-[#d6e0e2] px-5 py-4"><div className="flex items-center justify-between gap-4"><h2 className="font-semibold text-[#071c23]">Quotation details</h2><Status value={data.status} /></div></div>
      <div className="overflow-x-auto px-5"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b border-[#d6e0e2] text-xs uppercase tracking-wide text-[#526977]"><th className="py-3">Item</th><th>Quantity</th><th>Unit price</th><th className="text-right">Total</th></tr></thead><tbody>{data.lines.map((line, index) => <tr key={`${line.equipmentName}-${index}`} className="border-b border-[#e3eaec]"><td className="py-4 font-medium text-[#071c23]">{line.equipmentName}</td><td>{line.quantity} {line.unitOfMeasure}</td><td>{formatMoney(line.unitPriceCents, data.currency)}</td><td className="text-right font-medium">{formatMoney(line.lineTotalCents, data.currency)}</td></tr>)}</tbody></table></div>
      <p className="px-5 py-5 text-right text-xl font-semibold text-[#071c23]">Total {formatMoney(data.totalValueCents, data.currency)}</p>
    </section>

    {data.status === 'sent' && <section className="mt-4 rounded-xl border border-[#d6e0e2] bg-white p-5"><h2 className="font-semibold text-[#071c23]">Your response</h2><p className="mt-1 text-sm leading-6 text-[#526977]">Accept this quotation to allow the HERMS team to create your order, or reject it to close the quotation.</p><div className="mt-4 flex flex-wrap gap-3"><button className="button-primary" disabled={accept.isPending || reject.isPending} onClick={() => accept.mutate()}>{accept.isPending ? 'Accepting...' : 'Accept quotation'}</button><button className="button-secondary" disabled={accept.isPending || reject.isPending} onClick={() => reject.mutate()}>{reject.isPending ? 'Rejecting...' : 'Reject quotation'}</button></div></section>}

    {data.status === 'accepted' && <section className="mt-4 rounded-xl border border-[#bfe4d2] bg-[#e8f5ee] p-5"><h2 className="font-semibold text-[#167b52]">Quotation accepted</h2><p className="mt-1 text-sm leading-6 text-[#42675a]">The HERMS team can now convert this quotation into an order.</p>{data.order ? <div className="mt-4 rounded-lg border border-[#bfe4d2] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#526977]">Order created</p><p className="mt-1 font-semibold text-[#071c23]">{data.order.orderNumber}</p><p className="mt-1 text-sm capitalize text-[#526977]">Status: {data.order.status.replace('_', ' ')}</p></div> : <button className="button-secondary mt-4" type="button" onClick={() => quotation.refetch()}>Check order status</button>}</section>}
    {data.status === 'rejected' && <section className="mt-4 rounded-xl border border-[#f3c9c9] bg-[#fdecec] p-5"><h2 className="font-semibold text-[#b72424]">Quotation rejected</h2><p className="mt-1 text-sm text-[#7a4545]">This link has been closed and cannot be used again.</p></section>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-[#f3c9c9] bg-[#fdecec] p-4 text-sm text-[#b72424]">{error instanceof ApiError ? error.message : 'Unable to save your response'}</p>}
    <p className="mt-5 text-center text-xs text-[#60727e]">No login required · this secure link is time-bound.</p>
  </PublicShell>
}

function PublicShell({ children }: { children: React.ReactNode }) { return <main className="mx-auto min-h-screen w-full max-w-[720px] px-5 py-8 sm:py-10">{children}</main> }
function Unavailable({ message }: { message: string }) { return <section className="rounded-xl border border-[#f3c9c9] bg-white p-6"><h1 className="text-xl font-semibold text-[#071c23]">Quotation unavailable</h1><p role="alert" className="mt-2 text-sm text-[#b72424]">{message}</p></section> }
function Status({ value }: { value: PublicQuotation['status'] }) { const style = value === 'accepted' ? 'bg-[#e3f3eb] text-[#167b52]' : value === 'sent' ? 'bg-[#d9f3f3] text-[#006e71]' : value === 'rejected' ? 'bg-[#fde5e5] text-[#b72424]' : 'bg-[#edf1f2] text-[#60727e]'; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${style}`}>{value}</span> }
function expiryLabel(value: string) { const minutes = Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 60_000)); return minutes > 0 ? `expires in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : 'expired' }
