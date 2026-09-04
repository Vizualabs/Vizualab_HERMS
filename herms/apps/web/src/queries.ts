import { queryOptions } from '@tanstack/react-query'
import type { DashboardFilters } from '@herms/shared'

import { api } from './api'

export const queryKeys = {
  session: ['session'] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', id] as const,
  items: ['items'] as const,
  item: (id: string) => ['items', id] as const,
  priceHistory: (id: string) => ['items', id, 'price-history'] as const,
  priceEscalation: ['price-escalation'] as const,
  quotations: ['quotations'] as const,
  quotation: (id: string) => ['quotations', id] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['orders', id] as const,
  fieldStaffRecipients: ['notification-recipients', 'field-staff'] as const,
  deliveryNotes: (orderId: string) => ['orders', orderId, 'delivery-notes'] as const,
  deliveryNote: (id: string) => ['delivery-notes', id] as const,
  retentionNotes: (orderId: string) => ['orders', orderId, 'retention-notes'] as const,
  retentionNote: (id: string) => ['retention-notes', id] as const,
  approvals: ['approvals'] as const,
  approvalMetrics: ['approvals', 'metrics'] as const,
  approvalNote: (id: string) => ['approvals', id] as const,
  stock: ['stock'] as const,
  stockMovements: ['stock', 'movements'] as const,
  finance: ['finance'] as const,
  invoice: (id: string) => ['finance', 'invoices', id] as const,
  customerBalance: (id: string) => ['finance', 'customers', id, 'balance'] as const,
  monthlyFinance: (month: string) => ['finance', 'monthly', month] as const,
  claims: ['claims'] as const,
  claimableDiscrepancies: ['discrepancies', 'claimable'] as const,
  dashboard: ['dashboard'] as const,
  dashboardFilterOptions: ['dashboard', 'filter-options'] as const,
  dashboardStock: ['dashboard', 'stock'] as const,
  dashboardPayments: (month: string) => ['dashboard', 'payments', month] as const,
  dashboardIncomeExpenses: (month: string) =>
    ['dashboard', 'income-expenses', month] as const,
  dashboardDiscrepancies: (filters: DashboardFilters) =>
    ['dashboard', 'discrepancies', filters] as const,
  dashboardRankings: (filters: DashboardFilters) =>
    ['dashboard', 'rankings', filters] as const,
  dashboardEscalations: ['dashboard', 'escalations'] as const,
}

export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: api.me,
  staleTime: 60_000,
  retry: false,
})

export const customersQuery = queryOptions({
  queryKey: queryKeys.customers,
  queryFn: api.customers,
  staleTime: 15_000,
})

export const itemsQuery = queryOptions({
  queryKey: queryKeys.items,
  queryFn: api.items,
  staleTime: 15_000,
})

export const priceEscalationQuery = queryOptions({
  queryKey: queryKeys.priceEscalation,
  queryFn: api.priceEscalationPreview,
  staleTime: 15_000,
})

export const quotationsQuery = queryOptions({
  queryKey: queryKeys.quotations,
  queryFn: api.quotations,
  staleTime: 10_000,
})

export const ordersQuery = queryOptions({
  queryKey: queryKeys.orders,
  queryFn: api.orders,
  staleTime: 10_000,
})

export const approvalsQuery = queryOptions({
  queryKey: queryKeys.approvals,
  queryFn: api.approvals,
  staleTime: 5_000,
})

export const approvalMetricsQuery = queryOptions({
  queryKey: queryKeys.approvalMetrics,
  queryFn: api.approvalMetrics,
  staleTime: 5_000,
})

export const stockQuery = queryOptions({
  queryKey: queryKeys.stock,
  queryFn: api.stock,
  staleTime: 10_000,
})

export const stockMovementsQuery = queryOptions({
  queryKey: queryKeys.stockMovements,
  queryFn: api.stockMovements,
  staleTime: 10_000,
})

export const invoiceQuery = (id: string) => queryOptions({
  queryKey: queryKeys.invoice(id),
  queryFn: () => api.invoice(id),
  staleTime: 5_000,
})

export const customerBalanceQuery = (id: string) => queryOptions({
  queryKey: queryKeys.customerBalance(id),
  queryFn: () => api.customerBalance(id),
  staleTime: 5_000,
})

export const monthlyFinanceQuery = (month: string) => queryOptions({
  queryKey: queryKeys.monthlyFinance(month),
  queryFn: () => api.monthlyFinance(month),
  staleTime: 5_000,
})

export const claimsQuery = queryOptions({
  queryKey: queryKeys.claims,
  queryFn: api.claims,
  staleTime: 5_000,
})

export const claimableDiscrepanciesQuery = queryOptions({
  queryKey: queryKeys.claimableDiscrepancies,
  queryFn: api.claimableDiscrepancies,
  staleTime: 5_000,
})

export const dashboardFilterOptionsQuery = queryOptions({
  queryKey: queryKeys.dashboardFilterOptions,
  queryFn: api.dashboardFilterOptions,
  staleTime: 60_000,
})

export const dashboardStockQuery = queryOptions({
  queryKey: queryKeys.dashboardStock,
  queryFn: api.dashboardStock,
  staleTime: 15_000,
})

export const dashboardPaymentsQuery = (month: string) => queryOptions({
  queryKey: queryKeys.dashboardPayments(month),
  queryFn: () => api.dashboardPayments(month),
  staleTime: 15_000,
})

export const dashboardIncomeExpensesQuery = (month: string) => queryOptions({
  queryKey: queryKeys.dashboardIncomeExpenses(month),
  queryFn: () => api.dashboardIncomeExpenses(month),
  staleTime: 15_000,
})

export const dashboardDiscrepanciesQuery = (filters: DashboardFilters) => queryOptions({
  queryKey: queryKeys.dashboardDiscrepancies(filters),
  queryFn: () => api.dashboardDiscrepancies(filters),
  staleTime: 15_000,
})

export const dashboardRankingsQuery = (filters: DashboardFilters) => queryOptions({
  queryKey: queryKeys.dashboardRankings(filters),
  queryFn: () => api.dashboardRankings(filters),
  staleTime: 15_000,
})

export const dashboardEscalationsQuery = queryOptions({
  queryKey: queryKeys.dashboardEscalations,
  queryFn: api.dashboardEscalations,
  staleTime: 15_000,
})
