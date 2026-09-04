import type { DeliveryNoteSubmission, RetentionNoteSubmission } from '@herms/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api, type DeliveryNoteDetail, type RetentionNoteDetail, type TokenNote } from '../api'
import { queryKeys } from '../queries'

export const Route = createFileRoute('/notes/$token')({ component: TokenNotePage })

function TokenNotePage() {
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const note = useQuery(queryOptions({
    queryKey: ['token-note', token],
    queryFn: () => api.tokenNote(token),
    retry: false,
  }))
  const submit = useMutation({
    mutationFn: (input: DeliveryNoteSubmission | RetentionNoteSubmission) =>
      api.submitTokenNote(token, input),
    onSuccess: async (submittedNote) => {
      queryClient.setQueryData(queryKeys.approvalNote(submittedNote.id), submittedNote)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
        queryClient.invalidateQueries({ queryKey: queryKeys.approvalMetrics }),
      ])
      await navigate({ to: submittedNote.approvalPath })
    },
  })

  if (note.isPending) {
    return <PublicShell><p className="text-[#60727e]">Opening secure note…</p></PublicShell>
  }
  if (!note.data) {
    return <PublicShell><p role="alert" className="rounded-xl border border-danger/20 bg-danger-soft p-5 text-danger">
      {note.error instanceof ApiError ? note.error.message : 'This note link is unavailable'}
    </p></PublicShell>
  }

  const error = submit.error instanceof ApiError
    ? submit.error.message
    : submit.error ? 'Unable to submit note' : null

  return (
    <PublicShell>
      <NoteHeader note={note.data} token={token} />
      {submit.isSuccess
        ? <SubmissionComplete />
        : note.data.noteType === 'retention_note'
          ? <RetentionForm note={note.data} pending={submit.isPending} error={error} onSubmit={submit.mutate} />
          : <DeliveryForm note={note.data} pending={submit.isPending} error={error} onSubmit={submit.mutate} />}
    </PublicShell>
  )
}

