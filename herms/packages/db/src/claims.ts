import { calculateEscalatedPriceCents, multiplyMinorUnits, type SessionUser } from '@herms/shared'
import { and, desc, eq, lte, sql } from 'drizzle-orm'

import type { Database } from './client'
import {
  auditLogs,
  customers,
  damageClaims,
  deliveryNotes,
  discrepancies,
  equipmentItems,
  orders,
  priceHistory,
  retentionNotes,
} from './schema'
import { DataConflictError, DataNotFoundError, type AuditActor } from './services'

function claimStoreScope(actor: SessionUser) {
  return actor.storeId ? eq(customers.storeId, actor.storeId) : undefined
}

function databaseInteger(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') {
    throw new DataConflictError(`${label} is missing`)
  }
  const decoded = typeof value === 'bigint' ? Number(value) : Number(value)
  if (!Number.isSafeInteger(decoded)) {
    throw new DataConflictError(`${label} was not returned as an integer`)
  }
  return decoded
}

export function assertClaimEligibility(input: {
  discrepancyType: string
  responsibleParty: string | null
  status: string
  sourceApproved: boolean
}) {
  if (input.discrepancyType !== 'damaged') {
    throw new DataConflictError('Only a damaged discrepancy may become a damage claim')
  }
  if (input.responsibleParty !== 'customer') {
    throw new DataConflictError('Only a customer-responsible discrepancy may become a damage claim')
  }
  if (!['open', 'written_off'].includes(input.status)) {
    throw new DataConflictError('This discrepancy is no longer claimable')
  }
  if (!input.sourceApproved) {
    throw new DataConflictError('The source note must be approved before a claim is drafted')
  }
}

