import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMoney, type QuotationLink } from '../../api'
import { ManualLinkShare, WhatsAppShareButton } from '../../components/ManualShareActions'
import { queryKeys } from '../../queries'
import { createQuotationShareMessage } from '../../whatsapp'

export const Route = createFileRoute('/_authenticated/quotations_/$quotationId')({ component: QuotationDetailPage })

function QuotationDetailPage() {
  const { quotationId } = Route.useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [share, setShare] = useState<QuotationLink | null>(null)
  const quotation = useQuery(queryOptions({ queryKey: queryKeys.quotation(quotationId), queryFn: () => api.quotation(quotationId) }))
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.quotation(quotationId) }), queryClient.invalidateQueries({ queryKey: queryKeys.quotations })]) }
  const convert = useMutation({ mutationFn: () => api.convertQuotation(quotationId), onSuccess: async (order) => { await refresh(); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.orders }), queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })]); await navigate({ to: '/orders/$orderId', params: { orderId: order.id } }) } })
  const reject = useMutation({ mutationFn: () => api.rejectQuotation(quotationId), onSuccess: async () => { setShare(null); await refresh() } })
  const loadLink = useMutation({ mutationFn: () => api.quotationLink(quotationId), onSuccess: setShare })

  if (quotation.isPending) return <p className="text-[#60727e]">Loading quotation...</p>
  if (!quotation.data) return <p role="alert" className="text-danger">{quotation.error instanceof ApiError ? quotation.error.message : 'Quotation not found'}</p>
  const data = quotation.data
  const error = convert.error || reject.error || loadLink.error
  return <div>
    <Link to="/quotations" className="text-sm font-medium text-[#078486] hover:underline">Back to quotations</Link>
    <section className="mt-5 rounded-xl border border-[#d6e0e2] bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-wide text-[#078486]">{data.pricingMode} pricing</p><h1 className="mt-1 text-3xl font-semibold text-[#071c23]">{data.quotationNumber}</h1><p className="mt-2 text-sm text-[#526977]">{data.customerName} · expires {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : '-'}</p></div><Status value={data.status} /></div>
      <div className="mt-7 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-[#d6e0e2] text-xs uppercase tracking-wide text-[#526977]"><th className="py-3">Item</th><th>Quantity</th><th>Unit price</th><th className="text-right">Total</th></tr></thead><tbody>{data.lines.map((line) => <tr key={line.id} className="border-b border-[#e3eaec]"><td className="py-4 font-medium text-[#071c23]">{line.equipmentName}</td><td>{line.quantity} {line.unitOfMeasure}</td><td>{formatMoney(line.unitPriceCents, data.currency)}</td><td className="text-right font-medium">{formatMoney(line.lineTotalCents, data.currency)}</td></tr>)}</tbody></table></div>
      <p className="mt-5 text-right text-xl font-semibold text-[#071c23]">Total {formatMoney(data.totalValueCents, data.currency)}</p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <a className="button-secondary inline-flex items-center" href={`/api/quotations/${data.id}/pdf`}>Download PDF</a>
        <WhatsAppShareButton label="Open WhatsApp Web to share the downloaded quotation PDF" message={createQuotationShareMessage({ quotationNumber: data.quotationNumber, customerName: data.customerName })} />
        {data.status === 'sent' && <><button className="button-primary" disabled={loadLink.isPending} onClick={() => loadLink.mutate()}>{loadLink.isPending ? 'Opening...' : 'Copy / resend link'}</button><button className="button-secondary text-danger" disabled={reject.isPending} onClick={() => reject.mutate()}>Reject quotation</button></>}
        {data.status === 'accepted' && !data.orderId && <button className="button-primary" disabled={convert.isPending} onClick={() => convert.mutate()}>{convert.isPending ? 'Converting...' : 'Convert to order'}</button>}
        {data.orderId && <Link className="button-primary inline-flex" to="/orders/$orderId" params={{ orderId: data.orderId }}>View order</Link>}
      </div>
      {share && <ManualLinkShare link={share.submissionLink} label="Customer quotation link" message={createQuotationShareMessage({ quotationNumber: data.quotationNumber, customerName: data.customerName, submissionLink: share.submissionLink })} />}
      {share && <p className="mt-2 text-xs text-[#60727e]">This same link remains available until {new Date(share.expiresAt).toLocaleString()}.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error instanceof ApiError ? error.message : 'Unable to update quotation'}</p>}
    </section>
  </div>
}

function Status({ value }: { value: string }) {
  const style = value === 'accepted' ? 'bg-[#e3f3eb] text-[#219a67]' : value === 'sent' ? 'bg-[#d9f3f3] text-[#006e71]' : value === 'rejected' ? 'bg-[#fde5e5] text-[#d72b2b]' : 'bg-[#edf1f2] text-[#60727e]'
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ${style}`}>{value}</span>
}
