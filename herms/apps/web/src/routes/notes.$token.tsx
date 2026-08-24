import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ApiError, api } from '../api'

export const Route = createFileRoute('/notes/$token')({ component: TokenNotePage })

function TokenNotePage() {
  const { token } = Route.useParams()
  const note = useQuery(queryOptions({ queryKey: ['token-note', token], queryFn: () => api.tokenNote(token), retry: false }))
  const submit = useMutation({ mutationFn: api.submitTokenNote.bind(null, token) })
  if (note.isPending) return <PublicShell><p className="text-muted-foreground">Opening delivery note...</p></PublicShell>
  if (!note.data) return <PublicShell><p role="alert" className="text-danger">{note.error instanceof ApiError ? note.error.message : 'This delivery note link is unavailable'}</p></PublicShell>
  if (submit.isSuccess) return <PublicShell><div className="rounded-2xl bg-success-soft p-6"><h1 className="text-2xl font-semibold">Submitted for approval</h1><p className="mt-2 text-muted-foreground">You may use this link to correct the quantities until store counting begins.</p></div></PublicShell>
  const data = note.data
  return <PublicShell><p className="text-sm font-semibold uppercase tracking-widest text-primary">Field handover</p><h1 className="mt-2 text-3xl font-semibold">{data.dnNumber}</h1><p className="mt-2 text-muted-foreground">{data.customerName} · {data.orderNumber}</p><form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); submit.mutate({ lines: data.lines.map((line) => ({ lineId: line.id, handedOverQty: Number(form.get(`qty-${line.id}`)), mismatchReason: (String(form.get(`reason-${line.id}`) || '') || null) as 'missing' | 'damaged' | 'not_accepted' | 'other' | null, mismatchDetail: String(form.get(`detail-${line.id}`) || '') || null })) }) }}>
    {data.lines.map((line) => <fieldset key={line.id} className="rounded-2xl border border-border bg-card p-5"><legend className="px-2 font-semibold">{line.equipmentName}</legend><p className="text-sm text-muted-foreground">Issued: {line.issuedQty} {line.unitOfMeasure}</p><label className="mt-4 block text-sm font-medium">Handed over<input className="input mt-2" name={`qty-${line.id}`} type="number" min="0" step="1" defaultValue={line.handedOverQty} required /></label><label className="mt-3 block text-sm font-medium">Mismatch reason<select className="input mt-2" name={`reason-${line.id}`} defaultValue={line.mismatchReason ?? ''}><option value="">No mismatch</option><option value="damaged">Damaged</option><option value="missing">Missing</option><option value="not_accepted">Not Accepted</option><option value="other">Other</option></select></label><label className="mt-3 block text-sm font-medium">Details<input className="input mt-2" name={`detail-${line.id}`} defaultValue={line.mismatchDetail ?? ''} maxLength={500} /></label></fieldset>)}
    {submit.error && <p role="alert" className="text-sm text-danger">{submit.error instanceof ApiError ? submit.error.message : 'Unable to submit delivery note'}</p>}<button className="button-primary w-full" disabled={submit.isPending}>{submit.isPending ? 'Submitting...' : 'Submit for approval'}</button>
  </form></PublicShell>
}

function PublicShell({ children }: { children: React.ReactNode }) { return <main className="mx-auto min-h-screen max-w-xl px-5 py-10 text-foreground"><div className="mb-8"><p className="text-xl font-bold text-primary-strong">HERMS</p><p className="text-xs text-muted-foreground">Secure delivery note</p></div>{children}</main> }