export function createClaimService(db: Database) {
  async function getClaim(id: string, actor: SessionUser) {
    const scoped = claimStoreScope(actor)
    const [claim] = await db
      .select({
        id: damageClaims.id,
        discrepancyId: damageClaims.discrepancyId,
        orderId: damageClaims.orderId,
        orderNumber: orders.orderNumber,
        customerId: damageClaims.customerId,
        customerName: customers.name,
        equipmentItemId: damageClaims.equipmentItemId,
        equipmentName: equipmentItems.name,
        quantity: damageClaims.quantity,
        unitPriceCents: damageClaims.unitPriceCents,
        claimAmountCents: damageClaims.claimAmountCents,
        status: damageClaims.status,
        confirmedBy: damageClaims.confirmedBy,
        confirmedAt: damageClaims.confirmedAt,
        damageRecordedAt: discrepancies.createdAt,
        reason: discrepancies.reason,
        createdAt: damageClaims.createdAt,
        updatedAt: damageClaims.updatedAt,
      })
      .from(damageClaims)
      .innerJoin(discrepancies, eq(damageClaims.discrepancyId, discrepancies.id))
      .innerJoin(customers, eq(damageClaims.customerId, customers.id))
      .innerJoin(equipmentItems, eq(damageClaims.equipmentItemId, equipmentItems.id))
      .leftJoin(orders, eq(damageClaims.orderId, orders.id))
      .where(scoped ? and(eq(damageClaims.id, id), scoped) : eq(damageClaims.id, id))
      .limit(1)
    if (!claim) throw new DataNotFoundError('Damage claim not found')
    return claim
  }

  return {
    getClaim,

    async listClaims(actor: SessionUser) {
      const scoped = claimStoreScope(actor)
      return db
        .select({
          id: damageClaims.id,
          discrepancyId: damageClaims.discrepancyId,
          orderId: damageClaims.orderId,
          orderNumber: orders.orderNumber,
          customerId: damageClaims.customerId,
          customerName: customers.name,
          equipmentItemId: damageClaims.equipmentItemId,
          equipmentName: equipmentItems.name,
          quantity: damageClaims.quantity,
          unitPriceCents: damageClaims.unitPriceCents,
          claimAmountCents: damageClaims.claimAmountCents,
          status: damageClaims.status,
          confirmedBy: damageClaims.confirmedBy,
          confirmedAt: damageClaims.confirmedAt,
          damageRecordedAt: discrepancies.createdAt,
          reason: discrepancies.reason,
          createdAt: damageClaims.createdAt,
          updatedAt: damageClaims.updatedAt,
        })
        .from(damageClaims)
        .innerJoin(discrepancies, eq(damageClaims.discrepancyId, discrepancies.id))
        .innerJoin(customers, eq(damageClaims.customerId, customers.id))
        .innerJoin(equipmentItems, eq(damageClaims.equipmentItemId, equipmentItems.id))
        .leftJoin(orders, eq(damageClaims.orderId, orders.id))
        .where(scoped)
        .orderBy(desc(damageClaims.createdAt))
    },

    async listClaimableDiscrepancies(actor: SessionUser) {
      const storeFilter = actor.storeId
        ? sql`AND customer.store_id = ${actor.storeId}::uuid`
        : sql``
      const result = await db.execute<{
        id: string
        orderId: string
        orderNumber: string
        customerId: string
        customerName: string
        equipmentItemId: string
        equipmentName: string
        quantity: number | string
        reason: string | null
        status: string
        damageRecordedAt: Date | string
        unitPriceCents: number | string
      }>(sql`
        SELECT discrepancy.id,
          discrepancy.order_id AS "orderId",
          rental_order.order_number AS "orderNumber",
          customer.id AS "customerId",
          customer.name AS "customerName",
          discrepancy.equipment_item_id AS "equipmentItemId",
          item.name AS "equipmentName",
          discrepancy.quantity,
          discrepancy.reason,
          discrepancy.status,
          discrepancy.created_at AS "damageRecordedAt",
          damage_price.new_price_cents AS "unitPriceCents"
        FROM ${discrepancies} discrepancy
        INNER JOIN ${orders} rental_order ON rental_order.id = discrepancy.order_id
        INNER JOIN ${customers} customer ON customer.id = rental_order.customer_id
        INNER JOIN ${equipmentItems} item ON item.id = discrepancy.equipment_item_id
        INNER JOIN LATERAL (
          SELECT history.new_price_cents
          FROM ${priceHistory} history
          WHERE history.equipment_item_id = discrepancy.equipment_item_id
            AND history.effective_date <= discrepancy.created_at
          ORDER BY history.effective_date DESC, history.created_at DESC
          LIMIT 1
        ) damage_price ON true
        WHERE discrepancy.discrepancy_type = 'damaged'
          AND discrepancy.responsible_party = 'customer'
          AND discrepancy.status IN ('open', 'written_off')
          AND NOT EXISTS (
            SELECT 1 FROM ${damageClaims} claim
            WHERE claim.discrepancy_id = discrepancy.id
          )
          AND (
            (discrepancy.source_type = 'retention_note' AND EXISTS (
              SELECT 1 FROM ${retentionNotes} note
              WHERE note.id = discrepancy.source_note_id AND note.status = 'approved'
            )) OR
            (discrepancy.source_type = 'delivery_note' AND EXISTS (
              SELECT 1 FROM ${deliveryNotes} note
              WHERE note.id = discrepancy.source_note_id AND note.status = 'approved'
            ))
          )
          ${storeFilter}
        ORDER BY discrepancy.created_at ASC
      `)
      return result.rows.map((row) => {
        const quantity = databaseInteger(row.quantity, 'Claim quantity')
        const unitPriceCents = databaseInteger(row.unitPriceCents, 'Damage-date price')
        return {
          ...row,
          quantity,
          unitPriceCents,
          damageRecordedAt: new Date(row.damageRecordedAt),
          claimAmountCents: multiplyMinorUnits(unitPriceCents, quantity),
        }
      })
    },

    async draftClaim(discrepancyId: string, actor: AuditActor) {
      const scoped = claimStoreScope(actor)
      const [record] = await db
        .select({
          discrepancy: discrepancies,
          customerId: customers.id,
        })
        .from(discrepancies)
        .innerJoin(orders, eq(discrepancies.orderId, orders.id))
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(scoped
          ? and(eq(discrepancies.id, discrepancyId), scoped)
          : eq(discrepancies.id, discrepancyId))
        .limit(1)
      if (!record) throw new DataNotFoundError('Discrepancy not found')
      const approvedSource = record.discrepancy.sourceType === 'retention_note'
        ? await db.select({ id: retentionNotes.id }).from(retentionNotes).where(and(
          eq(retentionNotes.id, record.discrepancy.sourceNoteId),
          eq(retentionNotes.status, 'approved'),
        )).limit(1)
        : record.discrepancy.sourceType === 'delivery_note'
          ? await db.select({ id: deliveryNotes.id }).from(deliveryNotes).where(and(
            eq(deliveryNotes.id, record.discrepancy.sourceNoteId),
            eq(deliveryNotes.status, 'approved'),
          )).limit(1)
          : []
      assertClaimEligibility({
        discrepancyType: record.discrepancy.discrepancyType,
        responsibleParty: record.discrepancy.responsibleParty,
        status: record.discrepancy.status,
        sourceApproved: Boolean(approvedSource[0]),
      })

      const [historicalPrice] = await db
        .select({ unitPriceCents: priceHistory.newPriceCents })
        .from(priceHistory)
        .where(and(
          eq(priceHistory.equipmentItemId, record.discrepancy.equipmentItemId),
          lte(priceHistory.effectiveDate, record.discrepancy.createdAt),
        ))
        .orderBy(desc(priceHistory.effectiveDate), desc(priceHistory.createdAt))
        .limit(1)
      if (!historicalPrice) {
        throw new DataConflictError('No price history exists at the recorded damage date')
      }

      const now = new Date()
      const claim = {
        id: crypto.randomUUID(),
        discrepancyId,
        orderId: record.discrepancy.orderId,
        customerId: record.customerId,
        equipmentItemId: record.discrepancy.equipmentItemId,
        quantity: record.discrepancy.quantity,
        unitPriceCents: historicalPrice.unitPriceCents,
        claimAmountCents: multiplyMinorUnits(
          historicalPrice.unitPriceCents,
          record.discrepancy.quantity,
        ),
        status: 'drafted' as const,
        confirmedBy: null,
        confirmedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      const [inserted] = await db.batch([
        db.insert(damageClaims).values(claim).onConflictDoNothing().returning(),
        db.execute(sql`INSERT INTO ${auditLogs} (
          actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
        )
        SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'damage_claim.draft',
          'damage_claim', claim.id, NULL, to_jsonb(claim.*), ${actor.requestId}
        FROM ${damageClaims} claim
        WHERE claim.id = ${claim.id}::uuid AND claim.created_at = ${now}`),
      ])
      if (!inserted[0]) throw new DataConflictError('A claim already exists for this discrepancy')
      return getClaim(claim.id, actor)
    },

    async confirmClaim(id: string, actor: AuditActor) {
      const before = await getClaim(id, actor)
      if (before.status !== 'drafted') {
        throw new DataConflictError('Only a drafted claim may be confirmed')
      }
      const now = new Date()
      const result = await db.execute<{ id: string }>(sql`
        WITH balance_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended(${before.customerId}, 0))
        ), updated_claim AS (
          UPDATE ${damageClaims} claim
          SET status = 'confirmed', confirmed_by = ${actor.id}::uuid,
            confirmed_at = ${now}, updated_at = ${now}
          FROM balance_lock
          WHERE claim.id = ${id}::uuid AND claim.status = 'drafted'
            AND EXISTS (
              SELECT 1 FROM ${customers} customer
              WHERE customer.id = claim.customer_id
                AND customer.outstanding_balance_cents::bigint + claim.claim_amount_cents::bigint
                  <= 2000000000
            )
          RETURNING claim.*
        ), updated_customer AS (
          UPDATE ${customers} customer
          SET outstanding_balance_cents = customer.outstanding_balance_cents
              + updated_claim.claim_amount_cents,
            updated_at = ${now}
          FROM updated_claim
          WHERE customer.id = updated_claim.customer_id
            AND customer.outstanding_balance_cents::bigint
              + updated_claim.claim_amount_cents::bigint <= 2000000000
          RETURNING customer.*
        ), updated_discrepancy AS (
          UPDATE ${discrepancies} discrepancy
          SET status = 'claimed', resolved_at = ${now}, updated_at = ${now}
          FROM updated_claim, updated_customer
          WHERE discrepancy.id = updated_claim.discrepancy_id
          RETURNING discrepancy.*
        ), claim_audit AS (
          INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'damage_claim.confirm',
            'damage_claim', updated_claim.id, ${JSON.stringify(before)}::jsonb,
            to_jsonb(updated_claim.*), ${actor.requestId}
          FROM updated_claim, updated_customer, updated_discrepancy
        ), balance_audit AS (
          INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'customer.balance_claim',
            'customer', updated_customer.id,
            jsonb_build_object(
              'outstandingBalanceCents', updated_customer.outstanding_balance_cents
                - updated_claim.claim_amount_cents
            ),
            jsonb_build_object(
              'outstandingBalanceCents', updated_customer.outstanding_balance_cents,
              'claimId', updated_claim.id
            ), ${actor.requestId}
          FROM updated_claim, updated_customer, updated_discrepancy
        )
        SELECT updated_claim.id
        FROM updated_claim, updated_customer, updated_discrepancy
      `)
      if (!result.rows[0]) {
        throw new DataConflictError('The claim changed or the customer balance limit was reached')
      }
      return getClaim(id, actor)
    },

    async rejectClaim(id: string, actor: AuditActor) {
      const before = await getClaim(id, actor)
      if (before.status !== 'drafted') {
        throw new DataConflictError('Only a drafted claim may be rejected')
      }
      const now = new Date()
      const [updated] = await db.batch([
        db.update(damageClaims)
          .set({ status: 'rejected', updatedAt: now })
          .where(and(eq(damageClaims.id, id), eq(damageClaims.status, 'drafted')))
          .returning(),
        db.execute(sql`INSERT INTO ${auditLogs} (
          actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
        )
        SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'damage_claim.reject',
          'damage_claim', claim.id, ${JSON.stringify(before)}::jsonb,
          to_jsonb(claim.*), ${actor.requestId}
        FROM ${damageClaims} claim
        WHERE claim.id = ${id}::uuid AND claim.status = 'rejected'
          AND claim.updated_at = ${now}`),
      ])
      if (!updated[0]) throw new DataConflictError('The claim changed; reload and retry')
      return getClaim(id, actor)
    },
  }
}

export type ClaimService = ReturnType<typeof createClaimService>

export type EscalationConfig = {
  effectiveDate: Date
  mode: 'automatic' | 'approval_required'
}

function addCalendarMonths(date: Date, months: number) {
  const target = new Date(date)
  const day = target.getUTCDate()
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
  )).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target
}

