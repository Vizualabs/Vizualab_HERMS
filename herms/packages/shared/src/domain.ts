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
export const NOTE_STATUSES = ['draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'reopened'] as const
export const DISCREPANCY_TYPES = ['missing', 'damaged', 'not_accepted', 'other'] as const
export const DISCREPANCY_STATUSES = ['open', 'resolved', 'written_off', 'claimed'] as const
export const RESPONSIBLE_PARTIES = ['customer', 'staff_member'] as const
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'other'] as const
export const CLAIM_STATUSES = ['drafted', 'confirmed', 'rejected'] as const

export type UserRole = (typeof USER_ROLES)[number]
export type CustomerType = (typeof CUSTOMER_TYPES)[number]
export type PriceChangeReason = (typeof PRICE_CHANGE_REASONS)[number]
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number]
export type OrderStatus = (typeof ORDER_STATUSES)[number]
export type NoteStatus = (typeof NOTE_STATUSES)[number]
export type DiscrepancyType = (typeof DISCREPANCY_TYPES)[number]
export type DiscrepancyStatus = (typeof DISCREPANCY_STATUSES)[number]
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number]
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

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

export const deliveryNoteSubmissionSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string().uuid(),
    handedOverQty: z.number().int().min(0).max(1_000_000),
    mismatchReason: z.enum(DISCREPANCY_TYPES).nullable().optional(),
    mismatchDetail: z.string().trim().max(500).nullable().optional(),
  })).min(1).max(100).refine(
    (lines) => new Set(lines.map((line) => line.lineId)).size === lines.length,
    'Each delivery note line may appear only once',
  ),
})

export const deliveryNoteCreateSchema = z.object({
  fieldStaffUserId: z.string().uuid(),
  lines: z.array(z.object({
    equipmentItemId: z.string().uuid(),
    issuedQty: z.number().int().positive().max(1_000_000),
  })).min(1).max(100).refine(
    (lines) => new Set(lines.map((line) => line.equipmentItemId)).size === lines.length,
    'Each equipment item may appear only once',
  ),
})

export const deliveryNoteCountSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string().uuid(),
    countedQty: z.number().int().min(0).max(1_000_000),
  })).min(1).max(100).refine(
    (lines) => new Set(lines.map((line) => line.lineId)).size === lines.length,
    'Each delivery note line may appear only once',
  ),
})

export const retentionNoteCreateSchema = z.object({
  fieldStaffUserId: z.string().uuid(),
  lines: z.array(z.object({
    equipmentItemId: z.string().uuid(),
  })).min(1).max(100).refine(
    (lines) => new Set(lines.map((line) => line.equipmentItemId)).size === lines.length,
    'Each equipment item may appear only once',
  ),
})

export const noteLinkRecipientSchema = z.object({
  fieldStaffUserId: z.string().uuid().optional(),
})

const retentionNoteSubmissionLineSchema = z.object({
  lineId: z.string().uuid(),
  returnedQty: z.number().int().min(0).max(1_000_000),
  balanceQty: z.number().int().min(0).max(1_000_000),
  missingDamagedQty: z.number().int().min(0).max(1_000_000),
  mismatchReason: z.enum(['missing', 'damaged', 'other']).nullable().optional(),
  responsibleParty: z.enum(RESPONSIBLE_PARTIES).nullable().optional(),
  reasonDetail: z.string().trim().max(500).nullable().optional(),
}).superRefine((line, context) => {
  if (line.missingDamagedQty > 0 && !line.mismatchReason) {
    context.addIssue({ code: 'custom', path: ['mismatchReason'], message: 'Shortfall type is required' })
  }
  if (line.missingDamagedQty > 0 && !line.responsibleParty) {
    context.addIssue({ code: 'custom', path: ['responsibleParty'], message: 'Responsible party is required' })
  }
  if (line.missingDamagedQty === 0 && (line.mismatchReason || line.responsibleParty)) {
    context.addIssue({ code: 'custom', path: ['missingDamagedQty'], message: 'Shortfall details require a positive missing or damaged quantity' })
  }
  if (line.mismatchReason === 'other' && !line.reasonDetail?.trim()) {
    context.addIssue({ code: 'custom', path: ['reasonDetail'], message: 'Details are required when the shortfall type is Other' })
  }
})

export const retentionNoteSubmissionSchema = z.object({
  lines: z.array(retentionNoteSubmissionLineSchema).min(1).max(100).refine(
    (lines) => new Set(lines.map((line) => line.lineId)).size === lines.length,
    'Each retention note line may appear only once',
  ).refine(
    (lines) => lines.some((line) => line.returnedQty + line.balanceQty + line.missingDamagedQty > 0),
    'A retention note must account for at least one item',
  ),
})

export const retentionNoteCountSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string().uuid(),
    countedReturnedQty: z.number().int().min(0).max(1_000_000),
  })).min(1).max(100).refine(
    (lines) => new Set(lines.map((line) => line.lineId)).size === lines.length,
    'Each retention note line may appear only once',
  ),
})

export const writeOffReversalSchema = z.object({
  reason: z.string().trim().min(1).max(500),
})

const isoDateTime = z.string().datetime({ offset: true })

export const paymentInputSchema = z.object({
  orderId: z.string().uuid(),
  amountCents: z.number().int().positive().max(2_000_000_000),
  paymentDate: isoDateTime,
  method: z.enum(PAYMENT_METHODS),
})

export const expenseInputSchema = z.object({
  category: z.string().trim().min(1).max(120),
  amountCents: z.number().int().positive().max(2_000_000_000),
  expenseDate: isoDateTime,
  description: nullableText(500),
})

export const financeMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must use YYYY-MM'),
})

export type LoginInput = z.infer<typeof loginInputSchema>
export type CustomerInput = z.infer<typeof customerInputSchema>
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>
export type EquipmentInput = z.infer<typeof equipmentInputSchema>
export type EquipmentUpdate = z.infer<typeof equipmentUpdateSchema>
export type PriceChangeInput = z.infer<typeof priceChangeInputSchema>
export type RecurringCustomerInput = z.infer<typeof recurringCustomerInputSchema>
export type QuotationInput = z.infer<typeof quotationInputSchema>
export type DeliveryNoteSubmission = z.infer<typeof deliveryNoteSubmissionSchema>
export type DeliveryNoteCreate = z.infer<typeof deliveryNoteCreateSchema>
export type DeliveryNoteCount = z.infer<typeof deliveryNoteCountSchema>
export type RetentionNoteCreate = z.infer<typeof retentionNoteCreateSchema>
export type RetentionNoteSubmission = z.infer<typeof retentionNoteSubmissionSchema>
export type RetentionNoteCount = z.infer<typeof retentionNoteCountSchema>
export type WriteOffReversal = z.infer<typeof writeOffReversalSchema>
export type PaymentInput = z.infer<typeof paymentInputSchema>
export type ExpenseInput = z.infer<typeof expenseInputSchema>
export type FinanceMonth = z.infer<typeof financeMonthSchema>
export type NoteLinkRecipient = z.infer<typeof noteLinkRecipientSchema>

export type SessionUser = {
  id: string
  storeId: string | null
  name: string
  role: UserRole
  isDeputyAdmin: boolean
  email: string | null
}
