import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api } from '../../api'
import { queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/approvals/$noteId')({ component: ApprovalDetailPage })

function ApprovalDetailPage() {
  const { noteId } = Route.useParams()
  const client = useQueryClient()
  const note = useQuery(queryOptions({ queryKey: queryKeys.deliveryNote(noteId), queryFn: () => api.deliveryNote(noteId) }))
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: queryKeys.deliveryNote(noteId) }), client.invalidateQueries({ queryKey: queryKeys.approvals }), client.invalidateQueries({ queryKey: queryKeys.stock })]) }
  const count = useMutation({ mutationFn: api.countDeliveryNote.bind(null, noteId), onSuccess: refresh })
  const approve = useMutation({ mutationFn: () => api.approveDeliveryNote(noteId), onSuccess: refresh })
  const reject = useMutation({ mutationFn: () => api.rejectDeliveryNote(noteId), onSuccess: refresh })
  const reopen = useMutation({ mutationFn: () => api.reopenDeliveryNote(noteId), onSuccess: refresh })
  if (note.isPending) return <p className="text-muted-foreground">Loading delivery note...</p>
  if (!note.data) return <p role="alert" className="text-danger">{note.error instanceof ApiError ? note.error.message : 'Delivery note not found'}</p>
  const data = note.data
  const allCounted = data.lines.every((line) => line.countedQty !== null)
  const error = count.error || approve.error || reject.error || reopen.error
  return <div><Link to="/approvals" className="text-sm font-medium text-primary hover:underline">Back to approval queue</Link><section className="mt-5 rounded-2xl border border-border bg-card p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Physical approval</p><h1 className="mt-1 text-3xl font-semibold">{data.dnNumber}</h1><p className="mt-2 text-muted-foreground">{data.customerName} · {data.orderNumber}</p></div><span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold capitalize text-primary-strong">{data.status.replaceAll('_', ' ')}</span></div>
    {data.status === 'pending_approval' && <form className="mt-7 space-y-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); count.mutate({ lines: data.lines.map((line) => ({ lineId: line.id, countedQty: Number(form.get(line.id)) })) }) }}>{data.lines.map((line) => <label key={line.id} className="grid gap-2 rounded-xl border border-border p-4 sm:grid-cols-[1fr_10rem] sm:items-center"><span><span className="font-medium">{line.equipmentName}</span><span className="block text-sm text-muted-foreground">Submitted {line.handedOverQty}; issued {line.issuedQty}{line.countDifference !== null && <strong className={line.countDifference === 0 ? 'text-primary-strong' : 'text-danger'}> · difference {line.countDifference}</strong>}</span></span><input className="input" name={line.id} type="number" min="0" step="1" required defaultValue={line.countedQty ?? line.handedOverQty} aria-label={`${line.equipmentName} physical count`} /></label>)}<button className="button-secondary" disabled={count.isPending}>{count.isPending ? 'Saving count...' : allCounted ? 'Update physical count' : 'Save physical count'}</button></form>}
    <div className="mt-6 flex flex-wrap gap-3">{data.status === 'pending_approval' && <><button className="button-primary" disabled={!allCounted || approve.isPending} onClick={() => approve.mutate()}>Approve and post stock</button><button className="button-secondary" disabled={reject.isPending} onClick={() => reject.mutate()}>Reject</button></>}{data.status === 'rejected' && <button className="button-primary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>Reopen and create link</button>}</div>{error && <p role="alert" className="mt-4 text-sm text-danger">{error instanceof ApiError ? error.message : 'Unable to update delivery note'}</p>}
  </section></div>
}
