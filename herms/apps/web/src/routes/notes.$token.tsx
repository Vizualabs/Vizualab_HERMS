import type { DeliveryNoteSubmission, RetentionNoteSubmission } from '@herms/shared'
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ApiError, api, type DeliveryNoteDetail, type RetentionNoteDetail } from '../api'

export const Route = createFileRoute('/notes/$token')({ component: TokenNotePage })

function TokenNotePage() {
  const { token } = Route.useParams()
  const note = useQuery(queryOptions({
    queryKey: ['token-note', token],
    queryFn: () => api.tokenNote(token),
    retry: false,
  }))
  const submit = useMutation({
    mutationFn: (input: DeliveryNoteSubmission | RetentionNoteSubmission) =>
      api.submitTokenNote(token, input),
  })
  if (note.isPending) {
    return <PublicShell><p className="text-muted-foreground">Opening secure note...</p></PublicShell>
  }
  if (!note.data) {
    return <PublicShell><p role="alert" className="text-danger">
      {note.error instanceof ApiError ? note.error.message : 'This note link is unavailable'}
    </p></PublicShell>
  }
  if (submit.isSuccess) {
    return <PublicShell><div className="rounded-2xl bg-success-soft p-6">
      <h1 className="text-2xl font-semibold">Submitted for approval</h1>
      <p className="mt-2 text-muted-foreground">
        You may use this link to correct quantities until store counting begins.
      </p>
    </div></PublicShell>
  }
  const error = submit.error instanceof ApiError
    ? submit.error.message
    : submit.error ? 'Unable to submit note' : null
  return note.data.noteType === 'retention_note'
    ? <RetentionForm note={note.data} pending={submit.isPending} error={error} onSubmit={submit.mutate} />
    : <DeliveryForm note={note.data} pending={submit.isPending} error={error} onSubmit={submit.mutate} />
}

function DeliveryForm({
  note,
  pending,
  error,
  onSubmit,
}: {
  note: DeliveryNoteDetail
  pending: boolean
  error: string | null
  onSubmit: (input: DeliveryNoteSubmission) => void
}) {
  return <PublicShell>
    <p className="text-sm font-semibold uppercase tracking-widest text-primary">Field handover</p>
    <h1 className="mt-2 text-3xl font-semibold">{note.dnNumber}</h1>
    <p className="mt-2 text-muted-foreground">{note.customerName} · {note.orderNumber}</p>
    <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      onSubmit({ lines: note.lines.map((line) => ({
        lineId: line.id,
        handedOverQty: Number(form.get(`qty-${line.id}`)),
        mismatchReason: (String(form.get(`reason-${line.id}`) || '') || null) as
          'missing' | 'damaged' | 'not_accepted' | 'other' | null,
        mismatchDetail: String(form.get(`detail-${line.id}`) || '') || null,
      })) })
    }}>
      {note.lines.map((line) => <fieldset key={line.id} className="rounded-2xl border border-border bg-card p-5">
        <legend className="px-2 font-semibold">{line.equipmentName}</legend>
        <p className="text-sm text-muted-foreground">Issued: {line.issuedQty} {line.unitOfMeasure}</p>
        <label className="mt-4 block text-sm font-medium">Handed over
          <input className="input mt-2" name={`qty-${line.id}`} type="number" min="0" step="1" defaultValue={line.handedOverQty} required />
        </label>
        <label className="mt-3 block text-sm font-medium">Mismatch reason
          <select className="input mt-2" name={`reason-${line.id}`} defaultValue={line.mismatchReason ?? ''}>
            <option value="">No mismatch</option>
            <option value="damaged">Damaged</option>
            <option value="missing">Missing</option>
            <option value="not_accepted">Not Accepted</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="mt-3 block text-sm font-medium">Details
          <input className="input mt-2" name={`detail-${line.id}`} defaultValue={line.mismatchDetail ?? ''} maxLength={500} />
        </label>
      </fieldset>)}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className="button-primary w-full" disabled={pending}>
        {pending ? 'Submitting...' : 'Submit for approval'}
      </button>
    </form>
  </PublicShell>
}

function RetentionForm({
  note,
  pending,
  error,
  onSubmit,
}: {
  note: RetentionNoteDetail
  pending: boolean
  error: string | null
  onSubmit: (input: RetentionNoteSubmission) => void
}) {
  return <PublicShell>
    <p className="text-sm font-semibold uppercase tracking-widest text-primary">Equipment return</p>
    <h1 className="mt-2 text-3xl font-semibold">{note.rnNumber}</h1>
    <p className="mt-2 text-muted-foreground">{note.customerName} · {note.orderNumber}</p>
    <p className="mt-4 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong">
      Record only quantities accounted for by this return. Partial returns are reconciled cumulatively when the order closes.
    </p>
    <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      onSubmit({ lines: note.lines.map((line) => ({
        lineId: line.id,
        returnedQty: Number(form.get(`returned-${line.id}`)),
        balanceQty: Number(form.get(`balance-${line.id}`)),
        missingDamagedQty: Number(form.get(`shortfall-${line.id}`)),
        mismatchReason: (String(form.get(`reason-${line.id}`) || '') || null) as
          'missing' | 'damaged' | 'other' | null,
        responsibleParty: (String(form.get(`responsible-${line.id}`) || '') || null) as
          'customer' | 'staff_member' | null,
        reasonDetail: String(form.get(`detail-${line.id}`) || '') || null,
      })) })
    }}>
      {note.lines.map((line) => <fieldset key={line.id} className="rounded-2xl border border-border bg-card p-5">
        <legend className="px-2 font-semibold">{line.equipmentName}</legend>
        <p className="text-sm text-muted-foreground">Approved delivered quantity: {line.deliveredQty} {line.unitOfMeasure}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">Returned
            <input className="input mt-2" name={`returned-${line.id}`} type="number" min="0" step="1" defaultValue={line.returnedQty} required />
          </label>
          <label className="text-sm font-medium">Balance
            <input className="input mt-2" name={`balance-${line.id}`} type="number" min="0" step="1" defaultValue={line.balanceQty} required />
          </label>
          <label className="text-sm font-medium">Missing / damaged
            <input className="input mt-2" name={`shortfall-${line.id}`} type="number" min="0" step="1" defaultValue={line.missingDamagedQty} required />
          </label>
        </div>
        <label className="mt-3 block text-sm font-medium">Shortfall type
          <select className="input mt-2" name={`reason-${line.id}`} defaultValue={line.mismatchReason ?? ''}>
            <option value="">No shortfall</option>
            <option value="missing">Missing</option>
            <option value="damaged">Damaged</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="mt-3 block text-sm font-medium">Responsible party
          <select className="input mt-2" name={`responsible-${line.id}`} defaultValue={line.responsibleParty ?? ''}>
            <option value="">Select when there is a shortfall</option>
            <option value="customer">Customer</option>
            <option value="staff_member">Staff Member</option>
          </select>
        </label>
        <label className="mt-3 block text-sm font-medium">Details
          <input className="input mt-2" name={`detail-${line.id}`} defaultValue={line.reasonDetail ?? ''} maxLength={500} />
        </label>
      </fieldset>)}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className="button-primary w-full" disabled={pending}>
        {pending ? 'Submitting...' : 'Submit return for approval'}
      </button>
    </form>
  </PublicShell>
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-xl px-5 py-10 text-foreground">
    <div className="mb-8">
      <p className="text-xl font-bold text-primary-strong">HERMS</p>
      <p className="text-xs text-muted-foreground">Secure equipment note</p>
    </div>
    {children}
  </main>
}
