import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api, type DeliveryNoteDetail, type RetentionNoteDetail } from '../../api'
import { queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/approvals/$noteId')({
  component: ApprovalDetailPage,
})

function ApprovalDetailPage() {
  const { noteId } = Route.useParams()
  const client = useQueryClient()
  const note = useQuery(queryOptions({
    queryKey: queryKeys.approvalNote(noteId),
    queryFn: () => api.approvalNote(noteId),
  }))
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.approvalNote(noteId) }),
      client.invalidateQueries({ queryKey: queryKeys.approvals }),
      client.invalidateQueries({ queryKey: queryKeys.stock }),
      client.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ])
  }
  const countDelivery = useMutation({
    mutationFn: (input: Parameters<typeof api.countDeliveryNote>[1]) =>
      api.countDeliveryNote(noteId, input),
    onSuccess: refresh,
  })
  const countRetention = useMutation({
    mutationFn: (input: Parameters<typeof api.countRetentionNote>[1]) =>
      api.countRetentionNote(noteId, input),
    onSuccess: refresh,
  })
  const approve = useMutation<DeliveryNoteDetail | RetentionNoteDetail, Error, 'delivery_note' | 'retention_note'>({
    mutationFn: (noteType: 'delivery_note' | 'retention_note') =>
      noteType === 'retention_note'
        ? api.approveRetentionNote(noteId)
        : api.approveDeliveryNote(noteId),
    onSuccess: refresh,
  })
  const reject = useMutation<DeliveryNoteDetail | RetentionNoteDetail, Error, 'delivery_note' | 'retention_note'>({
    mutationFn: (noteType: 'delivery_note' | 'retention_note') =>
      noteType === 'retention_note'
        ? api.rejectRetentionNote(noteId)
        : api.rejectDeliveryNote(noteId),
    onSuccess: refresh,
  })
  const reopen = useMutation<DeliveryNoteDetail | RetentionNoteDetail, Error, 'delivery_note' | 'retention_note'>({
    mutationFn: (noteType: 'delivery_note' | 'retention_note') =>
      noteType === 'retention_note'
        ? api.reopenRetentionNote(noteId)
        : api.reopenDeliveryNote(noteId),
    onSuccess: refresh,
  })
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.reverseWriteOff(id, reason),
    onSuccess: refresh,
  })

  if (note.isPending) return <p className="text-muted-foreground">Loading note...</p>
  if (!note.data) {
    return <p role="alert" className="text-danger">
      {note.error instanceof ApiError ? note.error.message : 'Approval note not found'}
    </p>
  }
  const error = countDelivery.error || countRetention.error || approve.error
    || reject.error || reopen.error || reverse.error
  return <div>
    <Link to="/approvals" className="text-sm font-medium text-primary hover:underline">
      Back to approval queue
    </Link>
    {note.data.noteType === 'retention_note'
      ? <RetentionApproval
          note={note.data}
          countPending={countRetention.isPending}
          actionPending={approve.isPending || reject.isPending || reopen.isPending}
          reversePending={reverse.isPending}
          onCount={countRetention.mutate}
          onApprove={() => approve.mutate('retention_note')}
          onReject={() => reject.mutate('retention_note')}
          onReopen={() => reopen.mutate('retention_note')}
          onReverse={(id, reason) => reverse.mutate({ id, reason })}
        />
      : <DeliveryApproval
          note={note.data}
          countPending={countDelivery.isPending}
          actionPending={approve.isPending || reject.isPending || reopen.isPending}
          onCount={countDelivery.mutate}
          onApprove={() => approve.mutate('delivery_note')}
          onReject={() => reject.mutate('delivery_note')}
          onReopen={() => reopen.mutate('delivery_note')}
        />}
    {error && <p role="alert" className="mt-4 text-sm text-danger">
      {error instanceof ApiError ? error.message : 'Unable to update note'}
    </p>}
  </div>
}

function Header({ label, number, note }: {
  label: string
  number: string
  note: DeliveryNoteDetail | RetentionNoteDetail
}) {
  return <div className="flex items-start justify-between gap-4">
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <h1 className="mt-1 text-3xl font-semibold">{number}</h1>
      <p className="mt-2 text-muted-foreground">{note.customerName} · {note.orderNumber}</p>
    </div>
    <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold capitalize text-primary-strong">
      {note.status.replaceAll('_', ' ')}
    </span>
  </div>
}

