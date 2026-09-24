import type { QuotationInput, QuotationPricingMode, QuotationStatus } from '@herms/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, api, formatMoney, type CreatedQuotation, type EquipmentItem, type QuotationLink, type QuotationSummary } from '../../api'
import { useConfirm } from '../../components/ConfirmDialog'
import { ManualLinkShare } from '../../components/ManualShareActions'
import { SearchableSelect } from '../../components/SearchableSelect'
import { markQuotationResponsesSeen } from '../../quotationNotifications'
import { customersQuery, itemsQuery, queryKeys, quotationsQuery, sessionQuery } from '../../queries'
import { createQuotationShareMessage } from '../../whatsapp'

export const Route = createFileRoute('/_authenticated/quotations')({ component: QuotationsPage })

type DraftLine = { key: string; equipmentItemId: string; quantity: number; customPrice: string }
type ShareState = { quotationNumber: string; customerName: string; submissionLink: string; expiresAt: string }

const emptyLine = (): DraftLine => ({ key: crypto.randomUUID(), equipmentItemId: '', quantity: 1, customPrice: '' })

function QuotationsPage() {
  const quotations = useQuery(quotationsQuery)
  const customers = useQuery(customersQuery)
  const items = useQuery(itemsQuery)
  const session = useQuery(sessionQuery)
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const markedSeen = useRef(false)

  useEffect(() => {
    if (markedSeen.current || !session.data || !quotations.data) return
    markedSeen.current = true
    queryClient.setQueryData(
      queryKeys.quotationResponseSeen(session.data.id),
      markQuotationResponsesSeen(session.data.id, quotations.data),
    )
  }, [quotations.data, queryClient, session.data])
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [share, setShare] = useState<ShareState | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [pricingMode, setPricingMode] = useState<QuotationPricingMode>('standard')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const customer = useQuery(queryOptions({
    queryKey: queryKeys.customer(customerId || 'none'),
    queryFn: () => api.customer(customerId),
    enabled: Boolean(customerId),
    staleTime: 15_000,
  }))

  const create = useMutation({
    mutationFn: api.createQuotation,
    onSuccess: async (quotation) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.quotations })
      setShowCreate(false)
      setShare(toShareState(quotation))
      setCustomerId('')
      setPricingMode('standard')
      setLines([emptyLine()])
    },
  })
  const resend = useMutation({
    mutationFn: async (quotation: QuotationSummary) => ({ quotation, link: await api.quotationLink(quotation.id) }),
    onSuccess: ({ quotation, link }) => setShare(toShareState({ ...quotation, ...link })),
  })
  const convert = useMutation({
    mutationFn: api.convertQuotation,
    onSuccess: async (order) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quotations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.orders }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ])
      await navigate({ to: '/orders/$orderId', params: { orderId: order.id } })
    },
  })

  const metrics = useMemo(() => quotationMetrics(quotations.data ?? []), [quotations.data])
  const selectedIds = new Set(lines.map((line) => line.equipmentItemId).filter(Boolean))
  const actionError = resend.error || convert.error

  const updatePricingMode = (mode: QuotationPricingMode) => {
    setPricingMode(mode)
    if (mode === 'custom') {
      setLines((current) => current.map((line) => ({
        ...line,
        customPrice: line.customPrice || centsToInput(standardPrice(line.equipmentItemId, items.data, customer.data)),
      })))
    }
  }

  const showStockNotice = async (itemName: string, available: number) => {
    await confirm({
      title: 'Not enough stock',
      message: stockShortageMessage(itemName, available),
      confirmLabel: 'OK',
      hideCancel: true,
    })
  }

  const applyLineQuantity = async (key: string, quantity: number, equipmentItemId: string) => {
    if (!Number.isFinite(quantity)) return
    const available = availableStockQty(equipmentItemId, items.data)
    if (equipmentItemId && quantity > available) {
      setLines((current) => current.map((entry) => (
        entry.key === key ? { ...entry, quantity: Math.max(available, 1) } : entry
      )))
      await showStockNotice(itemName(equipmentItemId, items.data), available)
      return
    }
    setLines((current) => current.map((entry) => (
      entry.key === key ? { ...entry, quantity } : entry
    )))
  }

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#071c23]">Quotations</h1>
          <p className="mt-1 text-sm text-[#60727e]">Share a secure link by WhatsApp, SMS, or email</p>
        </div>
        <button className="button-primary" type="button" onClick={() => setShowCreate(true)}>New quotation</button>
      </header>

      <section aria-label="Quotation summary" className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Awaiting response" value={String(metrics.awaiting)} detail={metrics.awaitingLabel} />
        <Metric label="Accepted this month" value={String(metrics.acceptedThisMonth)} tone="success" />
        <Metric label={`Quoted value (${metrics.monthLabel})`} value={formatMoney(metrics.quotedThisMonth)} />
        <Metric label="Conversion rate" value={`${metrics.conversionRate}%`} detail="Last 6 months" />
      </section>

      <section className="mt-5 overflow-hidden rounded-xl border border-[#d6e0e2] bg-white">
        <h2 className="border-b border-[#d6e0e2] px-5 py-4 text-base font-semibold text-[#071c23]">All quotations</h2>
        {quotations.isPending && <p className="p-6 text-sm text-[#60727e]">Loading quotations...</p>}
        {quotations.error && <ErrorMessage error={quotations.error} fallback="Unable to load quotations" />}
        {quotations.data?.length === 0 && <p className="p-6 text-sm text-[#60727e]">No quotations have been created.</p>}
        {quotations.data && quotations.data.length > 0 && (
          <div className="max-h-[31.5rem] overflow-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#d6e0e2]"><tr className="border-b border-[#d6e0e2] text-xs font-medium uppercase tracking-wide text-[#526977]">
                <th className="px-5 py-3">Quotation</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Pricing</th><th className="px-4 py-3">Lines</th><th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Value</th><th className="px-5 py-3 text-right">Action</th>
              </tr></thead>
              <tbody>{quotations.data.map((quotation) => (
                <tr key={quotation.id} className="border-b border-[#e3eaec] last:border-0">
                  <td className="px-5 py-4"><Link className="font-semibold text-[#071c23] hover:text-[#078486] hover:underline" to="/quotations/$quotationId" params={{ quotationId: quotation.id }}>{quotation.quotationNumber}</Link></td>
                  <td className="px-4 py-4 text-[#071c23]">{quotation.customerName}</td>
                  <td className="px-4 py-4 text-[#526977]">{formatDate(quotation.createdAt)}</td>
                  <td className="px-4 py-4"><PricingBadge value={quotation.pricingMode} /></td>
                  <td className="px-4 py-4 text-[#526977]">{quotation.lineCount}</td>
                  <td className="px-4 py-4"><StatusBadge value={quotation.status} /></td>
                  <td className="px-4 py-4 text-right font-medium text-[#071c23]">{formatMoney(quotation.totalValueCents)}</td>
                  <td className="px-5 py-4 text-right"><QuotationAction quotation={quotation} pending={resend.isPending || convert.isPending} onResend={() => resend.mutate(quotation)} onConvert={() => convert.mutate(quotation.id)} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {actionError && <ErrorMessage error={actionError} fallback="Unable to update quotation" />}

      {showCreate && (
        <Modal title="New quotation" onClose={() => !create.isPending && setShowCreate(false)}>
          <form onSubmit={async (event) => {
            event.preventDefault()
            const overstocked = lines.find((line) => (
              line.equipmentItemId && line.quantity > availableStockQty(line.equipmentItemId, items.data)
            ))
            if (overstocked) {
              await showStockNotice(
                itemName(overstocked.equipmentItemId, items.data),
                availableStockQty(overstocked.equipmentItemId, items.data),
              )
              return
            }
            const input: QuotationInput = {
              customerId,
              pricingMode,
              lines: lines.map((line) => ({
                equipmentItemId: line.equipmentItemId,
                quantity: line.quantity,
                ...(pricingMode === 'custom' ? { manualUnitPriceCents: moneyToCents(line.customPrice) } : {}),
              })),
            }
            create.mutate(input)
          }}>
            <SearchableSelect
              className="mt-0"
              label="Customer"
              required
              value={customerId}
              placeholder="Select customer"
              options={customers.data?.map((entry) => ({ value: entry.id, label: entry.name })) ?? []}
              onChange={setCustomerId}
            />

            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-[#071c23]">Pricing</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <PricingChoice checked={pricingMode === 'standard'} title="Standard pricing" detail="Uses a customer special price when available, otherwise the equipment price." onChange={() => updatePricingMode('standard')} />
                <PricingChoice checked={pricingMode === 'custom'} title="Custom pricing" detail="Starts from standard prices; change only the selected items you need." onChange={() => updatePricingMode('custom')} />
              </div>
            </fieldset>

            <div className="mt-5 space-y-3">
              {lines.map((line, index) => {
                const effectivePrice = standardPrice(line.equipmentItemId, items.data, customer.data)
                const available = availableStockQty(line.equipmentItemId, items.data)
                return <div key={line.key} className="rounded-xl border border-[#d6e0e2] p-4">
                  <div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-[#071c23]">Item {index + 1}</p>{lines.length > 1 && <button type="button" className="text-xs font-medium text-[#d72b2b] hover:underline" onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>Remove</button>}</div>
                  <SearchableSelect
                    aria-label={`Equipment for item ${index + 1}`}
                    required
                    value={line.equipmentItemId}
                    placeholder="Select equipment"
                    options={items.data?.map((item) => ({
                      value: item.id,
                      label: item.name,
                      disabled: selectedIds.has(item.id) && item.id !== line.equipmentItemId,
                    })) ?? []}
                    onChange={(equipmentItemId) => {
                      const price = standardPrice(equipmentItemId, items.data, customer.data)
                      const nextAvailable = availableStockQty(equipmentItemId, items.data)
                      if (equipmentItemId && line.quantity > nextAvailable) {
                        void showStockNotice(itemName(equipmentItemId, items.data), nextAvailable)
                      }
                      setLines((current) => current.map((entry) => entry.key === line.key ? {
                        ...entry,
                        equipmentItemId,
                        customPrice: centsToInput(price),
                        quantity: equipmentItemId && line.quantity > nextAvailable ? Math.max(nextAvailable, 1) : entry.quantity,
                      } : entry))
                    }}
                  />
                  <div className={`mt-3 grid gap-3 ${pricingMode === 'custom' ? 'sm:grid-cols-2' : ''}`}>
                    <label className="text-xs font-medium text-[#071c23]">Quantity<input className="input mt-1" type="number" min="1" max={line.equipmentItemId ? Math.max(available, 1) : 1_000_000} step="1" required value={Number.isFinite(line.quantity) ? line.quantity : ''} onChange={(event) => {
                      void applyLineQuantity(line.key, event.currentTarget.valueAsNumber, line.equipmentItemId)
                    }} />{line.equipmentItemId && <span className="mt-1 block font-normal text-[#60727e]">In stock: {available}</span>}</label>
                    {pricingMode === 'custom' && <label className="text-xs font-medium text-[#071c23]">Unit price (LKR)<input className="input mt-1" type="number" min="0.01" max="20000000" step="0.01" required value={line.customPrice} onChange={(event) => {
                      const customPrice = event.currentTarget.value
                      setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, customPrice } : entry))
                    }} /></label>}
                  </div>
                  {line.equipmentItemId && <p className="mt-3 text-xs text-[#60727e]">{pricingMode === 'standard' ? 'Applied price' : 'Standard reference'}: {formatMoney(effectivePrice)}</p>}
                </div>
              })}
              <button type="button" className="button-secondary w-full" disabled={lines.length >= 100} onClick={() => setLines((current) => [...current, emptyLine()])}>Add item</button>
            </div>
            {create.error && <ErrorMessage error={create.error} fallback="Unable to create quotation" />}
            <div className="mt-5 flex justify-end gap-3"><button className="button-secondary" type="button" disabled={create.isPending} onClick={() => setShowCreate(false)}>Cancel</button><button className="button-primary" disabled={create.isPending || !customerId}>{create.isPending ? 'Creating...' : 'Create quotation'}</button></div>
          </form>
        </Modal>
      )}

      {share && (
        <Modal title={`${share.quotationNumber} is ready to share`} onClose={() => setShare(null)}>
          <p className="text-sm leading-6 text-[#526977]">The PDF is available from the quotation details. Share this secure customer link manually; no message is sent automatically.</p>
          <ManualLinkShare link={share.submissionLink} label="Customer quotation link" message={createQuotationShareMessage({ quotationNumber: share.quotationNumber, customerName: share.customerName, submissionLink: share.submissionLink })} />
          <p className="mt-3 text-xs text-[#60727e]">Link expires {new Date(share.expiresAt).toLocaleString()}.</p>
        </Modal>
      )}
    </div>
  )
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'success' }) {
  return <div className="min-h-32 rounded-xl border border-[#d6e0e2] bg-white p-5"><p className="text-xs font-medium uppercase tracking-wide text-[#526977]">{label}</p><p className={`mt-4 text-3xl font-medium ${tone === 'success' ? 'text-[#219a67]' : 'text-[#071c23]'}`}>{value}</p>{detail && <p className="mt-2 text-xs text-[#526977]">{detail}</p>}</div>
}

function PricingChoice({ checked, title, detail, onChange }: { checked: boolean; title: string; detail: string; onChange: () => void }) {
  return <label className={`cursor-pointer rounded-xl border p-4 ${checked ? 'border-[#078486] bg-[#e8f5f5]' : 'border-[#d6e0e2] bg-white'}`}><span className="flex items-center gap-2 text-sm font-semibold text-[#071c23]"><input type="radio" name="pricing-mode" checked={checked} onChange={onChange} />{title}</span><span className="mt-2 block text-xs leading-5 text-[#526977]">{detail}</span></label>
}

function QuotationAction({ quotation, pending, onResend, onConvert }: { quotation: QuotationSummary; pending: boolean; onResend: () => void; onConvert: () => void }) {
  if (quotation.orderId) return <Link className="button-secondary inline-flex" to="/orders/$orderId" params={{ orderId: quotation.orderId }}>View order</Link>
  if (quotation.status === 'accepted') return <button className="button-primary" disabled={pending} type="button" onClick={onConvert}>Convert to order</button>
  if (quotation.status === 'sent') return <button className="button-secondary" disabled={pending} type="button" onClick={onResend}>Resend</button>
  return <button className="button-secondary opacity-50" disabled type="button">Resend</button>
}

function PricingBadge({ value }: { value: QuotationPricingMode }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${value === 'standard' ? 'bg-[#d9f3f3] text-[#006e71]' : 'bg-[#edf1f2] text-[#526977]'}`}>{value === 'standard' ? 'Standard' : 'Custom'}</span>
}

function StatusBadge({ value }: { value: QuotationStatus }) {
  const styles: Record<QuotationStatus, string> = { sent: 'bg-[#d9f3f3] text-[#006e71]', accepted: 'bg-[#e3f3eb] text-[#219a67]', rejected: 'bg-[#fde5e5] text-[#d72b2b]', expired: 'bg-[#edf1f2] text-[#60727e]' }
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[value]}`}>{value === 'sent' ? 'Sent' : value[0]!.toUpperCase() + value.slice(1)}</span>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#071c23]/45 px-4 py-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section aria-modal="true" aria-labelledby="quotation-modal-title" role="dialog" className="w-full max-w-2xl rounded-2xl border border-[#d6e0e2] bg-white p-6 shadow-xl"><header className="mb-5 flex items-start justify-between gap-4"><h2 id="quotation-modal-title" className="text-xl font-semibold text-[#071c23]">{title}</h2><button aria-label="Close dialog" className="rounded-lg p-2 text-[#526977] hover:bg-[#edf3f4]" type="button" onClick={onClose}>✕</button></header>{children}</section></div>
}

