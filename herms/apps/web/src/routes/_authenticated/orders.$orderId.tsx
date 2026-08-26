import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, formatMoney } from '../../api'
import { queryKeys, sessionQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/orders/$orderId')({
  component: OrderDetailPage,
})

function OrderDetailPage() {
  const { orderId } = Route.useParams()
  const queryClient = useQueryClient()
  const [newLink, setNewLink] = useState<{ type: 'delivery' | 'return'; url: string } | null>(null)
  const session = useQuery(sessionQuery)
  const canUseSales = session.data?.role === 'sales'
  const canClose = session.data?.role === 'store_admin'
  const order = useQuery(queryOptions({
    queryKey: queryKeys.order(orderId),
    queryFn: () => api.order(orderId),
  }))
  const deliveryNotes = useQuery({
    queryKey: queryKeys.deliveryNotes(orderId),
    queryFn: () => api.deliveryNotes(orderId),
    enabled: canUseSales,
  })
  const retentionNotes = useQuery({
    queryKey: queryKeys.retentionNotes(orderId),
    queryFn: () => api.retentionNotes(orderId),
    enabled: canUseSales,
  })
  const fieldStaff = useQuery({
    queryKey: queryKeys.fieldStaffRecipients,
    queryFn: api.fieldStaffRecipients,
    enabled: canUseSales,
    staleTime: 30_000,
  })
  const createDelivery = useMutation({
    mutationFn: (input: {
      fieldStaffUserId: string
      lines: Array<{ equipmentItemId: string; issuedQty: number }>
    }) => api.createDeliveryNote(orderId, input),
    onSuccess: async (note) => {
      if (note.submissionLink) setNewLink({ type: 'delivery', url: note.submissionLink })
      await queryClient.invalidateQueries({ queryKey: queryKeys.deliveryNotes(orderId) })
    },
  })
  const createRetention = useMutation({
    mutationFn: (input: { fieldStaffUserId: string; equipmentItemIds: string[] }) =>
      api.createRetentionNote(orderId, {
        fieldStaffUserId: input.fieldStaffUserId,
        lines: input.equipmentItemIds.map((equipmentItemId) => ({ equipmentItemId })),
      }),
    onSuccess: async (note) => {
      if (note.submissionLink) setNewLink({ type: 'return', url: note.submissionLink })
      await queryClient.invalidateQueries({ queryKey: queryKeys.retentionNotes(orderId) })
    },
  })
  const close = useMutation({
    mutationFn: () => api.closeOrder(orderId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.order(orderId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.orders }),
      ])
    },
  })

  if (order.isPending) return <p className="text-muted-foreground">Loading order...</p>
  if (!order.data) {
    return <p role="alert" className="text-danger">
      {order.error instanceof ApiError ? order.error.message : 'Order not found'}
    </p>
  }
  const data = order.data
  const mutationError = createDelivery.error || createRetention.error || close.error
  return <div>
    <Link to="/orders" className="text-sm font-medium text-primary hover:underline">Back to orders</Link>
    <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-sm text-muted-foreground">Order</p>
            <h1 className="mt-1 text-3xl font-semibold">{data.orderNumber}</h1>
            <p className="mt-2 text-muted-foreground">{data.customerName}</p>
          </div>
          <span className="rounded-full bg-success-soft px-3 py-1 text-sm font-semibold capitalize text-primary-strong">
            {data.status.replaceAll('_', ' ')}
          </span>
        </div>
        <div className="mt-7 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-border text-muted-foreground">
              <th className="py-3">Item</th><th>Quantity</th><th>Unit price</th><th className="text-right">Total</th>
            </tr></thead>
            <tbody>{data.lines.map((line) => <tr key={line.id} className="border-b border-border">
              <td className="py-4 font-medium">{line.equipmentName}</td>
              <td>{line.quantity} {line.unitOfMeasure}</td>
              <td>{formatMoney(line.unitPriceCents, data.currency)}</td>
              <td className="text-right font-mono">{formatMoney(line.lineTotalCents, data.currency)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-5 text-right text-xl font-semibold">
          Total {formatMoney(data.totalValueCents, data.currency)}
        </p>

        {canClose && <div className="mt-8 rounded-2xl border border-border bg-muted p-5">
          <h2 className="text-lg font-semibold">Close reconciled order</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Closing succeeds only when approved returns, balances, and missing/damaged quantities exactly equal every approved delivered quantity.
          </p>
          <button className="button-primary mt-4" disabled={close.isPending || data.status !== 'open'} onClick={() => close.mutate()}>
            {close.isPending ? 'Checking reconciliation...' : 'Mark Fully Returned'}
          </button>
          {close.data && <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th>Item</th><th>Delivered</th><th>Returned</th><th>Balance</th><th>Missing / damaged</th></tr></thead>
              <tbody>{close.data.reconciliation.map((line) => <tr key={line.equipmentItemId}>
                <td className="py-2 font-medium">{line.equipmentName}</td>
                <td>{line.deliveredQty}</td><td>{line.returnedQty}</td><td>{line.balanceQty}</td><td>{line.missingDamagedQty}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </div>}
      </section>

      {canUseSales && <aside className="flex h-fit flex-col gap-6">
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Create delivery note</h2>
          <p className="mt-2 text-sm text-muted-foreground">Enter the quantity issued now. Use zero to omit an item.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            createDelivery.mutate({
              fieldStaffUserId: String(form.get('deliveryFieldStaffUserId')),
              lines: data.lines
                .map((line) => ({
                  equipmentItemId: line.equipmentItemId,
                  issuedQty: Number(form.get(`delivery-${line.equipmentItemId}`)),
                }))
                .filter((line) => line.issuedQty > 0),
            })
          }}>
            <label className={'flex flex-col gap-2 text-sm font-medium'}>
              Field staff recipient
              <select className={'input'} name={'deliveryFieldStaffUserId'} required defaultValue={''}>
                <option value={''} disabled>Select field staff</option>
                {fieldStaff.data?.map((recipient) => <option key={recipient.id} value={recipient.id}>
                  {recipient.name} - {recipient.phoneMasked}
                </option>)}
              </select>
            </label>
            {data.lines.map((line) => <label key={line.id} className="grid grid-cols-[1fr_6rem] items-center gap-3 text-sm">
              <span>{line.equipmentName}<span className="block text-xs text-muted-foreground">Ordered {line.quantity}</span></span>
              <input className="input" name={`delivery-${line.equipmentItemId}`} type="number" min="0" max={line.quantity} step="1" defaultValue={line.quantity} />
            </label>)}
            <button className="button-primary w-full text-sm" disabled={createDelivery.isPending || data.status !== 'open'}>
              {createDelivery.isPending ? 'Creating...' : 'Create delivery note'}
            </button>
          </form>
          <h3 className="mt-6 font-semibold">Delivery notes</h3>
          <ul className="mt-2 divide-y divide-border">
            {deliveryNotes.data?.map((note) => <li key={note.id} className="py-3">
              <Link to="/delivery-notes/$noteId" params={{ noteId: note.id }} className="font-medium text-primary hover:underline">
                {note.dnNumber}
              </Link>
              <p className="mt-1 text-xs capitalize text-muted-foreground">{note.status.replaceAll('_', ' ')}</p>
            </li>)}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Create retention note</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Select items already delivered. The secure return form records returned, balance, and shortfall quantities.
          </p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            createRetention.mutate({
              fieldStaffUserId: String(form.get('retentionFieldStaffUserId')),
              equipmentItemIds: data.lines
                .filter((line) => form.get(`retention-${line.equipmentItemId}`) === 'on')
                .map((line) => line.equipmentItemId),
            })
          }}>
            <label className={'flex flex-col gap-2 text-sm font-medium'}>
              Field staff recipient
              <select className={'input'} name={'retentionFieldStaffUserId'} required defaultValue={''}>
                <option value={''} disabled>Select field staff</option>
                {fieldStaff.data?.map((recipient) => <option key={recipient.id} value={recipient.id}>
                  {recipient.name} - {recipient.phoneMasked}
                </option>)}
              </select>
            </label>
            {data.lines.map((line) => <label key={line.id} className="flex items-center gap-3 text-sm">
              <input name={`retention-${line.equipmentItemId}`} type="checkbox" defaultChecked />
              <span>{line.equipmentName}</span>
            </label>)}
            <button className="button-primary w-full text-sm" disabled={createRetention.isPending || data.status !== 'open'}>
              {createRetention.isPending ? 'Creating...' : 'Create retention note'}
            </button>
          </form>
          <h3 className="mt-6 font-semibold">Retention notes</h3>
          <ul className="mt-2 divide-y divide-border">
            {retentionNotes.data?.map((note) => <li key={note.id} className="py-3">
              <Link to="/retention-notes/$noteId" params={{ noteId: note.id }} className="font-medium text-primary hover:underline">
                {note.rnNumber}
              </Link>
              <p className="mt-1 text-xs capitalize text-muted-foreground">{note.status.replaceAll('_', ' ')}</p>
            </li>)}
          </ul>
        </section>

        {newLink && <section className="rounded-2xl bg-primary-soft p-4">
          <p className="text-xs font-semibold text-primary-strong">
            {newLink.type === 'return' ? 'Return' : 'Delivery'} submission link created
          </p>
          <button className="mt-2 text-sm font-medium text-primary-strong underline" onClick={() => navigator.clipboard.writeText(newLink.url)}>
            Copy secure link
          </button>
        </section>}
        {fieldStaff.isSuccess && fieldStaff.data.length === 0 && <p role={'alert'} className={'text-sm text-danger'}>
          Add an active field staff user with a WhatsApp phone number before creating a note.
        </p>}
      </aside>}
    </div>
    {mutationError && <p role="alert" className="mt-4 text-sm text-danger">
      {mutationError instanceof ApiError ? mutationError.message : 'Unable to update order'}
    </p>}
  </div>
}
