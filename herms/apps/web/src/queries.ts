import { queryOptions } from '@tanstack/react-query'

import { api } from './api'

export const queryKeys = {
  session: ['session'] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', id] as const,
  items: ['items'] as const,
  item: (id: string) => ['items', id] as const,
  priceHistory: (id: string) => ['items', id, 'price-history'] as const,
  quotations: ['quotations'] as const,
  quotation: (id: string) => ['quotations', id] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['orders', id] as const,
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
