import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api } from '../../api'
import { useConfirm } from '../../components/ConfirmDialog'
import { ManualLinkShare } from '../../components/ManualShareActions'
import { queryKeys } from '../../queries'
import { createNoteShareMessage } from '../../whatsapp'

export const Route = createFileRoute('/_authenticated/retention-notes/$noteId')({
  component: RetentionNotePage,
})

function RetentionNotePage() {
  const { noteId } = Route.useParams()
  const confirm = useConfirm()
  const [link, setLink] = useState<string | null>(null)
  const note = useQuery(queryOptions({
    queryKey: queryKeys.retentionNote(noteId),
    queryFn: () => api.retentionNote(noteId),
  }))
  const getLink = useMutation({
    mutationFn: () => api.retentionNoteLink(noteId),
    onSuccess: (result) => setLink(result.submissionLink),
  })
  const regenerate = useMutation({
    mutationFn: () => api.regenerateRetentionNoteLink(noteId),
    onSuccess: (result) => setLink(result.submissionLink),
  })
  if (note.isPending) return <p className="text-muted-foreground">Loading retention note...</p>
  if (!note.data) {
    return <p role="alert" className="text-danger">
      {note.error instanceof ApiError ? note.error.message : 'Retention note not found'}
    </p>
  }
  const data = note.data
  const submissionLink = link ?? data.submissionLink ?? null
  const error = getLink.error || regenerate.error
  const hasPhysicalCount = data.lines.some((line) => line.countedReturnedQty !== null)
  const canManageLink = ['draft', 'reopened', 'pending_approval'].includes(data.status)
    && !hasPhysicalCount
  return <div>
    <Link to="/orders/$orderId" params={{ orderId: data.orderId }} className="text-sm font-medium text-primary hover:underline">
      Back to order
    </Link>
    <section className="mt-5 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Retention note</p>
          <h1 className="mt-1 text-3xl font-semibold">{data.rnNumber}</h1>
          <p className="mt-2 text-muted-foreground">{data.customerName} · {data.orderNumber}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold capitalize text-primary-strong">
            {data.status.replaceAll('_', ' ')}
          </span>
          <a className="button-secondary" href={`/api/retention-notes/${noteId}/pdf`}>
            Download PDF
          </a>
        </div>
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="py-3">Item</th><th>Delivered</th><th>Returned</th><th>Balance</th><th>Missing / damaged</th><th>Counted</th>
          </tr></thead>
          <tbody>{data.lines.map((line) => <tr key={line.id} className="border-b border-border">
            <td className="py-4 font-medium">{line.equipmentName}</td>
            <td>{line.deliveredQty}</td>
            <td>{line.returnedQty}</td>
            <td>{line.balanceQty}</td>
            <td>{line.missingDamagedQty}</td>
            <td>{line.countedReturnedQty ?? '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {canManageLink && <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="button-secondary" disabled={getLink.isPending || regenerate.isPending} onClick={() => getLink.mutate()}>
          Get submission link
        </button>
        <button type="button" className="button-secondary" disabled={getLink.isPending || regenerate.isPending} onClick={() => {
          void confirm({
            title: 'Replace the field link?',
            message: 'Replace the current field link? The old link will stop working immediately.',
            confirmLabel: 'Replace link',
            tone: 'danger',
          }).then((ok) => { if (ok) regenerate.mutate() })
        }}>
          Replace field link
        </button>
      </div>}
      {!canManageLink && data.status === 'rejected' && <p className="mt-6 text-sm text-muted-foreground">
        This note was rejected. A Store Admin must reopen it before a new field link can be shared.
      </p>}
      {!canManageLink && data.status === 'pending_approval' && hasPhysicalCount && <p className="mt-6 text-sm text-muted-foreground">
        Physical counting has started, so field corrections and replacement links are closed.
      </p>}
      {canManageLink && submissionLink && <ManualLinkShare
        label="Retention submission link"
        link={submissionLink}
        message={createNoteShareMessage({
          noteType: 'Retention',
          noteNumber: data.rnNumber,
          orderNumber: data.orderNumber,
          customerName: data.customerName,
          submissionLink,
        })}
      />}
      {error && <p role="alert" className="mt-4 text-sm text-danger">
        {error instanceof ApiError ? error.message : 'Unable to manage return link'}
      </p>}
    </section>
  </div>
}
