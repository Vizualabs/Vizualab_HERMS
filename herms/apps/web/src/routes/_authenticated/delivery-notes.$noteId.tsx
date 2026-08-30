import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api } from '../../api'
import { queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/delivery-notes/$noteId')({
  component: DeliveryNotePage,
})

function DeliveryNotePage() {
  const { noteId } = Route.useParams()
  const [link, setLink] = useState<string | null>(null)
  const note = useQuery(queryOptions({
    queryKey: queryKeys.deliveryNote(noteId),
    queryFn: () => api.deliveryNote(noteId),
  }))
  const getLink = useMutation({
    mutationFn: () => api.deliveryNoteLink(noteId),
    onSuccess: (result) => setLink(result.submissionLink),
  })
  const regenerate = useMutation({
    mutationFn: () => api.regenerateDeliveryNoteLink(noteId),
    onSuccess: (result) => setLink(result.submissionLink),
  })

  if (note.isPending) return <p className="text-muted-foreground">Loading delivery note...</p>
  if (!note.data) {
    return <p role="alert" className="text-danger">
      {note.error instanceof ApiError ? note.error.message : 'Delivery note not found'}
    </p>
  }

  const data = note.data
  const error = getLink.error || regenerate.error
  return <div>
    <Link to="/orders/$orderId" params={{ orderId: data.orderId }} className="text-sm font-medium text-primary hover:underline">
      Back to order
    </Link>
    <section className="mt-5 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Delivery note</p>
          <h1 className="mt-1 text-3xl font-semibold">{data.dnNumber}</h1>
          <p className="mt-2 text-muted-foreground">{data.customerName} / {data.orderNumber}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold capitalize text-primary-strong">
            {data.status.replaceAll('_', ' ')}
          </span>
          <a className="button-secondary" href={`/api/delivery-notes/${noteId}/pdf`}>
            Download PDF
          </a>
        </div>
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="py-3">Item</th><th>Issued</th><th>Handed over</th><th>Counted</th>
          </tr></thead>
          <tbody>{data.lines.map((line) => <tr key={line.id} className="border-b border-border">
            <td className="py-4 font-medium">{line.equipmentName}</td>
            <td>{line.issuedQty}</td>
            <td>{line.handedOverQty}</td>
            <td>{line.countedQty ?? '-'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {data.status !== 'approved' && <div className="mt-6 flex flex-wrap gap-3">
        <button className="button-secondary" disabled={getLink.isPending} onClick={() => getLink.mutate()}>
          Get submission link
        </button>
        <button className="button-secondary" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
          Revoke and regenerate
        </button>
        {link && <button className="button-primary" onClick={() => navigator.clipboard.writeText(link)}>
          Copy link
        </button>}
      </div>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">
        {error instanceof ApiError ? error.message : 'Unable to manage delivery link'}
      </p>}
    </section>
  </div>
}