export function escalationEffectiveDates(anchor: Date, through: Date) {
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(through.getTime())) {
    throw new RangeError('Escalation dates must be valid')
  }
  const dates: Date[] = []
  for (let occurrence = 0; ; occurrence += 1) {
    const date = addCalendarMonths(anchor, occurrence * 6)
    if (date > through) break
    dates.push(date)
    if (dates.length > 1_000) throw new RangeError('Escalation schedule is unreasonably large')
  }
  return dates
}

export function createEscalationService(db: Database, config: EscalationConfig) {
  return {
    async run(runAt = new Date(), requestId = `scheduled-escalation/${runAt.toISOString()}`) {
      const effectiveDates = escalationEffectiveDates(config.effectiveDate, runAt)
      if (config.mode === 'approval_required') {
        return { mode: config.mode, effectiveDates, escalated: [], skippedMissingPrice: [] }
      }

      const escalated: Array<{
        itemId: string
        effectiveDate: Date
        oldPriceCents: number
        newPriceCents: number
      }> = []
      const skippedMissingPrice: string[] = []
      for (const effectiveDate of effectiveDates) {
        const candidateResult = await db.execute<{
          id: string
          oldPriceCents: number | string
          currentPriceAfterCents: number | string
        }>(sql`
          SELECT item.id,
            old_history.new_price_cents AS "oldPriceCents",
            current_history.new_price_cents AS "currentPriceAfterCents"
          FROM ${equipmentItems} item
          INNER JOIN LATERAL (
            SELECT history.new_price_cents
            FROM ${priceHistory} history
            WHERE history.equipment_item_id = item.id
              AND history.effective_date <= ${effectiveDate}
            ORDER BY history.effective_date DESC, history.created_at DESC
            LIMIT 1
          ) old_history ON true
          INNER JOIN LATERAL (
            SELECT history.new_price_cents
            FROM ${priceHistory} history
            WHERE history.equipment_item_id = item.id
              AND history.effective_date <= ${runAt}
            ORDER BY history.effective_date DESC, history.created_at DESC
            LIMIT 1
          ) current_history ON true
          WHERE item.created_at <= ${effectiveDate}
            AND NOT EXISTS (
              SELECT 1 FROM ${priceHistory} history
              WHERE history.equipment_item_id = item.id
                AND history.effective_date = ${effectiveDate}
                AND history.reason = 'scheduled_escalation'
            )
        `)
        const candidates = candidateResult.rows

        for (const candidate of candidates) {
          if (candidate.oldPriceCents === null || candidate.oldPriceCents === undefined
            || candidate.currentPriceAfterCents === null
            || candidate.currentPriceAfterCents === undefined) {
            skippedMissingPrice.push(candidate.id)
            continue
          }
          const oldPriceCents = databaseInteger(candidate.oldPriceCents, 'Escalation source price')
          const currentPriceAfterCents = databaseInteger(
            candidate.currentPriceAfterCents,
            'Current effective price',
          )
          const newPriceCents = calculateEscalatedPriceCents(oldPriceCents)
          const result = await db.execute<{ id: string }>(sql`
            WITH inserted AS (
              INSERT INTO ${priceHistory} (
                equipment_item_id, old_price_cents, new_price_cents,
                effective_date, reason, created_by
              ) VALUES (
                ${candidate.id}::uuid, ${oldPriceCents}, ${newPriceCents},
                ${effectiveDate}, 'scheduled_escalation'::price_change_reason, NULL
              )
              ON CONFLICT (equipment_item_id, effective_date)
                WHERE reason = 'scheduled_escalation'
              DO NOTHING
              RETURNING *
            ), updated AS (
              UPDATE ${equipmentItems} item
              SET current_unit_price_cents = CASE
                    WHEN ${effectiveDate} >= (
                      SELECT max(history.effective_date)
                      FROM ${priceHistory} history
                      WHERE history.equipment_item_id = item.id
                        AND history.effective_date <= ${runAt}
                    ) THEN ${newPriceCents}::integer
                    ELSE ${currentPriceAfterCents}::integer
                  END,
                  updated_at = ${runAt}
              FROM inserted
              WHERE item.id = inserted.equipment_item_id
              RETURNING item.id
            ), audited AS (
              INSERT INTO ${auditLogs} (
                actor_type, actor_id, action, entity_type, entity_id,
                before, after, request_id
              )
              SELECT 'user'::audit_actor_type, NULL, 'price.scheduled_escalation',
                'price_history', inserted.id,
                jsonb_build_object('unitPriceCents', inserted.old_price_cents),
                to_jsonb(inserted.*), ${requestId}
              FROM inserted INNER JOIN updated ON updated.id = inserted.equipment_item_id
            )
            SELECT inserted.id FROM inserted INNER JOIN updated
              ON updated.id = inserted.equipment_item_id
          `)
          if (result.rows[0]) {
            escalated.push({
              itemId: candidate.id,
              effectiveDate,
              oldPriceCents,
              newPriceCents,
            })
          }
        }
      }
      return { mode: config.mode, effectiveDates, escalated, skippedMissingPrice }
    },
  }
}

export type EscalationService = ReturnType<typeof createEscalationService>
