import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api, formatMoney, type DamageClaim } from '../../api'
import {
  claimableDiscrepanciesQuery,
  claimsQuery,
  queryKeys,
  sessionQuery,
} from '../../queries'

export const Route = createFileRoute('/_authenticated/claims')({
  component: ClaimsPage,
})

function ClaimsPage() {
  const queryClient = useQueryClient()
  const session = useQuery(sessionQuery)
  const isFinance = session.data?.role === 'finance' || session.data?.role === 'super_user'
  const canView = isFinance || session.data?.role === 'business_owner'
  const claims = useQuery({ ...claimsQuery, enabled: canView })
  const claimable = useQuery({ ...claimableDiscrepanciesQuery, enabled: isFinance })

  const refresh = async (claim?: DamageClaim) => {
    const invalidations: Array<Promise<unknown>> = [
      queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
      queryClient.invalidateQueries({ queryKey: queryKeys.claimableDiscrepancies }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]
    if (claim) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.customerBalance(claim.customerId) }),
      )
      if (claim.orderId) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: queryKeys.invoice(claim.orderId) }),
        )
      }
    }
    await Promise.all(invalidations)
  }

  const draft = useMutation({
    mutationFn: api.draftClaim,
    onSuccess: refresh,
  })
  const confirm = useMutation({
    mutationFn: api.confirmClaim,
    onSuccess: refresh,
  })
  const reject = useMutation({
    mutationFn: api.rejectClaim,
    onSuccess: refresh,
  })

  if (!canView) {
    return (
      <p role="alert" className="rounded-2xl border border-border bg-card p-6 text-danger">
        Damage claims are restricted to Finance and Business Owner roles.
      </p>
    )
  }

  return (
    <section>
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">Phase 7</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Damage claims</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Claim values use the price in effect when damage was recorded. Customer balances change
        only after Finance confirmation.
      </p>

      {isFinance && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Claimable damage</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Approved, customer-responsible damaged discrepancies without an existing claim.
              </p>
            </div>
            <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary-strong">
              {claimable.data?.length ?? 0} ready
            </span>
          </div>
          {claimable.isPending && <p className="mt-5 text-muted-foreground">Loading claimable damage...</p>}
          {claimable.error && <ErrorText error={claimable.error} fallback="Unable to load claimable damage" />}
          {claimable.data?.length === 0 && (
            <p className="mt-5 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              No approved customer-responsible damage is waiting for a claim.
            </p>
          )}
          {claimable.data && claimable.data.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-3xl text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-3">Damage</th>
                    <th>Customer / order</th>
                    <th className="text-right">Historical price</th>
                    <th className="text-right">Claim value</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {claimable.data.map((row) => (
                    <tr key={row.id} className="border-b border-border align-top">
                      <td className="py-4">
                        <p className="font-medium">{row.quantity} x {row.equipmentName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Recorded {formatDate(row.damageRecordedAt)}
                        </p>
                        {row.reason && <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>}
                      </td>
                      <td className="py-4">
                        <p>{row.customerName}</p>
                        <Link
                          to="/orders/$orderId"
                          params={{ orderId: row.orderId }}
                          className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                        >
                          {row.orderNumber}
                        </Link>
                      </td>
                      <td className="py-4 text-right font-mono">{formatMoney(row.unitPriceCents)}</td>
                      <td className="py-4 text-right font-mono font-semibold">{formatMoney(row.claimAmountCents)}</td>
                      <td className="py-4 text-right">
                        <button
                          className="button-primary"
                          type="button"
                          disabled={draft.isPending}
                          onClick={() => draft.mutate(row.id)}
                        >
                          {draft.isPending && draft.variables === row.id
                            ? 'Drafting...'
                            : 'Draft claim'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {draft.error && <ErrorText error={draft.error} fallback="Unable to draft claim" />}
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Claim register</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Drafts have no balance effect. Confirmed claims become payable against their order.
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">
            {claims.data?.length ?? 0} total
          </span>
        </div>
        {claims.isPending && <p className="mt-5 text-muted-foreground">Loading claims...</p>}
        {claims.error && <ErrorText error={claims.error} fallback="Unable to load claims" />}
        {claims.data?.length === 0 && (
          <p className="mt-5 rounded-xl bg-muted p-4 text-sm text-muted-foreground">No damage claims have been drafted.</p>
        )}
        {claims.data && claims.data.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-4xl text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-3">Claim</th>
                  <th>Damage date</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Unit price</th>
                  <th className="text-right">Value</th>
                  <th>Status</th>
                  {isFinance && <th className="text-right">Review</th>}
                </tr>
              </thead>
              <tbody>
                {claims.data.map((claim) => (
                  <tr key={claim.id} className="border-b border-border align-top">
                    <td className="py-4">
                      <p className="font-medium">{claim.equipmentName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{claim.customerName}</p>
                      {claim.orderId && claim.orderNumber && (
                        <Link
                          to="/orders/$orderId"
                          params={{ orderId: claim.orderId }}
                          className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                        >
                          {claim.orderNumber}
                        </Link>
                      )}
                    </td>
                    <td className="py-4">{formatDate(claim.damageRecordedAt)}</td>
                    <td className="py-4 text-right">{claim.quantity}</td>
                    <td className="py-4 text-right font-mono">{formatMoney(claim.unitPriceCents)}</td>
                    <td className="py-4 text-right font-mono font-semibold">{formatMoney(claim.claimAmountCents)}</td>
                    <td className="py-4"><Status status={claim.status} /></td>
                    {isFinance && (
                      <td className="py-4 text-right">
                        {claim.status === 'drafted' ? (
                          <div className="flex justify-end gap-2">
                            <button
                              className="button-secondary"
                              type="button"
                              disabled={reject.isPending || confirm.isPending}
                              onClick={() => reject.mutate(claim.id)}
                            >
                              {reject.isPending && reject.variables === claim.id
                                ? 'Rejecting...'
                                : 'Reject'}
                            </button>
                            <button
                              className="button-primary"
                              type="button"
                              disabled={confirm.isPending || reject.isPending}
                              onClick={() => confirm.mutate(claim.id)}
                            >
                              {confirm.isPending && confirm.variables === claim.id
                                ? 'Confirming...'
                                : 'Confirm'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Reviewed</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {confirm.error && <ErrorText error={confirm.error} fallback="Unable to confirm claim" />}
        {reject.error && <ErrorText error={reject.error} fallback="Unable to reject claim" />}
      </section>
    </section>
  )
}

function Status({ status }: { status: DamageClaim['status'] }) {
  const className = status === 'confirmed'
    ? 'bg-success-soft text-primary-strong'
    : status === 'rejected'
      ? 'bg-danger-soft text-danger'
      : 'bg-muted text-foreground'
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {status}
    </span>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value))
}

function ErrorText({ error, fallback }: { error: Error; fallback: string }) {
  return (
    <p role="alert" className="mt-4 text-sm text-danger">
      {error instanceof ApiError ? error.message : fallback}
    </p>
  )
}
