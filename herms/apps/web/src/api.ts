import type {
  CustomerInput,
  CustomerType,
  EquipmentInput,
  PriceChangeReason,
  RecurringCustomerInput,
  SessionUser,
  QuotationInput,
  QuotationStatus,
  OrderStatus,
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
  changePrice: (id: string, newPriceCents: number, reason: PriceChangeReason) =>
    request<EquipmentItem>(`/api/items/${id}/price`, {
      method: 'POST',
      body: JSON.stringify({ newPriceCents, reason }),
    }),
  priceHistory: (id: string) =>
    request<PriceHistoryEntry[]>(`/api/items/${id}/price-history`),
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