function DeliveryApproval({
  note,
  countPending,
  actionPending,
  onCount,
  onApprove,
  onReject,
  onReopen,
}: {
  note: DeliveryNoteDetail
  countPending: boolean
  actionPending: boolean
  onCount: (input: Parameters<typeof api.countDeliveryNote>[1]) => void
  onApprove: () => void
  onReject: () => void
  onReopen: () => void
}) {
  const allCounted = note.lines.every((line) => line.countedQty !== null)
  return <section className="mt-5 rounded-2xl border border-border bg-card p-6">
    <Header label="Physical delivery approval" number={note.dnNumber} note={note} />
    {note.status === 'pending_approval' && <form className="mt-7 flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      onCount({ lines: note.lines.map((line) => ({
        lineId: line.id,
        countedQty: Number(form.get(line.id)),
      })) })
    }}>
      {note.lines.map((line) => <label key={line.id} className="grid gap-2 rounded-xl border border-border p-4 sm:grid-cols-[1fr_10rem] sm:items-center">
        <span>
          <span className="font-medium">{line.equipmentName}</span>
          <span className="block text-sm text-muted-foreground">
            Submitted {line.handedOverQty}; issued {line.issuedQty}
            {line.countDifference !== null && <strong className={line.countDifference === 0 ? 'text-primary-strong' : 'text-danger'}>
              {' '}· difference {line.countDifference}
            </strong>}
          </span>
        </span>
        <input className="input" name={line.id} type="number" min="0" step="1" required defaultValue={line.countedQty ?? line.handedOverQty} aria-label={`${line.equipmentName} physical count`} />
      </label>)}
      <button className="button-secondary" disabled={countPending}>
        {countPending ? 'Saving count...' : allCounted ? 'Update physical count' : 'Save physical count'}
      </button>
    </form>}
    <ApprovalActions note={note} allCounted={allCounted} pending={actionPending} onApprove={onApprove} onReject={onReject} onReopen={onReopen} />
  </section>
}

function RetentionApproval({
  note,
  countPending,
  actionPending,
  reversePending,
  onCount,
  onApprove,
  onReject,
  onReopen,
  onReverse,
}: {
  note: RetentionNoteDetail
  countPending: boolean
  actionPending: boolean
  reversePending: boolean
  onCount: (input: Parameters<typeof api.countRetentionNote>[1]) => void
  onApprove: () => void
  onReject: () => void
  onReopen: () => void
  onReverse: (id: string, reason: string) => void
}) {
  const allCounted = note.lines.every((line) => line.countedReturnedQty !== null)
  return <section className="mt-5 rounded-2xl border border-border bg-card p-6">
    <Header label="Physical return approval" number={note.rnNumber} note={note} />
    {note.status === 'pending_approval' && <form className="mt-7 flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      onCount({ lines: note.lines.map((line) => ({
        lineId: line.id,
        countedReturnedQty: Number(form.get(line.id)),
      })) })
    }}>
      {note.lines.map((line) => <label key={line.id} className="grid gap-2 rounded-xl border border-border p-4 sm:grid-cols-[1fr_10rem] sm:items-center">
        <span>
          <span className="font-medium">{line.equipmentName}</span>
          <span className="block text-sm text-muted-foreground">
            Returned {line.returnedQty}; balance {line.balanceQty}; missing/damaged {line.missingDamagedQty}
            {line.countDifference !== null && <strong className={line.countDifference === 0 ? 'text-primary-strong' : 'text-danger'}>
              {' '}· return count difference {line.countDifference}
            </strong>}
          </span>
        </span>
        <input className="input" name={line.id} type="number" min="0" step="1" required defaultValue={line.countedReturnedQty ?? line.returnedQty} aria-label={`${line.equipmentName} returned physical count`} />
      </label>)}
      <button className="button-secondary" disabled={countPending}>
        {countPending ? 'Saving count...' : allCounted ? 'Update physical count' : 'Save physical count'}
      </button>
    </form>}
    <ApprovalActions note={note} allCounted={allCounted} pending={actionPending} onApprove={onApprove} onReject={onReject} onReopen={onReopen} />
    {note.status === 'approved' && <div className="mt-7 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-border text-muted-foreground">
          <th className="py-3">Item</th><th>Stock in</th><th>Written off</th><th>Resolution</th>
        </tr></thead>
        <tbody>{note.lines.map((line) => <tr key={line.id} className="border-b border-border">
          <td className="py-4 font-medium">{line.equipmentName}</td>
          <td>{line.countedReturnedQty ?? 0}</td>
          <td>{line.missingDamagedQty}</td>
          <td>
            {line.discrepancyStatus?.replaceAll('_', ' ') ?? '—'}
            {line.discrepancyId && line.discrepancyStatus === 'written_off' && !line.writeOffReversed && <form className="mt-2 flex max-w-md gap-2" onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              onReverse(line.discrepancyId!, String(form.get('reason')))
            }}>
              <input className="input" name="reason" required maxLength={500} placeholder="Reversal reason" aria-label={`Reversal reason for ${line.equipmentName}`} />
              <button className="button-secondary whitespace-nowrap" disabled={reversePending}>Reverse</button>
            </form>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>
}

function ApprovalActions({
  note,
  allCounted,
  pending,
  onApprove,
  onReject,
  onReopen,
}: {
  note: DeliveryNoteDetail | RetentionNoteDetail
  allCounted: boolean
  pending: boolean
  onApprove: () => void
  onReject: () => void
  onReopen: () => void
}) {
  return <div className="mt-6 flex flex-wrap gap-3">
    {note.status === 'pending_approval' && <>
      <button className="button-primary" disabled={!allCounted || pending} onClick={onApprove}>
        Approve and post stock
      </button>
      <button className="button-secondary" disabled={pending} onClick={onReject}>Reject</button>
    </>}
    {note.status === 'rejected' && <button className="button-primary" disabled={pending} onClick={onReopen}>
      Reopen and create link
    </button>}
  </div>
}