function quotationMetrics(rows: QuotationSummary[]) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const recent = rows.filter((row) => new Date(row.createdAt) >= sixMonthsAgo)
  const awaitingRows = rows.filter((row) => row.status === 'sent')
  const awaiting = awaitingRows.length
  const acceptedThisMonth = rows.filter((row) => row.status === 'accepted' && new Date(row.updatedAt) >= monthStart).length
  const quotedThisMonth = rows.filter((row) => new Date(row.createdAt) >= monthStart && row.status !== 'rejected').reduce((total, row) => total + row.totalValueCents, 0)
  const conversionRate = recent.length ? Math.round(recent.filter((row) => row.status === 'accepted').length / recent.length * 100) : 0
  return { awaiting, awaitingLabel: awaitingRows[0]?.quotationNumber, acceptedThisMonth, quotedThisMonth, conversionRate, monthLabel: now.toLocaleString('en', { month: 'short' }).toUpperCase() }
}

function availableStockQty(itemId: string, items: EquipmentItem[] | undefined) {
  if (!itemId) return 0
  return items?.find((item) => item.id === itemId)?.currentStockQty ?? 0
}

function itemName(itemId: string, items: EquipmentItem[] | undefined) {
  return items?.find((item) => item.id === itemId)?.name ?? 'this item'
}