function NoteHeader({ note, token }: { note: TokenNote; token: string }) {
  const number = note.noteType === 'retention_note' ? note.rnNumber : note.dnNumber
  const typeLabel = note.noteType === 'retention_note' ? 'Retention note' : 'Delivery note'
  return (
    <header className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#078486]">{typeLabel}</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-[#071c23]">{number} · {note.customerName}</h1>
      <p className="mt-1 text-sm text-[#526977]">{note.orderNumber} · {note.customerAddress ?? 'Customer location'}</p>
      <p className="mt-2 flex items-center gap-2 text-xs text-[#526977]">
        <ClockIcon />
        Link {token.slice(0, 12)}… {expiryLabel(note.tokenExpiresAt)}
      </p>
    </header>
  )
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
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(
    note.lines.map((line) => [line.id, line.handedOverQty]),
  ))
  const [reasons, setReasons] = useState<Record<string, DeliveryNoteSubmission['lines'][number]['mismatchReason']>>(() => Object.fromEntries(
    note.lines.map((line) => [line.id, line.mismatchReason]),
  ))
  const [remarks, setRemarks] = useState(note.lines.find((line) => line.mismatchDetail)?.mismatchDetail ?? '')
  const hasOtherReason = note.lines.some((line) =>
    quantities[line.id] !== line.issuedQty && reasons[line.id] === 'other')

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault()
      onSubmit({
        lines: note.lines.map((line) => {
          const handedOverQty = quantities[line.id] ?? 0
          const mismatched = handedOverQty !== line.issuedQty
          return {
            lineId: line.id,
            handedOverQty,
            mismatchReason: mismatched ? reasons[line.id] ?? null : null,
            mismatchDetail: mismatched ? remarks.trim() || null : null,
          }
        }),
      })
    }}>
      {note.lines.map((line) => {
        const quantity = quantities[line.id] ?? 0
        const mismatched = quantity !== line.issuedQty
        return (
          <section key={line.id} className="rounded-xl border border-[#d6e0e2] bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-sm font-semibold text-[#071c23]">{line.equipmentName}</h2>
              <p className="text-xs text-[#526977]">Issued from store: {line.issuedQty}</p>
            </div>
            <label className="mt-5 block text-xs font-semibold text-[#071c23]">
              Quantity handed over
              <input
                className="input mt-2 max-w-[17rem]"
                type="number"
                min="0"
                max={line.issuedQty}
                step="1"
                required
                value={quantity}
                onChange={(event) => setQuantities((current) => ({
                  ...current,
                  [line.id]: event.currentTarget.valueAsNumber,
                }))}
              />
            </label>
            {mismatched && (
              <label className="mt-4 block max-w-[17rem] text-xs font-semibold text-[#071c23]">
                Reason for difference
                <select
                  className="input mt-2"
                  required
                  value={reasons[line.id] ?? ''}
                  onChange={(event) => setReasons((current) => ({
                    ...current,
                    [line.id]: event.currentTarget.value as DeliveryNoteSubmission['lines'][number]['mismatchReason'],
                  }))}
                >
                  <option value="">Select reason</option>
                  <option value="missing">Missing</option>
                  <option value="damaged">Damaged</option>
                  <option value="not_accepted">Not accepted</option>
                  <option value="other">Other</option>
                </select>
              </label>
            )}
          </section>
        )
      })}
      <Remarks value={remarks} required={hasOtherReason} onChange={setRemarks} />
      {error && <ErrorMessage message={error} />}
      <button className="button-primary w-full" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit note'}
      </button>
      <PublicFooter />
    </form>
  )
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
  type RetentionValue = { returned: number; balance: number; shortfall: number }
  const [values, setValues] = useState<Record<string, RetentionValue>>(() => Object.fromEntries(
    note.lines.map((line) => [line.id, {
      returned: line.returnedQty,
      balance: line.balanceQty,
      shortfall: line.missingDamagedQty,
    }]),
  ))
  const [reasons, setReasons] = useState<Record<string, RetentionNoteSubmission['lines'][number]['mismatchReason']>>(() => Object.fromEntries(
    note.lines.map((line) => [line.id, line.mismatchReason]),
  ))
  const [responsible, setResponsible] = useState<Record<string, RetentionNoteSubmission['lines'][number]['responsibleParty']>>(() => Object.fromEntries(
    note.lines.map((line) => [line.id, line.responsibleParty]),
  ))
  const [remarks, setRemarks] = useState(note.lines.find((line) => line.reasonDetail)?.reasonDetail ?? '')
  const hasOtherReason = note.lines.some((line) =>
    (values[line.id]?.shortfall ?? 0) > 0 && reasons[line.id] === 'other')
  const hasInvalidTotal = note.lines.some((line) => {
    const value = values[line.id] ?? { returned: 0, balance: 0, shortfall: 0 }
    return value.returned + value.balance + value.shortfall !== line.deliveredQty
  })

  const updateValue = (lineId: string, field: keyof RetentionValue, value: number) => {
    setValues((current) => ({
      ...current,
      [lineId]: { ...current[lineId], [field]: value },
    }))
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault()
      onSubmit({
        lines: note.lines.map((line) => {
          const value = values[line.id] ?? { returned: 0, balance: 0, shortfall: 0 }
          return {
            lineId: line.id,
            returnedQty: value.returned,
            balanceQty: value.balance,
            missingDamagedQty: value.shortfall,
            mismatchReason: value.shortfall > 0 ? reasons[line.id] ?? null : null,
            responsibleParty: value.shortfall > 0 ? responsible[line.id] ?? null : null,
            reasonDetail: value.shortfall > 0 ? remarks.trim() || null : null,
          }
        }),
      })
    }}>
      <p className="rounded-xl bg-[#e8f5f5] p-4 text-xs leading-5 text-[#087a7d]">
        Record returned, still-out, and missing or damaged quantities. The total for each item must equal its approved delivered quantity.
      </p>
      {note.lines.map((line) => {
        const value = values[line.id] ?? { returned: 0, balance: 0, shortfall: 0 }
        const accounted = value.returned + value.balance + value.shortfall
        return (
          <section key={line.id} className="rounded-xl border border-[#d6e0e2] bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-sm font-semibold text-[#071c23]">{line.equipmentName}</h2>
              <p className="text-xs text-[#526977]">Delivered: {line.deliveredQty}</p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <QuantityInput label="Returned" value={value.returned} onChange={(next) => updateValue(line.id, 'returned', next)} />
              <QuantityInput label="Still on rent" value={value.balance} onChange={(next) => updateValue(line.id, 'balance', next)} />
              <QuantityInput label="Missing / damaged" value={value.shortfall} onChange={(next) => updateValue(line.id, 'shortfall', next)} />
            </div>
            {accounted !== line.deliveredQty && (
              <p className="mt-3 text-xs font-medium text-[#b16b00]">
                Accounted {accounted} of {line.deliveredQty}. Adjust the quantities before submitting.
              </p>
            )}
            {value.shortfall > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-[#071c23]">
                  Shortfall type
                  <select
                    className="input mt-2"
                    required
                    value={reasons[line.id] ?? ''}
                    onChange={(event) => setReasons((current) => ({
                      ...current,
                      [line.id]: event.currentTarget.value as RetentionNoteSubmission['lines'][number]['mismatchReason'],
                    }))}
                  >
                    <option value="">Select type</option>
                    <option value="missing">Missing</option>
                    <option value="damaged">Damaged</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-[#071c23]">
                  Responsible party
                  <select
                    className="input mt-2"
                    required
                    value={responsible[line.id] ?? ''}
                    onChange={(event) => setResponsible((current) => ({
                      ...current,
                      [line.id]: event.currentTarget.value as RetentionNoteSubmission['lines'][number]['responsibleParty'],
                    }))}
                  >
                    <option value="">Select party</option>
                    <option value="customer">Customer</option>
                    <option value="staff_member">Staff member</option>
                  </select>
                </label>
              </div>
            )}
          </section>
        )
      })}
      <Remarks value={remarks} required={hasOtherReason} onChange={setRemarks} />
      {error && <ErrorMessage message={error} />}
      <button className="button-primary w-full" disabled={pending || hasInvalidTotal}>
        {pending ? 'Submitting…' : 'Submit note'}
      </button>
      <PublicFooter />
    </form>
  )
}

function QuantityInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="text-xs font-semibold text-[#071c23]">
      {label}
      <input
        className="input mt-2"
        type="number"
        min="0"
        step="1"
        required
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </label>
  )
}

function Remarks({ value, required, onChange }: { value: string; required: boolean; onChange: (value: string) => void }) {
  return (
    <label className="rounded-xl border border-[#d6e0e2] bg-white p-5 text-xs font-semibold text-[#071c23]">
      Remarks
      <textarea
        className="input mt-2 min-h-24 resize-y font-normal"
        maxLength={500}
        placeholder="Anything the store admin should know"
        required={required}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  )
}

function SubmissionComplete() {
  return (
    <section className="rounded-xl border border-[#d6e0e2] bg-white px-6 py-8 text-center">
      <ShieldCheckIcon />
      <h2 className="mt-4 text-lg font-semibold text-[#071c23]">Note submitted</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#526977]">
        Opening the store admin approval queue. Stock will update only after approval.
      </p>
      <a
        href="/approvals"
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#078486] bg-[#078486] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#096f72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#078486] focus-visible:ring-offset-2"
      >
        View approval queue
      </a>
    </section>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return <p role="alert" className="rounded-xl border border-danger/20 bg-danger-soft px-5 py-4 text-sm text-danger">{message}</p>
}

function PublicFooter() {
  return <p className="text-center text-xs text-[#526977]">No login required — this link is single-use and time-bound.</p>
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen w-full max-w-[640px] px-5 py-8 text-[#071c23] sm:py-10">{children}</main>
}

function expiryLabel(expiresAt?: string) {
  if (!expiresAt) return 'is time-bound'
  const remainingMinutes = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 60_000))
  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  return `expires in ${hours}h ${minutes}m`
}

function ClockIcon() {
  return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
}

function ShieldCheckIcon() {
  return <svg aria-hidden="true" className="mx-auto text-[#2a986c]" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
}
