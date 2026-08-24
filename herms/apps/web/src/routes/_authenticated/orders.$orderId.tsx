import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMoney } from '../../api'
import { queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/orders/$orderId')({ component: OrderDetailPage })

function OrderDetailPage() {
  const { orderId } = Route.useParams()
  const queryClient = useQueryClient()
  const [newLink, setNewLink] = useState<string | null>(null)
  const order = useQuery(queryOptions({ queryKey: queryKeys.order(orderId), queryFn: () => api.order(orderId) }))
  const notes = useQuery(queryOptions({ queryKey: queryKeys.deliveryNotes(orderId), queryFn: () => api.deliveryNotes(orderId) }))
  const createNote = useMutation({
    mutationFn: (lines: Array<{ equipmentItemId: string; issuedQty: number }>) => api.createDeliveryNote(orderId, { lines }),
    onSuccess: async (note) => {
      setNewLink(note.submissionLink ?? null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.deliveryNotes(orderId) })
    },
  })
  if (order.isPending) return <p className="text-muted-foreground">Loading order...</p>
  if (!order.data) return <p role="alert" className="text-danger">{order.error instanceof ApiError ? order.error.message : 'Order not found'}</p>
  const data = order.data
  return <div>
    <Link to="/orders" className="text-sm font-medium text-primary hover:underline">Back to orders</Link>
    <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-5"><div><p className="text-sm text-muted-foreground">Order</p><h1 className="mt-1 text-3xl font-semibold">{data.orderNumber}</h1><p className="mt-2 text-muted-foreground">{data.customerName}</p></div><span className="rounded-full bg-success-soft px-3 py-1 text-sm font-semibold capitalize text-primary-strong">{data.status.replaceAll('_', ' ')}</span></div>
        <div className="mt-7 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-3">Item</th><th>Quantity</th><th>Unit price</th><th className="text-right">Total</th></tr></thead><tbody>{data.lines.map((line) => <tr key={line.id} className="border-b border-border"><td className="py-4 font-medium">{line.equipmentName}</td><td>{line.quantity} {line.unitOfMeasure}</td><td>{formatMoney(line.unitPriceCents, data.currency)}</td><td className="text-right font-mono">{formatMoney(line.lineTotalCents, data.currency)}</td></tr>)}</tbody></table></div>
        <p className="mt-5 text-right text-xl font-semibold">Total {formatMoney(data.totalValueCents, data.currency)}</p>
      </section>
      <aside className="h-fit rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Create delivery note</h2>
        <p className="mt-2 text-sm text-muted-foreground">Enter the quantity issued now. Use zero to omit an item from this partial delivery.</p>
        <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); createNote.mutate(data.lines.map((line) => ({ equipmentItemId: line.equipmentItemId, issuedQty: Number(form.get(line.equipmentItemId)) })).filter((line) => line.issuedQty > 0)) }}>
          {data.lines.map((line) => <label key={line.id} className="grid grid-cols-[1fr_6rem] items-center gap-3 text-sm"><span>{line.equipmentName}<span className="block text-xs text-muted-foreground">Ordered {line.quantity}</span></span><input className="input" name={line.equipmentItemId} type="number" min="0" max={line.quantity} step="1" defaultValue={line.quantity} /></label>)}
          <button className="button-primary w-full text-sm" disabled={createNote.isPending || data.status !== 'open'}>{createNote.isPending ? 'Creating...' : 'Create delivery note'}</button>
        </form>
        <h3 className="mt-6 font-semibold">Existing notes</h3>
        {newLink && <div className="mt-4 rounded-xl bg-primary-soft p-3"><p className="text-xs font-semibold text-primary-strong">Submission link created</p><button className="mt-2 text-sm font-medium text-primary-strong underline" onClick={() => navigator.clipboard.writeText(newLink)}>Copy secure link</button></div>}
        {createNote.error && <p role="alert" className="mt-3 text-sm text-danger">{createNote.error instanceof ApiError ? createNote.error.message : 'Unable to create delivery note'}</p>}
        <ul className="mt-2 divide-y divide-border">{notes.data?.map((note) => <li key={note.id} className="py-3"><Link to="/delivery-notes/$noteId" params={{ noteId: note.id }} className="font-medium text-primary hover:underline">{note.dnNumber}</Link><p className="mt-1 text-xs capitalize text-muted-foreground">{note.status.replaceAll('_', ' ')}</p></li>)}</ul>
        {notes.data?.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No delivery notes yet.</p>}
      </aside>
    </div>
  </div>
}
