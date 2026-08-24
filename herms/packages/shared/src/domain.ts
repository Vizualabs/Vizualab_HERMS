import { z } from 'zod'

export const USER_ROLES = [
  'business_owner',
  'sales',
  'field_staff',
  'store_admin',
  'finance',
  'system_admin',
] as const

export const CUSTOMER_TYPES = ['recurring', 'new'] as const
export const PRICE_CHANGE_REASONS = [
  'scheduled_escalation',
  'negotiated',
  'correction',
] as const
export const QUOTATION_STATUSES = ['sent', 'accepted', 'rejected', 'expired'] as const
export const ORDER_STATUSES = ['open', 'fully_returned', 'cancelled'] as const

export type UserRole = (typeof USER_ROLES)[number]
export type CustomerType = (typeof CUSTOMER_TYPES)[number]
export type PriceChangeReason = (typeof PRICE_CHANGE_REASONS)[number]
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number]
export type OrderStatus = (typeof ORDER_STATUSES)[number]

const nullableEmail = z.union([z.string().trim().email().max(254), z.literal(''), z.null()]).optional()
const nullableText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional()

export const loginInputSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(256),
})

export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.literal('new').default('new'),
  phone: nullableText(40),
  email: nullableEmail,
  address: nullableText(500),
})

export const customerUpdateSchema = customerInputSchema.omit({ type: true }).partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const equipmentInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(120),
  unitOfMeasure: z.string().trim().min(1).max(40).default('unit'),
  currentUnitPriceCents: z.number().int().min(0),
  reorderThreshold: z.number().int().min(0).nullable().optional(),
})

export const equipmentUpdateSchema = equipmentInputSchema
  .omit({ currentUnitPriceCents: true })
  .partial()
  .refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const priceChangeInputSchema = z.object({
  newPriceCents: z.number().int().min(0),
  reason: z.enum(PRICE_CHANGE_REASONS),
  effectiveDate: z.string().datetime({ offset: true }).optional(),
})

export const fixedPriceSchema = z.object({
  equipmentItemId: z.string().uuid(),
  unitPriceCents: z.number().int().min(0),
})

export const recurringCustomerInputSchema = z.object({
  prices: z.array(fixedPriceSchema).min(1).refine(
    (prices) => new Set(prices.map((price) => price.equipmentItemId)).size === prices.length,
    'Each equipment item may appear only once',
  ),
})

export const quotationLineInputSchema = z.object({
  equipmentItemId: z.string().uuid(),
  quantity: z.number().int().positive().max(1_000_000),
  manualUnitPriceCents: z.number().int().positive().max(2_000_000_000).optional(),
})

export const quotationInputSchema = z.object({
  customerId: z.string().uuid(),
  lines: z.array(quotationLineInputSchema).min(1).max(100).refine(
    (lines) => new Set(lines.map((line) => line.equipmentItemId)).size === lines.length,
    'Each equipment item may appear only once',
  ),
})

export type LoginInput = z.infer<typeof loginInputSchema>
export type CustomerInput = z.infer<typeof customerInputSchema>
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>
export type EquipmentInput = z.infer<typeof equipmentInputSchema>
export type EquipmentUpdate = z.infer<typeof equipmentUpdateSchema>
export type PriceChangeInput = z.infer<typeof priceChangeInputSchema>
export type RecurringCustomerInput = z.infer<typeof recurringCustomerInputSchema>
export type QuotationInput = z.infer<typeof quotationInputSchema>

export type SessionUser = {
  id: string
  storeId: string | null
  name: string
  role: UserRole
  isDeputyAdmin: boolean
  email: string | null
}
