import { useQueries, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import {
  ApiError,
  api,
  formatMoney,
  type DeliveryNoteSummary,
  type OrderSummary,
  type RetentionNoteSummary,
} from '../../api'
import { ordersQuery, queryKeys, sessionQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/orders')({ component: OrdersPage })

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Colombo',
})

const activityFormatter = new Intl.DateTimeFormat('en-LK', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
})

function OrdersPage() {
  const orders = useQuery(ordersQuery)
  const session = useQuery(sessionQuery)
  const [openingNote, setOpeningNote] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const canManageNotes = session.data?.role === 'sales' || session.data?.role === 'super_user'
  const canViewBalances = canManageNotes || session.data?.role === 'finance'
  const rows = orders.data ?? []

  const deliveryNotes = useQueries({
    queries: rows.map((order) => ({
      queryKey: queryKeys.deliveryNotes(order.id),
      queryFn: () => api.deliveryNotes(order.id),
      enabled: canManageNotes,
      staleTime: 10_000,
    })),
  })
  const retentionNotes = useQueries({
    queries: rows.map((order) => ({
      queryKey: queryKeys.retentionNotes(order.id),
      queryFn: () => api.retentionNotes(order.id),
      enabled: canManageNotes,
      staleTime: 10_000,
    })),
  })
  const invoices = useQueries({
    queries: rows.map((order) => ({
      queryKey: queryKeys.invoice(order.id),
      queryFn: () => api.invoice(order.id),
      enabled: canViewBalances,
      staleTime: 10_000,
    })),
  })

  const allDeliveryNotes = deliveryNotes.flatMap((query) => query.data ?? [])
  const allRetentionNotes = retentionNotes.flatMap((query) => query.data ?? [])
  const activeOrders = rows.filter((order) => order.status === 'open')
  const awaitingDelivery = rows.filter((order, index) =>
    order.status === 'open'
    && !(deliveryNotes[index]?.data ?? []).some((note) => note.status === 'approved'))
  const notesInField = [...allDeliveryNotes, ...allRetentionNotes]
    .filter((note) => note.status === 'draft' || note.status === 'reopened')
  const openOrderValue = activeOrders.reduce((total, order) => total + order.totalValueCents, 0)
  const ordersById = new Map(rows.map((order) => [order.id, order]))
  const recentActivity = [
    ...allDeliveryNotes.map((note) => ({ ...note, kind: 'delivery' as const })),
    ...allRetentionNotes.map((note) => ({ ...note, kind: 'retention' as const })),
  ].sort((left, right) => noteTime(right) - noteTime(left)).slice(0, 6)

  const openNote = async (
    order: OrderSummary,
    type: 'delivery' | 'retention',
    notes: DeliveryNoteSummary[] | RetentionNoteSummary[],
  ) => {
    setOpenError(null)
    const actionable = notes.find((note) =>
      note.status === 'draft' || note.status === 'reopened' || note.status === 'pending_approval')

    if (!actionable) {
      if (order.status === 'open') {
        window.location.assign(`/orders/${order.id}#create-${type}-note`)
      } else if (notes[0]) {
        window.location.assign(`/${type === 'delivery' ? 'delivery' : 'retention'}-notes/${notes[0].id}`)
      }
      return
    }

    const actionKey = `${type}-${actionable.id}`
    setOpeningNote(actionKey)
    try {
      const result = type === 'delivery'
        ? await api.deliveryNoteLink(actionable.id)
        : await api.retentionNoteLink(actionable.id)
      window.location.assign(result.submissionLink)
    } catch (error) {
      setOpenError(error instanceof ApiError ? error.message : `Unable to open the ${type} note`)
      setOpeningNote(null)
    }
  }

  const notesLoading = canManageNotes
    && (deliveryNotes.some((query) => query.isPending) || retentionNotes.some((query) => query.isPending))
  const supportingError = [
    ...deliveryNotes.map((query) => query.error),
    ...retentionNotes.map((query) => query.error),
    ...invoices.map((query) => query.error),
  ].find(Boolean)

  return (
    <section aria-labelledby="orders-title">
      <header>
        <h1 id="orders-title">Orders &amp; Notes</h1>
        <p className="mt-1 text-sm text-[#60727e]">
          Delivery and retention notes are completed by field staff via a time-bound link
        </p>
      </header>

      <dl className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Active orders" value={orders.isPending ? undefined : activeOrders.length} />
        <SummaryCard
          label="Awaiting delivery"
          value={orders.isPending || notesLoading || supportingError ? undefined : awaitingDelivery.length}
          valueClassName="text-[#d99620]"
        />
        <SummaryCard
          label="Notes in field"
          value={orders.isPending || notesLoading || supportingError ? undefined : notesInField.length}
          description="Links sent, not yet submitted"
        />
        <SummaryCard
          label="Order value (open)"
          value={orders.isPending ? undefined : formatMoney(openOrderValue)}
        />
      </dl>

      {(orders.error || openError || supportingError) && (
        <p role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger-soft px-5 py-4 text-danger">
          {openError
            ?? (orders.error instanceof ApiError ? orders.error.message : null)
            ?? (supportingError instanceof ApiError ? supportingError.message : 'Unable to load all order details')}
        </p>
      )}

      <section className="mt-5 overflow-hidden rounded-xl border border-[#d6e0e2] bg-white" aria-labelledby="orders-table-title">
        <h2 id="orders-table-title" className="border-b border-[#d6e0e2] px-5 py-4 text-[#071c23]">Orders</h2>
        {orders.isPending && <p className="px-5 py-8 text-[#60727e]">Loading orders…</p>}
        {orders.data?.length === 0 && <p className="px-5 py-8 text-[#60727e]">No orders have been created.</p>}
        {orders.data && orders.data.length > 0 && (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[1040px] text-left">
              <thead>
                <tr className="border-b border-[#d6e0e2]">
                  <th className="py-4 pr-4">Order</th>
                  <th className="px-3 py-4">Customer</th>
                  <th className="px-3 py-4">Order date</th>
                  <th className="px-3 py-4">Status</th>
                  <th className="px-3 py-4 text-right">Value</th>
                  <th className="px-3 py-4 text-right">Balance</th>
                  <th className="py-4 pl-3 text-right">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order, index) => {
                  const delivery = deliveryNotes[index]?.data ?? []
                  const retention = retentionNotes[index]?.data ?? []
                  const status = displayStatus(order, delivery, retention)
                  const balance = invoices[index]?.data?.outstandingBalanceCents
                  const deliveryOpening = delivery.some((note) => openingNote === `delivery-${note.id}`)
                  const retentionOpening = retention.some((note) => openingNote === `retention-${note.id}`)
                  const deliveryLoading = canManageNotes && deliveryNotes[index]?.isPending
                  const retentionLoading = canManageNotes && retentionNotes[index]?.isPending
                  return (
                    <tr key={order.id} className="border-b border-[#e1e8e9] last:border-0">
                      <td className="py-3.5 pr-4">
                        <Link
                          to="/orders/$orderId"
                          params={{ orderId: order.id }}
                          className="font-semibold text-[#071c23] hover:text-[#078486] hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                        <span className="mt-0.5 block text-xs text-[#60727e]">
                          {order.quotationId ? 'from accepted quotation' : 'Direct order'}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-[#071c23]">{order.customerName}</td>
                      <td className="px-3 py-3.5 tabular-nums text-[#526977]">
                        {dateFormatter.format(new Date(order.createdAt))}
                      </td>
                      <td className="px-3 py-3.5"><OrderStatusBadge status={status} /></td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-[#071c23]">
                        {formatMoney(order.totalValueCents)}
                      </td>
                      <td className={`px-3 py-3.5 text-right tabular-nums ${balance ? 'text-[#df2f2f]' : 'text-[#60727e]'}`}>
                        {canViewBalances && invoices[index]?.isPending ? '…' : balance === undefined ? '—' : balance === 0 ? '—' : formatMoney(balance)}
                      </td>
                      <td className="py-3.5 pl-3">
                        <div className="flex justify-end gap-2">
                          <NoteButton
                            label={deliveryLoading ? 'Loading…' : deliveryOpening ? 'Opening…' : 'Delivery note'}
                            disabled={!canManageNotes || deliveryLoading || deliveryOpening || (order.status !== 'open' && delivery.length === 0)}
                            onClick={() => openNote(order, 'delivery', delivery)}
                          />
                          <NoteButton
                            label={retentionLoading ? 'Loading…' : retentionOpening ? 'Opening…' : 'Retention note'}
                            disabled={!canManageNotes || retentionLoading || retentionOpening || (order.status !== 'open' && retention.length === 0)}
                            onClick={() => openNote(order, 'retention', retention)}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManageNotes && (
        <section className="mt-5 overflow-hidden rounded-xl border border-[#d6e0e2] bg-white" aria-labelledby="recent-note-title">
          <div className="border-b border-[#d6e0e2] px-5 py-4">
            <h2 id="recent-note-title" className="text-[#071c23]">Recent note activity</h2>
            <p className="mt-0.5 text-xs text-[#526977]">
              Submitted notes move to the store admin approval queue before stock changes
            </p>
          </div>
          <div className="space-y-3 p-5">
            {notesLoading && <p className="text-[#60727e]">Loading note activity…</p>}
            {!notesLoading && recentActivity.length === 0 && <p className="text-[#60727e]">No note activity yet.</p>}
            {recentActivity.map((note) => {
              const order = ordersById.get(note.orderId)
              const number = note.kind === 'delivery' ? note.dnNumber : note.rnNumber
              const noteLabel = note.kind === 'delivery' ? 'Delivery Note' : 'Retention Note'
              return (
                <article key={`${note.kind}-${note.id}`} className="flex flex-col gap-3 rounded-lg border border-[#d6e0e2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 text-[#526977]">
                    <span className="font-semibold text-[#071c23]">{number}</span>
                    {' · '}{noteLabel}{' · '}{order?.orderNumber ?? 'Order'}{' · '}{order?.customerName ?? 'Customer'}
                  </p>
                  <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs text-[#526977]">
                    <span>Field staff</span>
                    <time dateTime={(note.submittedAt ?? note.createdAt).toString()}>
                      {activityFormatter.format(new Date(note.submittedAt ?? note.createdAt))}
                    </time>
                    <NoteStatusBadge status={note.status} />
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}
    </section>
  )
}

function SummaryCard({
  label,
  value,
  valueClassName = 'text-[#071c23]',
  description,
}: {
  label: string
  value: string | number | undefined
  valueClassName?: string
  description?: string
}) {
  return (
    <div className="min-h-32 rounded-xl border border-[#d6e0e2] bg-white px-5 py-5">
      <dt className="text-xs font-medium uppercase tracking-[0.025em] text-[#415867]">{label}</dt>
      <dd className={`mt-4 text-2xl font-medium leading-none tabular-nums ${valueClassName}`}>{value ?? '—'}</dd>
      {description && <p className="mt-2 text-xs text-[#526977]">{description}</p>}
    </div>
  )
}

function NoteButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="min-h-10 whitespace-nowrap rounded-lg border border-[#d6e0e2] bg-white px-4 text-xs font-semibold text-[#071c23] shadow-sm transition-colors hover:bg-[#f4f8f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#078486] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

type DisplayStatus = 'awaiting_delivery' | 'delivered' | 'partially_returned' | 'closed' | 'cancelled'

function displayStatus(
  order: OrderSummary,
  delivery: DeliveryNoteSummary[],
  retention: RetentionNoteSummary[],
): DisplayStatus {
  if (order.status === 'fully_returned') return 'closed'
  if (order.status === 'cancelled') return 'cancelled'
  if (retention.some((note) => note.status === 'approved')) return 'partially_returned'
  if (delivery.some((note) => note.status === 'approved')) return 'delivered'
  return 'awaiting_delivery'
}

function OrderStatusBadge({ status }: { status: DisplayStatus }) {
  const styles = status === 'closed'
    ? 'bg-[#e2f3ea] text-[#158653]'
    : status === 'cancelled'
      ? 'bg-[#fce5e5] text-[#df2f2f]'
    : status === 'delivered'
      ? 'bg-[#d9f2f3] text-[#087a7d]'
      : 'bg-[#faecd5] text-[#8c5700]'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold leading-none ${styles}`}>
      {status.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase())}
    </span>
  )
}

function NoteStatusBadge({ status }: { status: DeliveryNoteSummary['status'] }) {
  const pending = status === 'pending_approval'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold leading-none ${
      pending ? 'bg-[#faecd5] text-[#8c5700]' : 'bg-[#d9f2f3] text-[#087a7d]'
    }`}>
      {status.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase())}
    </span>
  )
}

function noteTime(note: { submittedAt: string | null; createdAt: string }) {
  return new Date(note.submittedAt ?? note.createdAt).getTime()
}