function stockShortageMessage(name: string, available: number) {
  if (available <= 0) return `${name} has no stock available, so it cannot be quoted.`
  return `${name} has only ${available} in stock. You cannot add more than the available quantity.`
}

function standardPrice(itemId: string, items: Awaited<ReturnType<typeof api.items>> | undefined, customer: Awaited<ReturnType<typeof api.customer>> | undefined) {
  if (!itemId) return 0
  return customer?.prices.find((price) => price.equipmentItemId === itemId && !price.effectiveTo)?.unitPriceCents
    ?? items?.find((item) => item.id === itemId)?.currentUnitPriceCents
    ?? 0
}

function moneyToCents(value: string) { return Math.round(Number(value) * 100) }
function centsToInput(value: number) { return value > 0 ? (value / 100).toFixed(2) : '' }
function formatDate(value: string) { return new Date(value).toLocaleDateString('en-CA') }
function toShareState(value: Pick<CreatedQuotation, 'quotationNumber' | 'customerName' | 'submissionLink' | 'expiresAt'> | (QuotationSummary & QuotationLink)): ShareState { return { quotationNumber: value.quotationNumber, customerName: value.customerName, submissionLink: value.submissionLink, expiresAt: value.expiresAt! } }
function ErrorMessage({ error, fallback }: { error: Error; fallback: string }) { return <p role="alert" className="mt-4 rounded-xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">{error instanceof ApiError ? error.message : fallback}</p> }
