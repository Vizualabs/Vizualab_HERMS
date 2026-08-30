import { REQUEST_ID_HEADER } from '@herms/shared'
import type {
  CustomerInput,
  ClaimStatus,
  CustomerType,
  EquipmentInput,
  ManualPriceChangeReason,
  PriceChangeReason,
  RecurringCustomerInput,
  SessionUser,
  QuotationInput,
  QuotationStatus,
  OrderStatus,
  NoteStatus,
  DiscrepancyType,
  DeliveryNoteSubmission,
  DeliveryNoteCount,
  DeliveryNoteCreate,
  ExpenseInput,
  PaymentInput,
  PaymentMethod,
  RetentionNoteCreate,
  RetentionNoteSubmission,
  RetentionNoteCount,
  DashboardDiscrepancies,
  DashboardEscalations,
  DashboardFilterOptions,
  DashboardFilters,
  DashboardIncomeExpenses,
  DashboardPayments,
  DashboardRankings,
  DashboardStock,
} from '@herms/shared'

export type Customer = {
  id: string
  storeId: string
  name: string
  type: CustomerType
  phone: string | null
  email: string | null
  address: string | null
  outstandingBalanceCents: number
  createdAt: string
  updatedAt: string
}

export type CustomerPrice = {
  id: string
  customerId: string
  equipmentItemId: string
  unitPriceCents: number
  effectiveFrom: string
  effectiveTo: string | null
}

export type CustomerDetail = Customer & { prices: CustomerPrice[] }

export type EquipmentItem = {
  id: string
  name: string
  category: string
  unitOfMeasure: string
  currentUnitPriceCents: number
  reorderThreshold: number | null
  createdAt: string
  updatedAt: string
}

export type PriceEscalationItem = {
  itemId: string
  itemName: string
  oldPriceCents: number
  newPriceCents: number
}

export type PriceEscalationResult = {
  effectiveDate: string
  replayed: boolean
  items: PriceEscalationItem[]
}

export type PriceHistoryEntry = {
  id: string
  equipmentItemId: string
  oldPriceCents: number | null
  newPriceCents: number
  effectiveDate: string
  reason: PriceChangeReason
  createdBy: string | null
  createdAt: string
}

