import type { DashboardRanking, DiscrepancyStatus } from '@herms/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api, formatMoney, type DamageClaim } from '../../api'
import {
  claimableDiscrepanciesQuery,
  claimsQuery,
  dashboardDiscrepanciesQuery,
  dashboardRankingsQuery,
  queryKeys,
  sessionQuery,
} from '../../queries'

export const Route = createFileRoute('/_authenticated/claims')({
  component: ClaimsPage,
})

type RegistryStatus = DiscrepancyStatus | DamageClaim['status']

type RegistryRow = {
  discrepancyId: string
  orderId: string | null
  orderNumber: string | null
  customerName: string | null
  equipmentName: string
  quantity: number
  discrepancyType: 'missing' | 'damaged'
  reason: string | null
  responsibleParty: 'customer' | 'staff_member' | 'business' | null
  unitPriceCents: number
  valueCents: number
  recordedAt: string
  status: RegistryStatus
  claim: DamageClaim | null
  claimable: boolean
}

const registryToDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Colombo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const registryFilters = { from: '2000-01-01', to: registryToDate }

function ClaimsPage() {
  const queryClient = useQueryClient()
  const session = useQuery(sessionQuery)
  const isFinance = session.data?.role === 'finance' || session.data?.role === 'super_user'
  const canView = isFinance || session.data?.role === 'business_owner'
  const claims = useQuery({ ...claimsQuery, enabled: canView })
  const claimable = useQuery({ ...claimableDiscrepanciesQuery, enabled: isFinance })
  const discrepancies = useQuery({ ...dashboardDiscrepanciesQuery(registryFilters), enabled: canView })
  const rankings = useQuery({ ...dashboardRankingsQuery(registryFilters), enabled: canView })

  const refresh = async (claim?: DamageClaim) => {
    const invalidations: Array<Promise<unknown>> = [
      queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
      queryClient.invalidateQueries({ queryKey: queryKeys.claimableDiscrepancies }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.finance }),
    ]
    if (claim) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.customerBalance(claim.customerId) }),
      )
      if (claim.orderId) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.invoice(claim.orderId) }))
      }
    }
    await Promise.all(invalidations)
  }

  const draft = useMutation({ mutationFn: api.draftClaim, onSuccess: refresh })
  const confirm = useMutation({ mutationFn: api.confirmClaim, onSuccess: refresh })
  const reject = useMutation({ mutationFn: api.rejectClaim, onSuccess: refresh })

  if (!canView) {
    return (
      <p role="alert" className="rounded-2xl border border-border bg-card p-6 text-danger">
        Damage claims are restricted to Finance and Business Owner roles.
      </p>
    )
  }

  const claimByDiscrepancy = new Map(
    (claims.data ?? []).map((claim) => [claim.discrepancyId, claim] as const),
  )
  const claimableByDiscrepancy = new Map(
    (claimable.data ?? []).map((row) => [row.id, row] as const),
  )
  const registeredIds = new Set<string>()
  const registryRows: RegistryRow[] = []

  for (const row of discrepancies.data?.rows ?? []) {
    const claim = claimByDiscrepancy.get(row.id) ?? null
    registeredIds.add(row.id)
    registryRows.push({
      discrepancyId: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      equipmentName: row.equipmentName,
      quantity: row.quantity,
      discrepancyType: row.discrepancyType,
      reason: row.reason,
      responsibleParty: row.responsibleParty,
      unitPriceCents: row.unitPriceCents,
      valueCents: row.valueCents,
      recordedAt: row.recordedAt,
      status: claim?.status ?? row.status,
      claim,
      claimable: claimableByDiscrepancy.has(row.id),
    })
  }

  for (const row of claimable.data ?? []) {
    if (registeredIds.has(row.id)) continue
    registeredIds.add(row.id)
    registryRows.push({
      discrepancyId: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      equipmentName: row.equipmentName,
      quantity: row.quantity,
      discrepancyType: 'damaged',
      reason: row.reason,
      responsibleParty: 'customer',
      unitPriceCents: row.unitPriceCents,
      valueCents: row.claimAmountCents,
      recordedAt: row.damageRecordedAt,
      status: row.status,
      claim: null,
      claimable: true,
    })
  }

  for (const claim of claims.data ?? []) {
    if (registeredIds.has(claim.discrepancyId)) continue
    registeredIds.add(claim.discrepancyId)
    registryRows.push({
      discrepancyId: claim.discrepancyId,
      orderId: claim.orderId,
      orderNumber: claim.orderNumber,
      customerName: claim.customerName,
      equipmentName: claim.equipmentName,
      quantity: claim.quantity,
      discrepancyType: 'damaged',
      reason: claim.reason,
      responsibleParty: 'customer',
      unitPriceCents: claim.unitPriceCents,
      valueCents: claim.claimAmountCents,
      recordedAt: claim.damageRecordedAt,
      status: claim.status,
      claim,
      claimable: false,
    })
  }

  registryRows.sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt))

  const confirmedClaimValue = (claims.data ?? [])
    .filter((claim) => claim.status === 'confirmed')
    .reduce((total, claim) => total + claim.claimAmountCents, 0)
  const customerResponsibleCount = (discrepancies.data?.rows ?? [])
    .filter((row) => row.responsibleParty === 'customer').length
  const currency = discrepancies.data?.currency ?? rankings.data?.currency ?? 'LKR'
  const firstError = [discrepancies.error, rankings.error, claims.error, claimable.error].find(Boolean)

  return (
    <section className="space-y-5">
      <header className="border-b border-border pb-5">
        <h1>Discrepancy &amp; Damage Registry</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Every approved mismatch raised at delivery or return, with its responsible party and claim status.
        </p>
      </header>

      {firstError && <ErrorText error={firstError} fallback="Unable to load the discrepancy registry" />}

      <section aria-label="Discrepancy summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Open records"
          value={discrepancies.isPending ? '—' : String(discrepancies.data?.openCount ?? 0)}
          tone="warning"
        />
        <SummaryCard
          label="Open loss value"
          value={discrepancies.isPending ? '—' : formatMoney(discrepancies.data?.totalValueCents ?? 0, currency)}
          tone="danger"
        />
        <SummaryCard
          label="Claimable to customers"
          value={isFinance
            ? (claimable.isPending ? '—' : String(claimable.data?.length ?? 0))
            : String(customerResponsibleCount)}
          detail={isFinance ? 'Approved damage ready for Finance' : 'Customer-responsible open records'}
        />
        <SummaryCard
          label="Confirmed claims"
          value={claims.isPending ? '—' : formatMoney(confirmedClaimValue, currency)}
          detail="Added to customer balances"
          tone="success"
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-semibold">Registry</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open discrepancies and customer damage claims are shown together.
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            {registryRows.length} records
          </span>
        </div>

        {(discrepancies.isPending || claims.isPending || (isFinance && claimable.isPending)) && (
          <p role="status" aria-live="polite" className="p-6 text-sm text-muted-foreground">
            Loading discrepancy records&hellip;
          </p>
        )}
        {!discrepancies.isPending && !claims.isPending && registryRows.length === 0 && (
          <p className="m-5 rounded-lg bg-success-soft p-4 text-sm text-primary-strong">
            No discrepancy or damage records are currently available.
          </p>
        )}
        {registryRows.length > 0 && (
          <div className="max-h-[36rem] overflow-auto">
            <table className="w-full min-w-[1260px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3">Ref</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Item</th>
                  <th className="px-3 py-3 text-right">Qty</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Reason</th>
                  <th className="px-3 py-3">Responsible</th>
                  <th className="px-3 py-3 text-right">Value</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {registryRows.map((row) => (
                  <tr key={row.discrepancyId} className="border-b border-border align-middle last:border-0">
                    <td className="whitespace-nowrap px-5 py-3.5 font-medium" title={row.discrepancyId}>
                      {formatReference(row.discrepancyId)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-muted-foreground">{formatDate(row.recordedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3.5">
                      {row.orderId && row.orderNumber ? (
                        <Link
                          to="/orders/$orderId"
                          params={{ orderId: row.orderId }}
                          className="font-medium text-primary-strong hover:underline"
                        >
                          {row.orderNumber}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3.5 font-medium">{row.customerName ?? 'No customer'}</td>
                    <td className="px-3 py-3.5">
                      <p className="font-medium">{row.equipmentName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatMoney(row.unitPriceCents, currency)} each
                      </p>
                    </td>
                    <td className="px-3 py-3.5 text-right">{row.quantity}</td>
                    <td className="px-3 py-3.5"><TypeBadge type={row.discrepancyType} /></td>
                    <td className="max-w-56 px-3 py-3.5 text-muted-foreground">{row.reason ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 capitalize">
                      {row.responsibleParty?.replaceAll('_', ' ') ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono font-medium">
                      {formatMoney(row.valueCents, currency)}
                    </td>
                    <td className="px-3 py-3.5"><StatusBadge status={row.status} /></td>
                    <td className="px-5 py-3.5 text-right">
                      <RegistryAction
                        row={row}
                        isFinance={isFinance}
                        draft={draft}
                        confirm={confirm}
                        reject={reject}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft.error && <ErrorText error={draft.error} fallback="Unable to draft claim" padded />}
        {confirm.error && <ErrorText error={confirm.error} fallback="Unable to confirm claim" padded />}
        {reject.error && <ErrorText error={reject.error} fallback="Unable to reject claim" padded />}
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <RankingPanel
          title="Most missing / damaged items"
          rows={rankings.data?.items ?? []}
          currency={currency}
          loading={rankings.isPending}
        />
        <RankingPanel
          title="Customers ranked by loss"
          rows={rankings.data?.customers ?? []}
          currency={currency}
          loading={rankings.isPending}
        />
      </section>
    </section>
  )
}

function RegistryAction({
  row,
  isFinance,
  draft,
  confirm,
  reject,
}: {
  row: RegistryRow
  isFinance: boolean
  draft: ReturnType<typeof useMutation<DamageClaim, Error, string>>
  confirm: ReturnType<typeof useMutation<DamageClaim, Error, string>>
  reject: ReturnType<typeof useMutation<DamageClaim, Error, string>>
}) {
  if (!isFinance) return <span className="text-xs text-muted-foreground">View only</span>

  if (row.claim?.status === 'drafted') {
    return (
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted"
          disabled={reject.isPending || confirm.isPending}
          onClick={() => reject.mutate(row.claim!.id)}
        >
          {reject.isPending && reject.variables === row.claim.id ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-primary-strong bg-primary-strong px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary"
          disabled={confirm.isPending || reject.isPending}
          onClick={() => confirm.mutate(row.claim!.id)}
        >
          {confirm.isPending && confirm.variables === row.claim.id ? 'Confirming…' : 'Confirm'}
        </button>
      </div>
    )
  }

  if (row.claim) return <span className="text-xs text-muted-foreground">Reviewed</span>

  if (row.claimable) {
    return (
      <button
        type="button"
        className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted"
        disabled={draft.isPending}
        onClick={() => draft.mutate(row.discrepancyId)}
      >
        {draft.isPending && draft.variables === row.discrepancyId ? 'Drafting…' : 'Draft claim'}
      </button>
    )
  }

  return <span className="text-xs text-muted-foreground">Not claimable</span>
}

function SummaryCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const valueClass = tone === 'danger'
    ? 'text-danger'
    : tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-foreground'

  return (
    <article className="min-h-28 rounded-xl border border-border bg-card px-5 py-5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h2>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
      {detail && <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>}
    </article>
  )
}

function RankingPanel({
  title,
  rows,
  currency,
  loading,
}: {
  title: string
  rows: DashboardRanking[]
  currency: string
  loading: boolean
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-semibold">{title}</h2>
      </div>
      {loading && <p className="px-5 py-6 text-sm text-muted-foreground">Loading rankings&hellip;</p>}
      {!loading && rows.length === 0 && (
        <p className="px-5 py-6 text-sm text-muted-foreground">No ranked loss records are available.</p>
      )}
      {rows.length > 0 && (
        <ol className="divide-y divide-border px-5">
          {rows.slice(0, 5).map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-5 py-3.5 text-sm">
              <span className="font-medium">{row.name}</span>
              <span className="whitespace-nowrap text-muted-foreground">
                {row.quantity} pcs · {formatMoney(row.valueCents, currency)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function TypeBadge({ type }: { type: RegistryRow['discrepancyType'] }) {
  const className = type === 'damaged'
    ? 'bg-danger-soft text-danger'
    : 'bg-warning-soft text-foreground'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${className}`}>
      {type}
    </span>
  )
}

function StatusBadge({ status }: { status: RegistryStatus }) {
  const className = status === 'confirmed' || status === 'claimed'
    ? 'bg-primary-soft text-primary-strong'
    : status === 'resolved'
      ? 'bg-success-soft text-success'
      : status === 'rejected'
        ? 'bg-danger-soft text-danger'
        : status === 'open'
          ? 'bg-warning-soft text-foreground'
          : 'bg-muted text-muted-foreground'
  const label = status === 'confirmed'
    ? 'Claimed'
    : status.replaceAll('_', ' ')

  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${className}`}>
      {label}
    </span>
  )
}

function formatReference(id: string) {
  return `DIS-${id.replaceAll('-', '').slice(-6).toUpperCase()}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function ErrorText({
  error,
  fallback,
  padded = false,
}: {
  error: Error
  fallback: string
  padded?: boolean
}) {
  return (
    <p role="alert" className={`${padded ? 'px-5 pb-4' : ''} text-sm text-danger`}>
      {error instanceof ApiError ? error.message : fallback}
    </p>
  )
}
