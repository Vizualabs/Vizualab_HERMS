import { useEffect, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import {
  ApiError,
  api,
  type ApprovalNote,
  type ApprovalSummary,
  type DeliveryNoteDetail,
  type OpeningBalanceNoteDetail,
  type RetentionNoteDetail,
} from '../../api'
import { ManualLinkShare } from '../../components/ManualShareActions'
import { useConfirm } from '../../components/ConfirmDialog'
import { approvalMetricsQuery, approvalsQuery, queryKeys } from '../../queries'
import { createNoteShareMessage } from '../../whatsapp'

export const Route = createFileRoute('/_authenticated/approvals')({ component: ApprovalsPage })

const dateTimeFormatter = new Intl.DateTimeFormat('en-LK', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
})

function ApprovalsPage() {
  const approvals = useQuery(approvalsQuery)
  const metrics = useQuery(approvalMetricsQuery)
  const detailQueries = useQueries({
    queries: (approvals.data ?? []).map((summary) => ({
      queryKey: queryKeys.approvalNote(summary.id),
      queryFn: () => api.approvalNote(summary.id),
      staleTime: 5_000,
    })),
  })

  return (
    <section aria-labelledby="approvals-title">
      <header>
        <h1 id="approvals-title">Store Admin Approvals</h1>
        <p className="mt-1 text-sm text-[#60727e]">
          Delivery and retention quantities require a physical count and approval here
        </p>
      </header>

      <dl className="mt-7 grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Pending approval"
          value={metrics.data?.pendingApproval}
          valueClassName="text-[#d99620]"
        />
        <MetricCard
          label="Approved today"
          value={metrics.data?.approvedToday}
          valueClassName="text-[#159563]"
        />
        <MetricCard
          label="Discrepancies flagged"
          value={metrics.data?.mismatchesFlagged}
          valueClassName="text-[#df2f2f]"
          description="Require review before approval"
        />
      </dl>

      {(approvals.error || metrics.error) && (
        <p role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger-soft px-5 py-4 text-danger">
          {getErrorMessage(approvals.error ?? metrics.error, 'Unable to load approvals')}
        </p>
      )}

      {approvals.isPending && (
        <div aria-live="polite" className="mt-5 rounded-xl border border-[#d6e0e2] bg-white px-5 py-8 text-[#60727e]">
          Loading approvals…
        </div>
      )}

      {approvals.data?.length === 0 && (
        <div className="mt-5 rounded-xl border border-[#d6e0e2] bg-white px-5 py-8 text-[#60727e]">
          No notes await action.
        </div>
      )}

      {approvals.data && approvals.data.length > 0 && (
        <div className="mt-5 space-y-5">
          {approvals.data.map((summary, index) => {
            const detail = detailQueries[index]
            if (detail?.data) return <ApprovalCard key={summary.id} note={detail.data} />
            return (
              <ApprovalCardFallback
                key={summary.id}
                summary={summary}
                error={detail?.error}
                pending={detail?.isPending ?? true}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function MetricCard({
  label,
  value,
  valueClassName,
  description,
}: {
  label: string
  value: number | undefined
  valueClassName: string
  description?: string
}) {
  return (
    <div className="min-h-32 rounded-xl border border-[#d6e0e2] bg-white px-5 py-5">
      <dt className="text-xs font-medium uppercase tracking-[0.025em] text-[#415867]">{label}</dt>
      <dd className={`mt-4 text-2xl font-medium leading-none tabular-nums ${valueClassName}`}>
        {value ?? '—'}
      </dd>
      {description && <p className="mt-2 text-xs text-[#526977]">{description}</p>}
    </div>
  )
}

function ApprovalCard({ note }: { note: ApprovalNote }) {
  if (note.status !== 'pending_approval') return <WaitingApprovalCard note={note} />
  if (note.noteType === 'retention_note') return <PendingRetentionCard note={note} />
  if (note.noteType === 'opening_balance') return <PendingOpeningCard note={note} />
  return <PendingDeliveryCard note={note} />
}

function PendingDeliveryCard({ note }: { note: DeliveryNoteDetail }) {
  const initialCounts = () => Object.fromEntries(
    note.lines.map((line) => [line.id, line.countedQty ?? line.handedOverQty]),
  )
  const [counts, setCounts] = useState<Record<string, number | ''>>(initialCounts)

  useEffect(() => setCounts(initialCounts()), [note])

  const actions = useApprovalActions(note)
  return (
    <ApprovalFormCard
      note={note}
      rows={note.lines.map((line) => ({
        id: line.id,
        itemName: line.equipmentName,
        issuedQuantity: line.issuedQty,
        submittedQuantity: line.handedOverQty,
        reason: line.mismatchReason,
      }))}
      counts={counts}
      setCount={(lineId, count) => setCounts((current) => ({ ...current, [lineId]: count }))}
      approvePending={actions.approve.isPending}
      rejectPending={actions.reject.isPending}
      error={actions.approve.error ?? actions.reject.error}
      onApprove={() => actions.approve.mutate({
        lines: note.lines.map((line) => ({ lineId: line.id, countedQty: Number(counts[line.id]) })),
      })}
      onReject={() => actions.reject.mutate()}
    />
  )
}

function PendingRetentionCard({ note }: { note: RetentionNoteDetail }) {
  const initialCounts = () => Object.fromEntries(
    note.lines.map((line) => [line.id, line.countedReturnedQty ?? line.returnedQty]),
  )
  const [counts, setCounts] = useState<Record<string, number | ''>>(initialCounts)

  useEffect(() => setCounts(initialCounts()), [note])

  const actions = useApprovalActions(note)
  return (
    <ApprovalFormCard
      note={note}
      rows={note.lines.map((line) => ({
        id: line.id,
        itemName: line.equipmentName,
        issuedQuantity: line.deliveredQty,
        submittedQuantity: line.returnedQty,
        reason: line.missingDamagedQty > 0 ? line.mismatchReason : null,
      }))}
      counts={counts}
      setCount={(lineId, count) => setCounts((current) => ({ ...current, [lineId]: count }))}
      approvePending={actions.approve.isPending}
      rejectPending={actions.reject.isPending}
      error={actions.approve.error ?? actions.reject.error}
      onApprove={() => actions.approve.mutate({
        lines: note.lines.map((line) => ({
          lineId: line.id,
          countedReturnedQty: Number(counts[line.id]),
        })),
      })}
      onReject={() => actions.reject.mutate()}
    />
  )
}

function PendingOpeningCard({ note }: { note: OpeningBalanceNoteDetail }) {
  const initialCounts = () => Object.fromEntries(
    note.lines.map((line) => [line.id, line.countedQty ?? line.requestedQty]),
  )
  const [counts, setCounts] = useState<Record<string, number | ''>>(initialCounts)

  useEffect(() => setCounts(initialCounts()), [note])

  const actions = useApprovalActions(note)
  return (
    <ApprovalFormCard
      note={note}
      rows={note.lines.map((line) => ({
        id: line.id,
        itemName: line.equipmentName,
        issuedQuantity: line.requestedQty,
        submittedQuantity: line.requestedQty,
        reason: null,
      }))}
      counts={counts}
      setCount={(lineId, count) => setCounts((current) => ({ ...current, [lineId]: count }))}
      approvePending={actions.approve.isPending}
      rejectPending={actions.reject.isPending}
      error={actions.approve.error ?? actions.reject.error}
      onApprove={() => actions.approve.mutate({
        lines: note.lines.map((line) => ({
          lineId: line.id,
          countedQty: Number(counts[line.id]),
        })),
      })}
      onReject={() => actions.reject.mutate()}
    />
  )
}

type ApprovalRow = {
  id: string
  itemName: string
  issuedQuantity: number
  submittedQuantity: number
  reason: string | null
}

function ApprovalFormCard({
  note,
  rows,
  counts,
  setCount,
  approvePending,
  rejectPending,
  error,
  onApprove,
  onReject,
}: {
  note: ApprovalNote
  rows: ApprovalRow[]
  counts: Record<string, number | ''>
  setCount: (lineId: string, count: number | '') => void
  approvePending: boolean
  rejectPending: boolean
  error: Error | null
  onApprove: () => void
  onReject: () => void
}) {
  const actionPending = approvePending || rejectPending
  const { number, typeLabel } = approvalIdentity(note)
  const confirm = useConfirm()

  return (
    <form
      aria-label={`Approval for ${number}`}
      className="overflow-hidden rounded-xl border border-[#d6e0e2] bg-white"
      onSubmit={(event) => {
        event.preventDefault()
        void confirm({
          title: 'Approve and post stock?',
          message: 'Approve this physical count and post its stock movements?',
          confirmLabel: 'Approve',
        }).then((ok) => { if (ok) onApprove() })
      }}
    >
      <div className="flex flex-col gap-4 border-b border-[#d6e0e2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <ApprovalIdentity note={note} number={number} typeLabel={typeLabel} />
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="min-h-10 rounded-lg border border-[#d6e0e2] bg-white px-4 text-xs font-semibold text-[#071c23] shadow-sm transition-colors hover:bg-[#f4f8f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#078486]"
            disabled={actionPending}
            onClick={() => {
              void confirm({
                title: note.noteType === 'opening_balance' ? 'Reject this registration?' : 'Reject this note?',
                message: note.noteType === 'opening_balance'
                  ? 'Reject this opening-stock registration?'
                  : 'Reject this note and revoke its field link?',
                confirmLabel: 'Reject',
                tone: 'danger',
              }).then((ok) => { if (ok) onReject() })
            }}
          >
            {rejectPending ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            type="submit"
            className="min-h-10 rounded-lg border border-[#078486] bg-[#078486] px-4 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#096f72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#078486] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={actionPending || rows.length === 0}
          >
            {approvePending ? 'Approving…' : 'Approve & post stock'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto px-5 pb-4">
        <table className="w-full min-w-[930px] text-left">
          <caption className="sr-only">Physical count review for {number}</caption>
          <thead>
            <tr className="border-b border-[#d6e0e2]">
              <th className="w-[16%] py-4 pr-4">Item</th>
              <th className="w-[21%] px-3 py-4">
                {note.noteType === 'opening_balance' ? 'Registered qty' : 'Issued from store'}
              </th>
              <th className="w-[17%] px-3 py-4">
                {note.noteType === 'opening_balance'
                  ? note.entryType === 'stock_addition' ? 'Addition qty' : 'Opening qty'
                  : 'Submitted qty'}
              </th>
              <th className="w-[13%] px-3 py-4">Reason</th>
              <th className="w-[22%] px-3 py-4">Admin physical count</th>
              <th className="w-[11%] py-4 pl-3 text-right">Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const count = counts[row.id] ?? ''
              const matches = count !== '' && count === row.submittedQuantity
              return (
                <tr key={row.id} className="border-b border-[#e1e8e9] last:border-0">
                  <td className="py-3.5 pr-4 font-medium text-[#071c23]">{row.itemName}</td>
                  <td className="px-3 py-3.5 tabular-nums text-[#526977]">{row.issuedQuantity}</td>
                  <td className="px-3 py-3.5 tabular-nums text-[#071c23]">{row.submittedQuantity}</td>
                  <td className="px-3 py-3.5">
                    {row.reason
                      ? <ReasonBadge reason={row.reason} />
                      : <span className="text-[#60727e]">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      className="h-10 w-36 rounded-lg border border-[#d6e0e2] bg-white px-3 text-sm tabular-nums text-[#071c23] shadow-sm outline-none transition focus:border-[#078486] focus:ring-2 focus:ring-[#078486]/15"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="1000000"
                      step="1"
                      required
                      autoComplete="off"
                      value={count}
                      aria-label={`${row.itemName} admin physical count`}
                      onChange={(event) => setCount(
                        row.id,
                        event.currentTarget.value === '' ? '' : event.currentTarget.valueAsNumber,
                      )}
                    />
                  </td>
                  <td className="py-3.5 pl-3 text-right">
                    <CheckBadge matches={matches} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p role="alert" className="border-t border-danger/15 bg-danger-soft px-5 py-3 text-xs text-danger">
          {getErrorMessage(error, 'Unable to update this approval')}
        </p>
      )}
    </form>
  )
}

function ApprovalIdentity({
  note,
  number,
  typeLabel,
}: {
  note: ApprovalNote
  number: string
  typeLabel: string
}) {
  return (
    <div className="min-w-0">
      <h2 className="text-[#071c23]">
        <Link
          to="/approvals/$noteId"
          params={{ noteId: note.id }}
          preload="intent"
          className="rounded-sm hover:text-[#078486] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#078486]"
        >
          {number} · {typeLabel}
        </Link>
      </h2>
      <p className="mt-0.5 truncate text-xs text-[#526977]">
        {note.noteType === 'opening_balance'
          ? `${note.storeName} · submitted by ${note.submittedByName ?? 'Equipment creator'}`
          : `${note.orderNumber} · ${note.customerName} · submitted by ${note.submittedByName ?? 'Field staff'}`}
        {note.submittedAt ? ` — ${dateTimeFormatter.format(new Date(note.submittedAt))}` : ''}
      </p>
    </div>
  )
}

function WaitingApprovalCard({ note }: { note: ApprovalNote }) {
  const client = useQueryClient()
  const [reopenedLink, setReopenedLink] = useState<string | null>(null)
  const reopen = useMutation<ApprovalNote, Error, void>({
    mutationFn: () => note.noteType === 'retention_note'
      ? api.reopenRetentionNote(note.id)
      : note.noteType === 'opening_balance'
        ? api.reopenOpeningBalance(note.id)
        : api.reopenDeliveryNote(note.id),
    onSuccess: async (reopenedNote) => {
      setReopenedLink(reopenedNote.noteType === 'opening_balance'
        ? null
        : reopenedNote.submissionLink ?? null)
      await client.invalidateQueries({ queryKey: queryKeys.approvals })
    },
  })
  const { number, typeLabel } = approvalIdentity(note)
  const status = note.status.replaceAll('_', ' ')
  const confirm = useConfirm()
  return (
    <article className="rounded-xl border border-[#d6e0e2] bg-white px-5 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[#071c23]">{number} · {typeLabel}</h2>
          <p className="mt-0.5 text-xs text-[#526977]">
            {note.noteType === 'opening_balance'
              ? note.storeName
              : `${note.orderNumber} · ${note.customerName}`}
          </p>
          <p className="mt-2 text-xs text-[#60727e]">
            {note.noteType === 'opening_balance'
              ? 'This opening balance must be reopened before it can be counted again.'
              : note.status === 'reopened'
              ? 'Waiting for field staff to resubmit this note.'
              : 'This note must be reopened before field staff can resubmit it.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[#d9f2f3] px-3 py-1 text-xs font-semibold capitalize text-[#087a7d]">
            {status}
          </span>
          <Link
            to="/approvals/$noteId"
            params={{ noteId: note.id }}
            preload="intent"
            className="inline-flex min-h-10 items-center rounded-lg border border-[#d6e0e2] bg-white px-4 text-xs font-semibold text-[#071c23] shadow-sm hover:bg-[#f4f8f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#078486]"
          >
            View note
          </Link>
          {note.status === 'rejected' && (
            <button
              type="button"
              className="min-h-10 rounded-lg border border-[#078486] bg-[#078486] px-4 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#096f72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#078486] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={reopen.isPending}
              onClick={() => {
                void confirm({
                  title: note.noteType === 'opening_balance' ? 'Reopen this count?' : 'Reopen this note?',
                  message: note.noteType === 'opening_balance'
                    ? 'Reopen this opening balance for a new physical count?'
                    : 'Reopen this note and create a new field link?',
                  confirmLabel: 'Reopen',
                }).then((ok) => { if (ok) reopen.mutate() })
              }}
            >
              {reopen.isPending
                ? 'Reopening…'
                : note.noteType === 'opening_balance' ? 'Reopen count' : 'Reopen & create link'}
            </button>
          )}
        </div>
      </div>
      {reopen.error && (
        <p role="alert" className="mt-3 border-t border-danger/15 pt-3 text-xs text-danger">
          {getErrorMessage(reopen.error, 'Unable to reopen this note')}
        </p>
      )}
      {reopenedLink && note.noteType !== 'opening_balance' && <ManualLinkShare
        label={`${typeLabel} submission link created`}
        link={reopenedLink}
        message={createNoteShareMessage({
          noteType: note.noteType === 'retention_note' ? 'Retention' : 'Delivery',
          noteNumber: number,
          orderNumber: note.orderNumber,
          customerName: note.customerName,
          submissionLink: reopenedLink,
        })}
      />}
    </article>
  )
}

function ApprovalCardFallback({
  summary,
  error,
  pending,
}: {
  summary: ApprovalSummary
  error: Error | null | undefined
  pending: boolean
}) {
  const number = summary.rnNumber ?? summary.dnNumber ?? summary.obNumber ?? 'Approval note'
  return (
    <article className="rounded-xl border border-[#d6e0e2] bg-white px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[#071c23]">{number}</h2>
          <p className="mt-1 text-xs text-[#526977]">
            {summary.orderNumber && summary.customerName
              ? `${summary.orderNumber} · ${summary.customerName}`
              : summary.entryType === 'stock_addition'
                ? 'Additional stock receipt'
                : 'Opening stock registration'}
          </p>
          <p className={`mt-2 text-xs ${error ? 'text-danger' : 'text-[#60727e]'}`}>
            {pending ? 'Loading note details…' : getErrorMessage(error, 'Unable to load note details')}
          </p>
        </div>
        {!pending && (
          <Link
            to="/approvals/$noteId"
            params={{ noteId: summary.id }}
            preload="intent"
            className="inline-flex min-h-10 items-center rounded-lg border border-[#d6e0e2] px-4 text-xs font-semibold text-[#071c23] shadow-sm hover:bg-[#f4f8f8]"
          >
            View note
          </Link>
        )}
      </div>
    </article>
  )
}

function ReasonBadge({ reason }: { reason: string }) {
  return (
    <span className="inline-flex rounded-full bg-[#fce5e5] px-2.5 py-1 text-xs font-semibold leading-none text-[#df2f2f]">
      {reason.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase())}
    </span>
  )
}

function CheckBadge({ matches }: { matches: boolean }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold leading-none ${
      matches ? 'bg-[#e2f3ea] text-[#158653]' : 'bg-[#fce5e5] text-[#df2f2f]'
    }`}>
      {matches ? 'Matches' : 'Mismatch'}
    </span>
  )
}

function useApprovalActions(note: ApprovalNote) {
  const client = useQueryClient()
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.approvals }),
      client.invalidateQueries({ queryKey: queryKeys.stock }),
      client.invalidateQueries({ queryKey: queryKeys.dashboard }),
      client.invalidateQueries({ queryKey: queryKeys.claims }),
      client.invalidateQueries({ queryKey: queryKeys.discrepancies }),
      client.invalidateQueries({ queryKey: queryKeys.claimableDiscrepancies }),
      client.invalidateQueries({ queryKey: queryKeys.orders }),
      client.invalidateQueries({ queryKey: queryKeys.finance }),
    ])
  }

  const approve = useMutation({
    mutationFn: async (
      countInput:
        | Parameters<typeof api.countDeliveryNote>[1]
        | Parameters<typeof api.countRetentionNote>[1],
    ) => {
      if (note.noteType === 'retention_note') {
        await api.countRetentionNote(
          note.id,
          countInput as Parameters<typeof api.countRetentionNote>[1],
        )
        return api.approveRetentionNote(note.id)
      }
      if (note.noteType === 'opening_balance') {
        await api.countOpeningBalance(
          note.id,
          countInput as Parameters<typeof api.countOpeningBalance>[1],
        )
        return api.approveOpeningBalance(note.id)
      }
      await api.countDeliveryNote(
        note.id,
        countInput as Parameters<typeof api.countDeliveryNote>[1],
      )
      return api.approveDeliveryNote(note.id)
    },
    onSuccess: refresh,
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.approvalNote(note.id) })
    },
  })

  const reject = useMutation<ApprovalNote, Error, void>({
    mutationFn: () => note.noteType === 'retention_note'
      ? api.rejectRetentionNote(note.id)
      : note.noteType === 'opening_balance'
        ? api.rejectOpeningBalance(note.id)
        : api.rejectDeliveryNote(note.id),
    onSuccess: refresh,
  })

  return { approve, reject }
}

function approvalIdentity(note: ApprovalNote) {
  if (note.noteType === 'retention_note') {
    return { number: note.rnNumber, typeLabel: 'Retention Note' }
  }
  if (note.noteType === 'opening_balance') {
    return {
      number: note.obNumber,
      typeLabel: note.entryType === 'stock_addition' ? 'Stock Addition' : 'Opening Balance',
    }
  }
  return { number: note.dnNumber, typeLabel: 'Delivery Note' }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}