export type CommercialLine = {
  id: string
  equipmentItemId: string
  equipmentName: string
  unitOfMeasure: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export type QuotationSummary = {
  id: string
  quotationNumber: string
  customerId: string
  customerName: string
  status: QuotationStatus
  totalValueCents: number
  createdAt: string
  expiresAt: string | null
}

export type QuotationDetail = QuotationSummary & {
  customerType: CustomerType
  customerPhone: string | null
  customerEmail: string | null
  customerAddress: string | null
  storeName: string
  storeAddress: string | null
  currency: string
  timezone: string
  sentAt: string | null
  updatedAt: string
  lines: CommercialLine[]
}

export type OrderSummary = {
  id: string
  orderNumber: string
  quotationId: string | null
  customerId: string
  customerName: string
  status: OrderStatus
  totalValueCents: number
  createdAt: string
}

export type OrderDetail = OrderSummary & {
  currency: string
  timezone: string
  updatedAt: string
  lines: CommercialLine[]
}

export type Invoice = {
  id: string
  orderNumber: string
  quotationId: string | null
  customerId: string
  customerName: string
  status: OrderStatus
  createdAt: string
  orderValueCents: number
  claimAmountCents: number
  invoiceValueCents: number
  paidAmountCents: number
  outstandingBalanceCents: number
  currency: string
  lines: CommercialLine[]
}

export type Payment = {
  id: string
  orderId: string
  customerId: string
  amountCents: number
  paymentDate: string
  method: PaymentMethod
  createdBy: string | null
  createdAt: string
}

export type CustomerBalance = {
  id: string
  name: string
  outstandingBalanceCents: number
  currency: string
  orders: Array<{
    id: string
    orderNumber: string
    status: OrderStatus
    orderValueCents: number
    claimAmountCents: number
    invoiceValueCents: number
    paidAmountCents: number
    outstandingBalanceCents: number
  }>
}

export type ClaimableDiscrepancy = {
  id: string
  orderId: string
  orderNumber: string
  customerId: string
  customerName: string
  equipmentItemId: string
  equipmentName: string
  quantity: number
  reason: string | null
  status: 'open' | 'written_off'
  damageRecordedAt: string
  unitPriceCents: number
  claimAmountCents: number
}

export type DamageClaim = {
  id: string
  discrepancyId: string
  orderId: string | null
  orderNumber: string | null
  customerId: string
  customerName: string
  equipmentItemId: string
  equipmentName: string
  quantity: number
  unitPriceCents: number
  claimAmountCents: number
  status: ClaimStatus
  confirmedBy: string | null
  confirmedAt: string | null
  damageRecordedAt: string
  reason: string | null
  createdAt: string
  updatedAt: string
}

export type Expense = {
  id: string
  category: string
  amountCents: number
  expenseDate: string
  description: string | null
  createdBy: string | null
  createdAt: string
}

export type MonthlyFinance = {
  month: string
  incomeCents: number
  expenseCents: number
  netPositionCents: number
  currency: string
  timezone: string
}

export type DeliveryNoteLine = {
  id: string
  equipmentItemId: string
  equipmentName: string
  unitOfMeasure: string
  issuedQty: number
  handedOverQty: number
  countedQty: number | null
  mismatchReason: DiscrepancyType | null
  mismatchDetail: string | null
  countDifference: number | null
}

export type DeliveryNoteSummary = {
  id: string
  dnNumber: string
  orderId: string
  storeId: string | null
  status: NoteStatus
  createdAt: string
  submittedAt: string | null
  approvedAt: string | null
  orderNumber?: string
  customerName?: string
}

export type DeliveryNoteDetail = DeliveryNoteSummary & {
  noteType: 'delivery_note'
  orderNumber: string
  customerId: string
  customerName: string
  customerAddress: string | null
  storeName: string | null
  storeAddress: string | null
  submittedBy: string | null
  submittedByName: string | null
  approvedBy: string | null
  approvedByName: string | null
  updatedAt: string
  lines: DeliveryNoteLine[]
  submissionLink?: string
  tokenExpiresAt?: string
}

export type RetentionNoteLine = {
  id: string
  equipmentItemId: string
  equipmentName: string
  unitOfMeasure: string
  deliveredQty: number
  returnedQty: number
  balanceQty: number
  missingDamagedQty: number
  countedReturnedQty: number | null
  mismatchReason: 'missing' | 'damaged' | 'other' | null
  responsibleParty: 'customer' | 'staff_member' | null
  reasonDetail: string | null
  countDifference: number | null
  discrepancyId: string | null
  discrepancyStatus: 'open' | 'resolved' | 'written_off' | 'claimed' | null
  writeOffLedgerId: string | null
  writeOffCreatedAt: string | null
  writeOffReversed: boolean
}

export type RetentionNoteSummary = {
  id: string
  rnNumber: string
  orderId: string
  storeId: string | null
  status: NoteStatus
  createdAt: string
  submittedAt: string | null
  approvedAt: string | null
}

export type RetentionNoteDetail = RetentionNoteSummary & {
  noteType: 'retention_note'
  orderNumber: string
  customerId: string
  customerName: string
  deliveryNoteId: string | null
  deliveryNoteNumber: string | null
  customerAddress: string | null
  storeName: string | null
  storeAddress: string | null
  submittedBy: string | null
  submittedByName: string | null
  approvedBy: string | null
  approvedByName: string | null
  updatedAt: string
  lines: RetentionNoteLine[]
  submissionLink?: string
  tokenExpiresAt?: string
}

export type ApprovalSummary = {
  id: string
  noteType: 'delivery_note' | 'retention_note'
  dnNumber?: string
  rnNumber?: string
  orderId: string
  orderNumber: string
  customerName: string
  status: NoteStatus
  submittedAt: string | null
  createdAt: string
}

export type ReconciliationLine = {
  equipmentItemId: string
  equipmentName: string
  deliveredQty: number
  returnedQty: number
  balanceQty: number
  missingDamagedQty: number
  accountedQty: number
}

export type TokenNote = DeliveryNoteDetail | RetentionNoteDetail

export type NoteLink = { submissionLink: string; expiresAt: string }
export type FieldStaffRecipient = {
  id: string
  name: string
  phoneMasked: string
}
export type StockItem = {
  equipmentItemId: string
  equipmentName: string
  unitOfMeasure: string
  quantity: number
  reorderThreshold: number | null
  reorderAlertId: string | null
  reorderAlertOpenedAt: string | null
  isBelowReorderThreshold: boolean
  currentUnitPriceCents: number
  valueCents: number
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const payload = (await response.json()) as {
    data?: T
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message ?? 'The request failed',
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
    )
  }
  return payload.data as T
}

function dashboardQuery(filters: DashboardFilters = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value)
  }
  return query.toString()
}

async function downloadDashboardExport(
  format: 'pdf' | 'xlsx',
  filters: DashboardFilters,
) {
  const query = dashboardQuery({ ...filters })
  const response = await fetch(
    `/api/dashboard/export?format=${format}${query ? `&${query}` : ''}`,
    { credentials: 'same-origin' },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string }
    } | null
    throw new ApiError(
      payload?.error?.message ?? 'The report could not be downloaded',
      response.status,
      payload?.error?.code ?? 'EXPORT_FAILED',
    )
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
    ?? `herms-management-report.${format}`
  return { blob: await response.blob(), filename }
}

