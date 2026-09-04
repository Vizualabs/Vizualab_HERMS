import { Buffer } from 'node:buffer'

import {
  isSuperUser,
  type RetentionNoteCount,
  type RetentionNoteCreate,
  type RetentionNoteSubmission,
  type NoteLinkRecipient,
  type SessionUser,
  type WriteOffReversal,
} from '@herms/shared'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import type { Database } from './client'
import {
  auditLogs,
  customers,
  deliveryNoteLines,
  deliveryNotes,
  discrepancies,
  equipmentItems,
  noteTokens,
  orders,
  outboxEvents,
  retentionNoteLines,
  retentionNotes,
  stockLedger,
  stores,
  users,
} from './schema'
import { requireActiveFieldStaff, resolveFieldStaffRecipient } from './notifications'
import { reconcileReorderAlertsForLedger } from './reorder'
import { DataConflictError, DataNotFoundError, type AuditActor } from './services'

export type RetentionConfig = {
  timezone: string
  retentionNoteNumberPrefix: string
  tokenSecret: string
  tokenTtlSeconds: number
  publicAppUrl: string
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

export function reconciliationIsComplete(lines: ReconciliationLine[]) {
  return lines.length > 0
    && lines.every((line) =>
      line.returnedQty + line.balanceQty + line.missingDamagedQty === line.deliveredQty)
}

function snapshot(value: object | null): Record<string, unknown> | null {
  return value ? (JSON.parse(JSON.stringify(value)) as Record<string, unknown>) : null
}

function yearAt(now: Date, timezone: string) {
  return new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: timezone }).format(now)
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Buffer.from(signature).toString('base64url')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(digest).toString('hex')
}

