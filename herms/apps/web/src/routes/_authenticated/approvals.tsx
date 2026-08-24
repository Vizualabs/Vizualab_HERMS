import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError } from '../../api'
import { approvalsQuery } from '../../queries'

export const Route = createFileRoute('/_authenticated/approvals')({ component: ApprovalsPage })

function ApprovalsPage() {
  const approvals = useQuery(approvalsQuery)
  return <section><p className="text-sm font-semibold uppercase tracking-widest text-primary">Store control</p><h1 className="mt-2 text-3xl font-semibold">Approval queue</h1><p className="mt-2 text-muted-foreground">Physically count every line before stock can move.</p><div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">{approvals.isPending && <p className="p-6 text-muted-foreground">Loading approvals...</p>}{approvals.error && <p role="alert" className="p-6 text-danger">{approvals.error instanceof ApiError ? approvals.error.message : 'Unable to load approvals'}</p>}<ul className="divide-y divide-border">{approvals.data?.map((note) => <li key={note.id}><Link to="/approvals/$noteId" params={{ noteId: note.id }} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted"><div><p className="font-semibold">{note.dnNumber}</p><p className="mt-1 text-sm text-muted-foreground">{note.customerName} · {note.orderNumber}</p></div><span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold capitalize text-primary-strong">{note.status.replaceAll('_', ' ')}</span></Link></li>)}</ul>{approvals.data?.length === 0 && <p className="p-6 text-muted-foreground">No delivery notes await action.</p>}</div></section>
}