export const api = {
  login: (email: string, password: string) =>
    request<SessionUser>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () =>
    request<never>('/api/auth/logout', { method: 'POST', body: '{}' }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) return undefined as never
      throw error
    }),
  me: () => request<SessionUser>('/api/me'),
  customers: () => request<Customer[]>('/api/customers'),
  customer: (id: string) => request<CustomerDetail>(`/api/customers/${id}`),
  createCustomer: (input: CustomerInput) =>
    request<Customer>('/api/customers', { method: 'POST', body: JSON.stringify(input) }),
  updateCustomer: (id: string, input: Partial<CustomerInput>) =>
    request<Customer>(`/api/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  setRecurring: (id: string, input: RecurringCustomerInput) =>
    request<CustomerDetail>(`/api/customers/${id}/recurring`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  items: () => request<EquipmentItem[]>('/api/items'),
  item: (id: string) => request<EquipmentItem>(`/api/items/${id}`),
  createItem: (input: EquipmentInput) =>
    request<EquipmentItem>('/api/items', { method: 'POST', body: JSON.stringify(input) }),
  updateItem: (id: string, input: Partial<Omit<EquipmentInput, 'currentUnitPriceCents'>>) =>
    request<EquipmentItem>(`/api/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  changePrice: (id: string, newPriceCents: number, reason: ManualPriceChangeReason) =>
    request<EquipmentItem>(`/api/items/${id}/price`, {
      method: 'POST',
      body: JSON.stringify({ newPriceCents, reason }),
    }),
  priceHistory: (id: string) =>
    request<PriceHistoryEntry[]>(`/api/items/${id}/price-history`),
  priceEscalationPreview: () =>
    request<PriceEscalationItem[]>('/api/price-escalation'),
  applyPriceEscalation: () =>
    request<PriceEscalationResult>('/api/price-escalation', {
      method: 'POST',
      headers: { [REQUEST_ID_HEADER]: crypto.randomUUID() },
      body: '{}',
    }),
  quotations: () => request<QuotationSummary[]>('/api/quotations'),
  quotation: (id: string) => request<QuotationDetail>(`/api/quotations/${id}`),
  createQuotation: (input: QuotationInput) =>
    request<QuotationDetail>('/api/quotations', { method: 'POST', body: JSON.stringify(input) }),
  acceptQuotation: (id: string) =>
    request<OrderDetail>(`/api/quotations/${id}/accept`, { method: 'POST', body: '{}' }),
  rejectQuotation: (id: string) =>
    request<QuotationDetail>(`/api/quotations/${id}/reject`, { method: 'POST', body: '{}' }),
  expireQuotation: (id: string) =>
    request<QuotationDetail>(`/api/quotations/${id}/expire`, { method: 'POST', body: '{}' }),
  orders: () => request<OrderSummary[]>('/api/orders'),
  order: (id: string) => request<OrderDetail>(`/api/orders/${id}`),
  invoice: (id: string) => request<Invoice>(`/api/orders/${id}/invoice`),
  recordPayment: (input: PaymentInput) =>
    request<Payment>('/api/payments', { method: 'POST', body: JSON.stringify(input) }),
  customerBalance: (id: string) =>
    request<CustomerBalance>(`/api/customers/${id}/balance`),
  recordExpense: (input: ExpenseInput) =>
    request<Expense>('/api/expenses', { method: 'POST', body: JSON.stringify(input) }),
  monthlyFinance: (month: string) =>
    request<MonthlyFinance>(`/api/finance/monthly?month=${encodeURIComponent(month)}`),
  claimableDiscrepancies: () =>
    request<ClaimableDiscrepancy[]>('/api/discrepancies/claimable'),
  claims: () => request<DamageClaim[]>('/api/claims'),
  draftClaim: (discrepancyId: string) =>
    request<DamageClaim>(`/api/discrepancies/${discrepancyId}/claim`, {
      method: 'POST', body: '{}',
    }),
  confirmClaim: (id: string) =>
    request<DamageClaim>(`/api/claims/${id}/confirm`, { method: 'POST', body: '{}' }),
  rejectClaim: (id: string) =>
    request<DamageClaim>(`/api/claims/${id}/reject`, { method: 'POST', body: '{}' }),
  fieldStaffRecipients: () =>
    request<FieldStaffRecipient[]>('/api/notification-recipients/field-staff'),
  deliveryNotes: (orderId: string) => request<DeliveryNoteSummary[]>(`/api/orders/${orderId}/delivery-notes`),
  createDeliveryNote: (orderId: string, input: DeliveryNoteCreate) => request<DeliveryNoteDetail>(`/api/orders/${orderId}/delivery-notes`, { method: 'POST', body: JSON.stringify(input) }),
  deliveryNote: (id: string) => request<DeliveryNoteDetail>(`/api/delivery-notes/${id}`),
  deliveryNoteLink: (id: string) => request<NoteLink>(`/api/delivery-notes/${id}/link`),
  regenerateDeliveryNoteLink: (id: string) =>
    request<NoteLink>(`/api/delivery-notes/${id}/resend-link`, {
      method: 'POST',
      body: '{}',
    }),
  tokenNote: (token: string) => request<TokenNote>(`/api/notes/token/${encodeURIComponent(token)}`),
  submitTokenNote: (token: string, input: DeliveryNoteSubmission | RetentionNoteSubmission) => request<TokenNote>(`/api/notes/token/${encodeURIComponent(token)}/submit`, { method: 'POST', body: JSON.stringify(input) }),
  retentionNotes: (orderId: string) => request<RetentionNoteSummary[]>(`/api/orders/${orderId}/retention-notes`),
  createRetentionNote: (orderId: string, input: RetentionNoteCreate) => request<RetentionNoteDetail>(`/api/orders/${orderId}/retention-notes`, { method: 'POST', body: JSON.stringify(input) }),
  retentionNote: (id: string) => request<RetentionNoteDetail>(`/api/retention-notes/${id}`),
  retentionNoteLink: (id: string) => request<NoteLink>(`/api/retention-notes/${id}/link`),
  regenerateRetentionNoteLink: (id: string) =>
    request<NoteLink>(`/api/retention-notes/${id}/resend-link`, {
      method: 'POST',
      body: '{}',
    }),
  approvals: () => request<ApprovalSummary[]>('/api/approvals'),
  approvalNote: (id: string) => request<TokenNote>(`/api/approvals/${id}`),
  countDeliveryNote: (id: string, input: DeliveryNoteCount) => request<DeliveryNoteDetail>(`/api/approvals/${id}/count`, { method: 'POST', body: JSON.stringify(input) }),
  approveDeliveryNote: (id: string) => request<DeliveryNoteDetail>(`/api/approvals/${id}/approve`, { method: 'POST', body: '{}' }),
  rejectDeliveryNote: (id: string) => request<DeliveryNoteDetail>(`/api/approvals/${id}/reject`, { method: 'POST', body: '{}' }),
  reopenDeliveryNote: (id: string) => request<DeliveryNoteDetail>(`/api/approvals/${id}/reopen`, { method: 'POST', body: '{}' }),
  countRetentionNote: (id: string, input: RetentionNoteCount) => request<RetentionNoteDetail>(`/api/approvals/${id}/count`, { method: 'POST', body: JSON.stringify(input) }),
  approveRetentionNote: (id: string) => request<RetentionNoteDetail>(`/api/approvals/${id}/approve`, { method: 'POST', body: '{}' }),
  rejectRetentionNote: (id: string) => request<RetentionNoteDetail>(`/api/approvals/${id}/reject`, { method: 'POST', body: '{}' }),
  reopenRetentionNote: (id: string) => request<RetentionNoteDetail>(`/api/approvals/${id}/reopen`, { method: 'POST', body: '{}' }),
  closeOrder: (id: string) => request<{ order: OrderDetail; reconciliation: ReconciliationLine[] }>(`/api/orders/${id}/close`, { method: 'POST', body: '{}' }),
  reverseWriteOff: (id: string, reason: string) => request<{ discrepancy: { id: string; status: string }; reversalLedgerId: string }>(`/api/discrepancies/${id}/write-off-reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),
  stock: () => request<StockItem[]>('/api/stock'),
  dashboardFilterOptions: () =>
    request<DashboardFilterOptions>('/api/dashboard/filter-options'),
  dashboardStock: () => request<DashboardStock>('/api/dashboard/stock'),
  dashboardPayments: (month?: string) =>
    request<DashboardPayments>(
      `/api/dashboard/payments${month ? `?month=${encodeURIComponent(month)}` : ''}`,
    ),
  dashboardIncomeExpenses: (month?: string) =>
    request<DashboardIncomeExpenses>(
      `/api/dashboard/income-expenses${month ? `?month=${encodeURIComponent(month)}` : ''}`,
    ),
  dashboardDiscrepancies: (filters: DashboardFilters) =>
    request<DashboardDiscrepancies>(
      `/api/dashboard/discrepancies?${dashboardQuery(filters)}`,
    ),
  dashboardRankings: (filters: DashboardFilters) =>
    request<DashboardRankings>(`/api/dashboard/rankings?${dashboardQuery(filters)}`),
  dashboardEscalations: () =>
    request<DashboardEscalations>('/api/dashboard/escalations'),
  downloadDashboardExport,
}

export function formatMinorUnits(value: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)
}

export function formatMoney(value: number, currency = 'LKR') {
  return `${currency} ${formatMinorUnits(value)}`
}