export function createRetentionService(db: Database, config: RetentionConfig) {
  function requireStore(actor: SessionUser) {
    if (!actor.storeId) throw new DataConflictError('A store-scoped user is required')
    return actor.storeId
  }

  async function rawToken(id: string) {
    return `${id}.${await hmac(config.tokenSecret, id)}`
  }

  async function tokenValues(noteId: string, createdBy: string, now: Date) {
    const id = crypto.randomUUID()
    const raw = await rawToken(id)
    return {
      row: {
        id,
        tokenHash: await sha256(raw),
        noteType: 'retention_note',
        noteId,
        status: 'active' as const,
        expiresAt: new Date(now.getTime() + config.tokenTtlSeconds * 1_000),
        usedAt: null,
        createdBy,
        createdAt: now,
      },
      raw,
    }
  }

  function submissionLink(raw: string) {
    return `${config.publicAppUrl.replace(/\/$/, '')}/notes/${raw}`
  }

  async function nextRnNumber(now: Date) {
    const result = await db.execute<{ value: string }>(
      sql`SELECT nextval('retention_note_number_seq')::text AS value`,
    )
    const value = result.rows[0]?.value
    if (!value) throw new Error('Could not allocate a retention note number')
    return `${config.retentionNoteNumberPrefix}-${yearAt(now, config.timezone)}-${BigInt(value).toString().padStart(6, '0')}`
  }

  async function noteHeader(id: string, actor?: SessionUser) {
    const storeScope = actor?.storeId ? eq(retentionNotes.storeId, actor.storeId) : undefined
    const [note] = await db
      .select({
        id: retentionNotes.id,
        rnNumber: retentionNotes.rnNumber,
        orderId: retentionNotes.orderId,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        customerName: customers.name,
        customerAddress: customers.address,
        deliveryNoteId: retentionNotes.deliveryNoteId,
        deliveryNoteNumber: sql<string | null>`(SELECT dn_number FROM ${deliveryNotes} WHERE id = ${retentionNotes.deliveryNoteId})`,
        storeId: retentionNotes.storeId,
        storeName: sql<string | null>`(SELECT name FROM ${stores} WHERE id = ${retentionNotes.storeId})`,
        storeAddress: sql<string | null>`(SELECT address FROM ${stores} WHERE id = ${retentionNotes.storeId})`,
        status: retentionNotes.status,
        submittedBy: retentionNotes.submittedBy,
        submittedByName: sql<string | null>`(SELECT name FROM ${users} WHERE id = ${retentionNotes.submittedBy})`,
        approvedBy: retentionNotes.approvedBy,
        approvedByName: sql<string | null>`(SELECT name FROM ${users} WHERE id = ${retentionNotes.approvedBy})`,
        submittedAt: retentionNotes.submittedAt,
        approvedAt: retentionNotes.approvedAt,
        createdAt: retentionNotes.createdAt,
        updatedAt: retentionNotes.updatedAt,
      })
      .from(retentionNotes)
      .innerJoin(orders, eq(retentionNotes.orderId, orders.id))
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(storeScope ? and(eq(retentionNotes.id, id), storeScope) : eq(retentionNotes.id, id))
      .limit(1)
    if (!note) throw new DataNotFoundError('Retention note not found')
    return note
  }

  async function noteDetail(id: string, actor?: SessionUser) {
    const note = await noteHeader(id, actor)
    const lines = await db
      .select({
        id: retentionNoteLines.id,
        equipmentItemId: retentionNoteLines.equipmentItemId,
        equipmentName: equipmentItems.name,
        unitOfMeasure: equipmentItems.unitOfMeasure,
        returnedQty: retentionNoteLines.returnedQty,
        balanceQty: retentionNoteLines.balanceQty,
        missingDamagedQty: retentionNoteLines.missingDamagedQty,
        countedReturnedQty: retentionNoteLines.countedReturnedQty,
        mismatchReason: retentionNoteLines.mismatchReason,
        responsibleParty: retentionNoteLines.responsibleParty,
        reasonDetail: retentionNoteLines.reasonDetail,
        deliveredQty: sql<number>`COALESCE((
          SELECT SUM(delivery_line.counted_qty)
          FROM ${deliveryNoteLines} delivery_line
          JOIN ${deliveryNotes} delivery_note ON delivery_note.id = delivery_line.delivery_note_id
          WHERE delivery_note.order_id = ${note.orderId}::uuid
            AND delivery_note.status = 'approved'
            AND delivery_line.equipment_item_id = ${retentionNoteLines.equipmentItemId}
        ), 0)::int`,
        discrepancyId: discrepancies.id,
        discrepancyStatus: discrepancies.status,
        writeOffLedgerId: stockLedger.id,
        writeOffCreatedAt: stockLedger.createdAt,
        writeOffReversed: sql<boolean>`CASE WHEN ${stockLedger.id} IS NULL THEN false ELSE EXISTS (
          SELECT 1 FROM ${stockLedger} reversal WHERE reversal.reversal_of_id = ${stockLedger.id}
        ) END`,
      })
      .from(retentionNoteLines)
      .innerJoin(equipmentItems, eq(retentionNoteLines.equipmentItemId, equipmentItems.id))
      .leftJoin(discrepancies, and(
        eq(discrepancies.sourceType, 'retention_note'),
        eq(discrepancies.sourceLineId, retentionNoteLines.id),
      ))
      .leftJoin(stockLedger, and(
        eq(stockLedger.sourceType, 'retention_note'),
        eq(stockLedger.sourceNoteId, id),
        eq(stockLedger.equipmentItemId, retentionNoteLines.equipmentItemId),
        eq(stockLedger.direction, 'write_off'),
      ))
      .where(eq(retentionNoteLines.retentionNoteId, id))
      .orderBy(equipmentItems.name)
    return {
      ...note,
      noteType: 'retention_note' as const,
      lines: lines.map((line) => ({
        ...line,
        countDifference: line.countedReturnedQty === null
          ? null
          : line.countedReturnedQty - line.returnedQty,
      })),
    }
  }

  async function tokenRecord(raw: string, requestId: string) {
    const [token] = await db.select().from(noteTokens)
      .where(eq(noteTokens.tokenHash, await sha256(raw))).limit(1)
    if (!token || token.noteType !== 'retention_note') {
      await db.insert(auditLogs).values({
        actorType: 'token', actorId: null, action: 'note_token.denied',
        entityType: 'note_token', entityId: null, before: null,
        after: { reason: 'not_found' }, requestId,
      })
      throw new DataNotFoundError('Note link not found')
    }
    if (token.status === 'revoked' || token.expiresAt <= new Date()) {
      await db.insert(auditLogs).values({
        actorType: 'token', actorId: token.id, action: 'note_token.denied',
        entityType: 'retention_note', entityId: token.noteId, before: null,
        after: { reason: token.status === 'revoked' ? 'revoked' : 'expired' }, requestId,
      })
      throw new DataConflictError('The note link is expired or revoked')
    }
    return token
  }

  async function reconciliation(orderId: string) {
    const result = await db.execute<ReconciliationLine>(sql`
      WITH delivered AS (
        SELECT line.equipment_item_id, SUM(line.counted_qty)::int AS delivered_qty
        FROM ${deliveryNoteLines} line
        JOIN ${deliveryNotes} note ON note.id = line.delivery_note_id
        WHERE note.order_id = ${orderId}::uuid AND note.status = 'approved'
        GROUP BY line.equipment_item_id
      ), retained AS (
        SELECT line.equipment_item_id,
          SUM(line.counted_returned_qty)::int AS returned_qty,
          SUM(line.balance_qty)::int AS balance_qty,
          SUM(line.missing_damaged_qty)::int AS missing_damaged_qty
        FROM ${retentionNoteLines} line
        JOIN ${retentionNotes} note ON note.id = line.retention_note_id
        WHERE note.order_id = ${orderId}::uuid AND note.status = 'approved'
        GROUP BY line.equipment_item_id
      )
      SELECT delivered.equipment_item_id AS "equipmentItemId", item.name AS "equipmentName",
        delivered.delivered_qty AS "deliveredQty",
        COALESCE(retained.returned_qty, 0)::int AS "returnedQty",
        COALESCE(retained.balance_qty, 0)::int AS "balanceQty",
        COALESCE(retained.missing_damaged_qty, 0)::int AS "missingDamagedQty",
        (COALESCE(retained.returned_qty, 0) + COALESCE(retained.balance_qty, 0)
          + COALESCE(retained.missing_damaged_qty, 0))::int AS "accountedQty"
      FROM delivered
      JOIN ${equipmentItems} item ON item.id = delivered.equipment_item_id
      LEFT JOIN retained ON retained.equipment_item_id = delivered.equipment_item_id
      ORDER BY item.name
    `)
    return result.rows
  }

  return {
    async ownsNote(id: string, actor: SessionUser) {
      const condition = actor.storeId
        ? and(eq(retentionNotes.id, id), eq(retentionNotes.storeId, actor.storeId))
        : eq(retentionNotes.id, id)
      const [note] = await db.select({ id: retentionNotes.id })
        .from(retentionNotes).where(condition).limit(1)
      return Boolean(note)
    },

    async createFromOrder(orderId: string, input: RetentionNoteCreate, actor: AuditActor) {
      const [order] = await db
        .select({ id: orders.id, status: orders.status, storeId: customers.storeId })
        .from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(actor.storeId
          ? and(eq(orders.id, orderId), eq(customers.storeId, actor.storeId))
          : eq(orders.id, orderId))
        .limit(1)
      if (!order) throw new DataNotFoundError('Order not found')
      if (order.status !== 'open') throw new DataConflictError('Retention notes require an open order')
      await requireActiveFieldStaff(db, input.fieldStaffUserId, order.storeId)
      const delivered = await db
        .select({
          equipmentItemId: deliveryNoteLines.equipmentItemId,
          quantity: sql<number>`COALESCE(SUM(${deliveryNoteLines.countedQty}), 0)::int`,
        })
        .from(deliveryNoteLines)
        .innerJoin(deliveryNotes, eq(deliveryNoteLines.deliveryNoteId, deliveryNotes.id))
        .where(and(eq(deliveryNotes.orderId, orderId), eq(deliveryNotes.status, 'approved')))
        .groupBy(deliveryNoteLines.equipmentItemId)
      const deliveredByItem = new Map(delivered.map((line) => [line.equipmentItemId, line.quantity]))
      if (input.lines.some((line) => (deliveredByItem.get(line.equipmentItemId) ?? 0) <= 0)) {
        throw new DataConflictError('Every retention item must have an approved delivered quantity')
      }
      const now = new Date()
      const noteId = crypto.randomUUID()
      const token = await tokenValues(noteId, actor.id, now)
      const note = {
        id: noteId,
        rnNumber: await nextRnNumber(now),
        orderId,
        deliveryNoteId: null,
        storeId: order.storeId,
        status: 'draft' as const,
        submittedBy: null,
        approvedBy: null,
        submittedAt: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await db.batch([
        db.insert(retentionNotes).values(note),
        db.insert(retentionNoteLines).values(input.lines.map((line) => ({
          id: crypto.randomUUID(),
          retentionNoteId: noteId,
          equipmentItemId: line.equipmentItemId,
          returnedQty: 0,
          balanceQty: 0,
          missingDamagedQty: 0,
          countedReturnedQty: null,
          mismatchReason: null,
          responsibleParty: null,
          reasonDetail: null,
        }))),
        db.insert(noteTokens).values(token.row),
        db.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          eventType: 'retention_note_link_created',
          aggregateType: 'retention_note',
          aggregateId: noteId,
          idempotencyKey: 'retention_note_link_created:' + noteId + ':' + token.row.id,
          payload: {
            retentionNoteId: noteId,
            tokenId: token.row.id,
            recipientUserId: input.fieldStaffUserId,
            initiatedByUserId: actor.id,
            requestId: actor.requestId,
          },
        }),
        db.insert(auditLogs).values({
          actorType: 'user', actorId: actor.id, action: 'retention_note.create',
          entityType: 'retention_note', entityId: noteId, before: null,
          after: snapshot(note), requestId: actor.requestId,
        }),
      ])
      return {
        ...(await noteDetail(noteId, actor)),
        submissionLink: submissionLink(token.raw),
        tokenExpiresAt: token.row.expiresAt,
      }
    },

    async listForOrder(orderId: string, actor: SessionUser) {
      const condition = actor.storeId
        ? and(eq(retentionNotes.orderId, orderId), eq(retentionNotes.storeId, actor.storeId))
        : eq(retentionNotes.orderId, orderId)
      return db.select({
        id: retentionNotes.id,
        rnNumber: retentionNotes.rnNumber,
        orderId: retentionNotes.orderId,
        storeId: retentionNotes.storeId,
        status: retentionNotes.status,
        createdAt: retentionNotes.createdAt,
        submittedAt: retentionNotes.submittedAt,
        approvedAt: retentionNotes.approvedAt,
      }).from(retentionNotes).where(condition).orderBy(desc(retentionNotes.createdAt))
    },

    getRetentionNote: noteDetail,

    async getLink(id: string, actor: AuditActor) {
      const note = await noteHeader(id, actor)
      if (note.status === 'approved') {
        throw new DataConflictError('An approved retention note no longer accepts field submissions')
      }
      let [token] = await db.select().from(noteTokens).where(and(
        eq(noteTokens.noteType, 'retention_note'),
        eq(noteTokens.noteId, id),
        inArray(noteTokens.status, ['active', 'used']),
      )).limit(1)
      if (token && token.expiresAt <= new Date()) {
        await db.update(noteTokens).set({ status: 'revoked' }).where(eq(noteTokens.id, token.id))
        token = undefined
      }
      if (!token) {
        const now = new Date()
        const created = await tokenValues(id, actor.id, now)
        await db.batch([
          db.insert(noteTokens).values(created.row),
          db.insert(auditLogs).values({
            actorType: 'user', actorId: actor.id, action: 'note_token.create',
            entityType: 'retention_note', entityId: id, before: null,
            after: { tokenId: created.row.id, expiresAt: created.row.expiresAt.toISOString() },
            requestId: actor.requestId,
          }),
        ])
        return { submissionLink: submissionLink(created.raw), expiresAt: created.row.expiresAt }
      }
      return { submissionLink: submissionLink(await rawToken(token.id)), expiresAt: token.expiresAt }
    },

    async regenerateLink(id: string, input: NoteLinkRecipient, actor: AuditActor) {
      const note = await noteHeader(id, actor)
      if (note.status === 'approved') {
        throw new DataConflictError('An approved retention note cannot receive a new link')
      }
      if (!note.storeId) throw new DataConflictError('The retention note has no store')
      const recipient = await resolveFieldStaffRecipient(db, input.fieldStaffUserId, id, note.storeId)
      const now = new Date()
      const created = await tokenValues(id, actor.id, now)
      await db.batch([
        db.update(noteTokens).set({ status: 'revoked' }).where(and(
          eq(noteTokens.noteType, 'retention_note'),
          eq(noteTokens.noteId, id),
          inArray(noteTokens.status, ['active', 'used']),
        )),
        db.insert(noteTokens).values(created.row),
        db.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          eventType: 'retention_note_link_regenerated',
          aggregateType: 'retention_note',
          aggregateId: id,
          idempotencyKey: `retention_note_link_regenerated:${id}:${created.row.id}`,
          payload: {
            retentionNoteId: id,
            tokenId: created.row.id,
            recipientUserId: recipient.id,
            initiatedByUserId: actor.id,
            requestId: actor.requestId,
          },
        }),
        db.insert(auditLogs).values({
          actorType: 'user', actorId: actor.id, action: 'note_token.regenerate',
          entityType: 'retention_note', entityId: id, before: null,
          after: { tokenId: created.row.id, expiresAt: created.row.expiresAt.toISOString() },
          requestId: actor.requestId,
        }),
      ])
      return { submissionLink: submissionLink(created.raw), expiresAt: created.row.expiresAt }
    },

    async readByToken(raw: string, requestId: string) {
      const token = await tokenRecord(raw, requestId)
      const note = await noteDetail(token.noteId)
      if (!['draft', 'reopened', 'pending_approval'].includes(note.status)) {
        throw new DataConflictError('The retention note is not open for field submission')
      }
      await db.insert(auditLogs).values({
        actorType: 'token', actorId: token.id, action: 'note_token.read',
        entityType: 'retention_note', entityId: note.id, before: null,
        after: { status: note.status }, requestId,
      })
      return note
    },

    async submitByToken(raw: string, input: RetentionNoteSubmission, requestId: string) {
      const token = await tokenRecord(raw, requestId)
      const before = await noteDetail(token.noteId)
      if (!['draft', 'reopened', 'pending_approval'].includes(before.status)) {
        throw new DataConflictError('The retention note is not open for field submission')
      }
      if (before.lines.some((line) => line.countedReturnedQty !== null)) {
        throw new DataConflictError('Field correction is closed because physical counting has started')
      }
      const known = new Set(before.lines.map((line) => line.id))
      if (input.lines.length !== before.lines.length
        || input.lines.some((line) => !known.has(line.lineId))) {
        throw new DataConflictError('Submission must include every retention note line exactly once')
      }
      const normalized = input.lines.map((line) => ({
        lineId: line.lineId,
        returnedQty: line.returnedQty,
        balanceQty: line.balanceQty,
        missingDamagedQty: line.missingDamagedQty,
        mismatchReason: line.missingDamagedQty > 0 ? line.mismatchReason : null,
        responsibleParty: line.missingDamagedQty > 0 ? line.responsibleParty : null,
        reasonDetail: line.reasonDetail?.trim() || null,
      }))
      const now = new Date()
      const pendingNotification = before.status === 'pending_approval'
        ? db.execute(sql`SELECT 1`)
        : db.insert(outboxEvents).values({
            id: crypto.randomUUID(),
            eventType: 'retention_note_pending_approval',
            aggregateType: 'retention_note',
            aggregateId: before.id,
            idempotencyKey: 'retention_note_pending_approval:' + before.id + ':' + token.id,
            payload: {
              retentionNoteId: before.id,
              noteType: 'retention_note',
              noteNumber: before.rnNumber,
              storeId: before.storeId,
              requestId,
            },
          })
      const mutationQuery = db.execute<{ id: string }>(sql`
        WITH locked AS (
          SELECT pg_advisory_xact_lock(hashtext(${before.orderId}))
        ), updated_note AS (
          UPDATE ${retentionNotes}
          SET status = 'pending_approval',
            submitted_at = COALESCE(submitted_at, ${now}),
            updated_at = ${now}
          WHERE id = ${before.id}::uuid
            AND status IN ('draft', 'reopened', 'pending_approval')
            AND NOT EXISTS (
              SELECT 1 FROM ${retentionNoteLines}
              WHERE retention_note_id = ${before.id}::uuid
                AND counted_returned_qty IS NOT NULL
            )
            AND EXISTS (SELECT 1 FROM locked)
          RETURNING id, order_id
        ), input_lines AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(normalized)}::jsonb)
          AS x("lineId" uuid, "returnedQty" integer, "balanceQty" integer,
            "missingDamagedQty" integer, "mismatchReason" discrepancy_type,
            "responsibleParty" responsible_party, "reasonDetail" text)
        ), updated_lines AS (
          UPDATE ${retentionNoteLines} line
          SET returned_qty = input."returnedQty",
            balance_qty = input."balanceQty",
            missing_damaged_qty = input."missingDamagedQty",
            mismatch_reason = input."mismatchReason",
            responsible_party = input."responsibleParty",
            reason_detail = input."reasonDetail"
          FROM input_lines input, updated_note note
          WHERE line.id = input."lineId" AND line.retention_note_id = note.id
          RETURNING line.*
        ), upserted AS (
          INSERT INTO ${discrepancies} (
            id, source_type, source_note_id, source_line_id, order_id, equipment_item_id,
            quantity, discrepancy_type, reason, responsible_party, value_cents, status,
            created_at, resolved_at, updated_at
          )
          SELECT gen_random_uuid(), 'retention_note', note.id, line.id, note.order_id,
            line.equipment_item_id, line.missing_damaged_qty, line.mismatch_reason,
            line.reason_detail, line.responsible_party, 0, 'open', ${now}, NULL, ${now}
          FROM updated_lines line, updated_note note
          WHERE line.missing_damaged_qty > 0
          ON CONFLICT (source_type, source_line_id) WHERE source_line_id IS NOT NULL DO UPDATE
          SET quantity = EXCLUDED.quantity,
            discrepancy_type = EXCLUDED.discrepancy_type,
            reason = EXCLUDED.reason,
            responsible_party = EXCLUDED.responsible_party,
            status = 'open',
            resolved_at = NULL,
            updated_at = EXCLUDED.updated_at
        ), resolved AS (
          UPDATE ${discrepancies} discrepancy
          SET status = 'resolved', resolved_at = ${now}, updated_at = ${now}
          FROM updated_lines line
          WHERE discrepancy.source_type = 'retention_note'
            AND discrepancy.source_line_id = line.id
            AND line.missing_damaged_qty = 0
            AND discrepancy.status = 'open'
        ), used_token AS (
          UPDATE ${noteTokens}
          SET status = 'used', used_at = COALESCE(used_at, ${now})
          WHERE id = ${token.id}::uuid AND EXISTS (SELECT 1 FROM updated_note)
        )
        SELECT id FROM updated_note
      `)
      const [mutation] = await db.batch([
        mutationQuery,
        db.execute(sql`SELECT 1 / CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
          FROM (
            SELECT retained.equipment_item_id
            FROM ${retentionNoteLines} retained
            JOIN ${retentionNotes} retention ON retention.id = retained.retention_note_id
            WHERE retention.order_id = ${before.orderId}::uuid
              AND retention.status <> 'rejected'
            GROUP BY retained.equipment_item_id
            HAVING SUM(
              retained.returned_qty + retained.balance_qty + retained.missing_damaged_qty
            ) > COALESCE((
              SELECT SUM(delivered.counted_qty)
              FROM ${deliveryNoteLines} delivered
              JOIN ${deliveryNotes} delivery ON delivery.id = delivered.delivery_note_id
              WHERE delivery.order_id = ${before.orderId}::uuid
                AND delivery.status = 'approved'
                AND delivered.equipment_item_id = retained.equipment_item_id
            ), 0)
          ) over_accounted`),
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id,
            before, after, request_id
          )
          SELECT 'token'::audit_actor_type, ${token.id}::uuid,
            'discrepancy.record', 'discrepancy', discrepancy.id,
            NULL, to_jsonb(discrepancy.*), ${requestId}
          FROM ${discrepancies} discrepancy
          WHERE discrepancy.source_type = 'retention_note'
            AND discrepancy.source_note_id = ${before.id}::uuid
            AND discrepancy.updated_at = ${now}`),
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
          )
          SELECT 'token'::audit_actor_type, ${token.id}::uuid, 'retention_note.submit',
            'retention_note', note.id, ${JSON.stringify(snapshot(before))}::jsonb,
            to_jsonb(note.*), ${requestId}
          FROM ${retentionNotes} note
          WHERE note.id = ${before.id}::uuid AND note.updated_at = ${now}`),
        pendingNotification,
      ])
      if (!mutation.rows[0]) {
        throw new DataConflictError('Counting started or the retention note changed; reload and retry')
      }
      return noteDetail(before.id)
    },

    async listApprovals(actor: SessionUser) {
      const rows = await db.select({
        id: retentionNotes.id,
        rnNumber: retentionNotes.rnNumber,
        orderId: retentionNotes.orderId,
        orderNumber: orders.orderNumber,
        customerName: customers.name,
        status: retentionNotes.status,
        submittedAt: retentionNotes.submittedAt,
        createdAt: retentionNotes.createdAt,
      })
        .from(retentionNotes)
        .innerJoin(orders, eq(retentionNotes.orderId, orders.id))
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(and(
          eq(retentionNotes.storeId, requireStore(actor)),
          inArray(retentionNotes.status, ['pending_approval', 'rejected', 'reopened']),
        ))
        .orderBy(desc(retentionNotes.submittedAt), desc(retentionNotes.createdAt))
      return rows.map((row) => ({ ...row, noteType: 'retention_note' as const }))
    },

    async approvalMetrics(actor: SessionUser) {
      const storeId = requireStore(actor)
      const [metrics] = await db.select({
        pendingApproval: sql<number>`COUNT(DISTINCT ${retentionNotes.id}) FILTER (
          WHERE ${retentionNotes.status} = 'pending_approval'
        )::int`,
        approvedToday: sql<number>`COUNT(DISTINCT ${retentionNotes.id}) FILTER (
          WHERE ${retentionNotes.status} = 'approved'
            AND (${retentionNotes.approvedAt} AT TIME ZONE ${config.timezone})::date
              = (CURRENT_TIMESTAMP AT TIME ZONE ${config.timezone})::date
        )::int`,
        mismatchesFlagged: sql<number>`COUNT(${retentionNoteLines.id}) FILTER (
          WHERE ${retentionNotes.status} = 'pending_approval'
            AND ${retentionNoteLines.missingDamagedQty} > 0
        )::int`,
      })
        .from(retentionNotes)
        .leftJoin(retentionNoteLines, eq(retentionNoteLines.retentionNoteId, retentionNotes.id))
        .where(eq(retentionNotes.storeId, storeId))
      return metrics ?? { pendingApproval: 0, approvedToday: 0, mismatchesFlagged: 0 }
    },

    async countNote(id: string, input: RetentionNoteCount, actor: AuditActor) {
      const before = await noteDetail(id, actor)
      if (before.status !== 'pending_approval') {
        throw new DataConflictError('Only a pending retention note may be counted')
      }
      const known = new Set(before.lines.map((line) => line.id))
      if (input.lines.length !== before.lines.length
        || input.lines.some((line) => !known.has(line.lineId))) {
        throw new DataConflictError('Physical count must include every retention note line exactly once')
      }
      const now = new Date()
      const mutationQuery = db.execute<{ id: string }>(sql`
        WITH updated_note AS (
          UPDATE ${retentionNotes} SET updated_at = ${now}
          WHERE id = ${id}::uuid
            AND store_id = ${requireStore(actor)}::uuid
            AND status = 'pending_approval'
          RETURNING id
        ), input_lines AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(input.lines)}::jsonb)
          AS x("lineId" uuid, "countedReturnedQty" integer)
        ), updated_lines AS (
          UPDATE ${retentionNoteLines} line
          SET counted_returned_qty = input."countedReturnedQty"
          FROM input_lines input, updated_note note
          WHERE line.id = input."lineId" AND line.retention_note_id = note.id
        ), revoked AS (
          UPDATE ${noteTokens} SET status = 'revoked'
          WHERE note_type = 'retention_note' AND note_id = ${id}::uuid
            AND status IN ('active', 'used') AND EXISTS (SELECT 1 FROM updated_note)
        )
        SELECT id FROM updated_note
      `)
      const [mutation] = await db.batch([
        mutationQuery,
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'retention_note.count',
            'retention_note', note.id, ${JSON.stringify(snapshot(before))}::jsonb,
            to_jsonb(note.*), ${actor.requestId}
          FROM ${retentionNotes} note
          WHERE note.id = ${id}::uuid AND note.updated_at = ${now}`),
      ])
      if (!mutation.rows[0]) throw new DataConflictError('The retention note changed; reload and retry')
      return noteDetail(id, actor)
    },

    async approveNote(id: string, actor: AuditActor) {
      const before = await noteDetail(id, actor)
      if (before.status !== 'pending_approval') {
        throw new DataConflictError('Only a pending retention note may be approved')
      }
      if (before.lines.some((line) => line.countedReturnedQty === null)) {
        throw new DataConflictError('Physical count is required for every line before approval')
      }
      const now = new Date()
      const [updated] = await db.batch([
        db.update(retentionNotes)
          .set({ status: 'approved', approvedBy: actor.id, approvedAt: now, updatedAt: now })
          .where(and(
            eq(retentionNotes.id, id),
            eq(retentionNotes.storeId, requireStore(actor)),
            eq(retentionNotes.status, 'pending_approval'),
            sql`NOT EXISTS (
              SELECT 1 FROM ${retentionNoteLines}
              WHERE retention_note_id = ${id}::uuid AND counted_returned_qty IS NULL
            )`,
          ))
          .returning(),
        db.execute(sql`INSERT INTO ${stockLedger} (
            id, equipment_item_id, store_id, source_type, source_note_id,
            direction, quantity_delta, created_by, created_at
          )
          SELECT gen_random_uuid(), line.equipment_item_id, note.store_id, 'retention_note',
            note.id, 'in'::stock_direction, line.counted_returned_qty,
            ${actor.id}::uuid, ${now}::timestamptz
          FROM ${retentionNoteLines} line
          JOIN ${retentionNotes} note ON note.id = line.retention_note_id
          WHERE note.id = ${id}::uuid AND note.status = 'approved'
            AND note.updated_at = ${now} AND line.counted_returned_qty > 0
          UNION ALL
          SELECT gen_random_uuid(), line.equipment_item_id, note.store_id, 'retention_note',
            note.id, 'write_off'::stock_direction, -line.missing_damaged_qty,
            ${actor.id}::uuid, ${now}::timestamptz
          FROM ${retentionNoteLines} line
          JOIN ${retentionNotes} note ON note.id = line.retention_note_id
          WHERE note.id = ${id}::uuid AND note.status = 'approved'
            AND note.updated_at = ${now} AND line.missing_damaged_qty > 0`),
        db.execute(reconcileReorderAlertsForLedger('retention_note', id, now, actor)),
        db.execute(sql`UPDATE ${discrepancies}
          SET status = 'written_off', resolved_at = ${now}, updated_at = ${now}
          WHERE source_type = 'retention_note' AND source_note_id = ${id}::uuid
            AND status = 'open'
            AND EXISTS (
              SELECT 1 FROM ${retentionNotes}
              WHERE id = ${id}::uuid AND status = 'approved' AND updated_at = ${now}
            )`),
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id,
            before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid,
            'discrepancy.write_off', 'discrepancy', discrepancy.id,
            jsonb_build_object('status', 'open'),
            to_jsonb(discrepancy.*), ${actor.requestId}
          FROM ${discrepancies} discrepancy
          WHERE discrepancy.source_type = 'retention_note'
            AND discrepancy.source_note_id = ${id}::uuid
            AND discrepancy.status = 'written_off'
            AND discrepancy.updated_at = ${now}`),
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'stock_ledger.post',
            'stock_ledger', ledger.id, NULL, to_jsonb(ledger.*), ${actor.requestId}
          FROM ${stockLedger} ledger
          WHERE ledger.source_type = 'retention_note'
            AND ledger.source_note_id = ${id}::uuid AND ledger.created_at = ${now}`),
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'retention_note.approve',
            'retention_note', note.id, ${JSON.stringify(snapshot(before))}::jsonb,
            to_jsonb(note.*), ${actor.requestId}
          FROM ${retentionNotes} note
          WHERE note.id = ${id}::uuid AND note.status = 'approved' AND note.updated_at = ${now}`),
        db.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          eventType: 'retention_note_approved',
          aggregateType: 'retention_note',
          aggregateId: id,
          idempotencyKey: 'retention_note_approved:' + id + ':' + now.toISOString(),
          payload: {
            retentionNoteId: id,
            noteType: 'retention_note',
            noteNumber: before.rnNumber,
            storeId: before.storeId,
            requestId: actor.requestId,
          },
        }),
      ])
      if (!updated[0]) throw new DataConflictError('The retention note changed; reload and retry')
      return noteDetail(id, actor)
    },

    async rejectNote(id: string, actor: AuditActor) {
      const before = await noteDetail(id, actor)
      if (before.status !== 'pending_approval') {
        throw new DataConflictError('Only a pending retention note may be rejected')
      }
      const now = new Date()
      const [updated] = await db.batch([
        db.update(retentionNotes).set({ status: 'rejected', updatedAt: now }).where(and(
          eq(retentionNotes.id, id),
          eq(retentionNotes.storeId, requireStore(actor)),
          eq(retentionNotes.status, 'pending_approval'),
        )).returning(),
        db.update(noteTokens).set({ status: 'revoked' }).where(and(
          eq(noteTokens.noteType, 'retention_note'),
          eq(noteTokens.noteId, id),
          inArray(noteTokens.status, ['active', 'used']),
        )),
        db.insert(auditLogs).values({
          actorType: 'user', actorId: actor.id, action: 'retention_note.reject',
          entityType: 'retention_note', entityId: id, before: snapshot(before),
          after: { status: 'rejected' }, requestId: actor.requestId,
        }),
      ])
      if (!updated[0]) throw new DataConflictError('The retention note changed; reload and retry')
      return noteDetail(id, actor)
    },

    async reopenNote(id: string, actor: AuditActor) {
      const before = await noteDetail(id, actor)
      if (before.status !== 'rejected') {
        throw new DataConflictError('Only a rejected retention note may be reopened')
      }
      const now = new Date()
      const created = await tokenValues(id, actor.id, now)
      const [updated] = await db.batch([
        db.update(retentionNotes)
          .set({ status: 'reopened', submittedAt: null, updatedAt: now })
          .where(and(
            eq(retentionNotes.id, id),
            eq(retentionNotes.storeId, requireStore(actor)),
            eq(retentionNotes.status, 'rejected'),
          ))
          .returning(),
        db.update(retentionNoteLines)
          .set({ countedReturnedQty: null })
          .where(eq(retentionNoteLines.retentionNoteId, id)),
        db.update(noteTokens).set({ status: 'revoked' }).where(and(
          eq(noteTokens.noteType, 'retention_note'),
          eq(noteTokens.noteId, id),
          inArray(noteTokens.status, ['active', 'used']),
        )),
        db.insert(noteTokens).values(created.row),
        db.insert(auditLogs).values({
          actorType: 'user', actorId: actor.id, action: 'retention_note.reopen',
          entityType: 'retention_note', entityId: id, before: snapshot(before),
          after: { status: 'reopened', tokenId: created.row.id }, requestId: actor.requestId,
        }),
      ])
      if (!updated[0]) throw new DataConflictError('The retention note changed; reload and retry')
      return {
        ...(await noteDetail(id, actor)),
        submissionLink: submissionLink(created.raw),
        tokenExpiresAt: created.row.expiresAt,
      }
    },

    async closeOrder(orderId: string, actor: AuditActor) {
      const storeId = requireStore(actor)
      const [order] = await db.select({
        id: orders.id,
        status: orders.status,
        storeId: customers.storeId,
      }).from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(and(eq(orders.id, orderId), eq(customers.storeId, storeId)))
        .limit(1)
      if (!order) throw new DataNotFoundError('Order not found')
      if (order.status !== 'open') throw new DataConflictError('Only an open order may be closed')
      const summary = await reconciliation(orderId)
      if (summary.length === 0) {
        throw new DataConflictError('An order cannot close before an approved delivery')
      }
      const incomplete = summary.filter((line) =>
        line.returnedQty + line.balanceQty + line.missingDamagedQty !== line.deliveredQty)
      if (incomplete.length > 0) {
        const detail = incomplete.map((line) =>
          `${line.equipmentName}: delivered ${line.deliveredQty}, accounted ${line.accountedQty}`,
        ).join('; ')
        throw new DataConflictError(`Cumulative return reconciliation is incomplete. ${detail}`)
      }
      const [openNote] = await db.select({ id: retentionNotes.id }).from(retentionNotes)
        .where(and(
          eq(retentionNotes.orderId, orderId),
          sql`${retentionNotes.status} NOT IN ('approved', 'rejected')`,
        ))
        .limit(1)
      if (openNote) {
        throw new DataConflictError('All retention notes must be approved or rejected before order close')
      }
      const now = new Date()
      const [, updated] = await db.batch([
        db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`),
        db.update(orders)
          .set({ status: 'fully_returned', updatedAt: now })
          .where(and(
            eq(orders.id, orderId),
            eq(orders.status, 'open'),
            sql`NOT EXISTS (
              WITH delivered AS (
                SELECT line.equipment_item_id, SUM(line.counted_qty)::int AS quantity
                FROM ${deliveryNoteLines} line
                JOIN ${deliveryNotes} note ON note.id = line.delivery_note_id
                WHERE note.order_id = ${orderId}::uuid AND note.status = 'approved'
                GROUP BY line.equipment_item_id
              ), retained AS (
                SELECT line.equipment_item_id,
                  SUM(line.counted_returned_qty + line.balance_qty
                    + line.missing_damaged_qty)::int AS quantity
                FROM ${retentionNoteLines} line
                JOIN ${retentionNotes} note ON note.id = line.retention_note_id
                WHERE note.order_id = ${orderId}::uuid AND note.status = 'approved'
                GROUP BY line.equipment_item_id
              )
              SELECT 1 FROM delivered
              LEFT JOIN retained ON retained.equipment_item_id = delivered.equipment_item_id
              WHERE delivered.quantity <> COALESCE(retained.quantity, 0)
            )`,
            sql`NOT EXISTS (
              SELECT 1 FROM ${retentionNotes}
              WHERE order_id = ${orderId}::uuid
                AND status NOT IN ('approved', 'rejected')
            )`,
          ))
          .returning(),
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'order.close',
            'order', current.id, ${JSON.stringify(snapshot(order))}::jsonb,
            to_jsonb(current.*), ${actor.requestId}
          FROM ${orders} current
          WHERE current.id = ${orderId}::uuid
            AND current.status = 'fully_returned' AND current.updated_at = ${now}`),
      ])
      if (!updated[0]) {
        throw new DataConflictError('The order or its reconciliation changed; reload and retry')
      }
      return { order: updated[0], reconciliation: summary }
    },

    async reverseWriteOff(
      discrepancyId: string,
      input: WriteOffReversal,
      actor: AuditActor,
    ) {
      if (!['store_admin', 'system_admin', 'super_user'].includes(actor.role)) {
        throw new DataConflictError('This role cannot reverse a write-off')
      }
      if (actor.role === 'store_admin' && !actor.storeId) {
        throw new DataConflictError('A store-scoped Store Admin is required')
      }
      const condition = actor.storeId
        ? and(eq(discrepancies.id, discrepancyId), eq(retentionNotes.storeId, actor.storeId))
        : eq(discrepancies.id, discrepancyId)
      const [record] = await db.select({
        discrepancy: discrepancies,
        storeId: retentionNotes.storeId,
        ledgerId: stockLedger.id,
        quantityDelta: stockLedger.quantityDelta,
        ledgerCreatedAt: stockLedger.createdAt,
      })
        .from(discrepancies)
        .innerJoin(retentionNotes, and(
          eq(discrepancies.sourceType, 'retention_note'),
          eq(discrepancies.sourceNoteId, retentionNotes.id),
        ))
        .innerJoin(stockLedger, and(
          eq(stockLedger.sourceType, 'retention_note'),
          eq(stockLedger.sourceNoteId, retentionNotes.id),
          eq(stockLedger.equipmentItemId, discrepancies.equipmentItemId),
          eq(stockLedger.direction, 'write_off'),
        ))
        .where(condition)
        .limit(1)
      if (!record) throw new DataNotFoundError('Written-off discrepancy not found')
      if (record.discrepancy.status !== 'written_off') {
        throw new DataConflictError('Only a written-off discrepancy may be reversed')
      }
      if (actor.role !== 'system_admin' && !isSuperUser(actor.role)
        && Date.now() > record.ledgerCreatedAt.getTime() + 7 * 86_400_000) {
        throw new DataConflictError('The seven-day Store Admin reversal window has expired')
      }
      const now = new Date()
      const reversalId = crypto.randomUUID()
      const mutationQuery = db.execute<{ id: string }>(sql`
        WITH updated AS (
          UPDATE ${discrepancies}
          SET status = 'resolved', resolved_at = ${now}, updated_at = ${now}
          WHERE id = ${discrepancyId}::uuid AND status = 'written_off'
          RETURNING id
        )
        INSERT INTO ${stockLedger} (
          id, equipment_item_id, store_id, source_type, source_note_id,
          direction, quantity_delta, reversal_of_id, reversal_reason,
          created_by, created_at
        )
        SELECT ${reversalId}::uuid, ${record.discrepancy.equipmentItemId}::uuid,
          ${record.storeId}::uuid, 'write_off_reversal', ${discrepancyId}::uuid,
          'in'::stock_direction, ${-record.quantityDelta}, ${record.ledgerId}::uuid,
          ${input.reason}, ${actor.id}::uuid, ${now}
        FROM updated
        RETURNING id
      `)
      const [mutation] = await db.batch([
        mutationQuery,
        db.execute(reconcileReorderAlertsForLedger('write_off_reversal', discrepancyId, now, actor)),
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id,
            before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid,
            'stock_ledger.write_off_reverse', 'stock_ledger', ledger.id, NULL,
            to_jsonb(ledger.*), ${actor.requestId}
          FROM ${stockLedger} ledger
          WHERE ledger.id = ${reversalId}::uuid AND ledger.created_at = ${now}`),
        db.execute(sql`INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id,
            before, after, request_id
          )
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid,
            'discrepancy.resolve', 'discrepancy', discrepancy.id,
            ${JSON.stringify(snapshot(record.discrepancy))}::jsonb,
            to_jsonb(discrepancy.*), ${actor.requestId}
          FROM ${discrepancies} discrepancy
          WHERE discrepancy.id = ${discrepancyId}::uuid
            AND discrepancy.status = 'resolved' AND discrepancy.updated_at = ${now}`),
      ])
      if (!mutation.rows[0]) {
        throw new DataConflictError('The discrepancy changed; reload and retry')
      }
      return {
        discrepancy: { ...record.discrepancy, status: 'resolved' as const, resolvedAt: now, updatedAt: now },
        reversalLedgerId: reversalId,
      }
    },

    reconciliation,
  }
}

export type RetentionService = ReturnType<typeof createRetentionService>
