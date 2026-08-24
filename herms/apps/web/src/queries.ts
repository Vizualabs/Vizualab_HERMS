import { queryOptions } from '@tanstack/react-query'

import { api } from './api'

export const queryKeys = {
  session: ['session'] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', id] as const,
  items: ['items'] as const,
  item: (id: string) => ['items', id] as const,
  priceHistory: (id: string) => ['items', id, 'price-history'] as const,
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
