import { Buffer } from 'node:buffer'

import type {
  DeliveryNoteCount,
  DeliveryNoteCreate,
  DeliveryNoteSubmission,
  NoteLinkRecipient,
  SessionUser,
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
  orderLines,
  orders,
  outboxEvents,
  reorderAlerts,
  stockLedger,
  stores,
  users,
} from './schema'
import { requireActiveFieldStaff, resolveFieldStaffRecipient } from './notifications'
import { reconcileReorderAlertsForLedger } from './reorder'
import { DataConflictError, DataNotFoundError, type AuditActor } from './services'

export type DeliveryConfig = {
  timezone: string
  deliveryNoteNumberPrefix: string
  tokenSecret: string
  tokenTtlSeconds: number
  publicAppUrl: string
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

export function createDeliveryService(db: Database, config: DeliveryConfig) {
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
        noteType: 'delivery_note',
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

  async function nextDnNumber(now: Date) {
    const result = await db.execute<{ value: string }>(sql`SELECT nextval('delivery_note_number_seq')::text AS value`)
    const value = result.rows[0]?.value
    if (!value) throw new Error('Could not allocate a delivery note number')
    return `${config.deliveryNoteNumberPrefix}-${yearAt(now, config.timezone)}-${BigInt(value).toString().padStart(6, '0')}`
  }

  async function noteHeader(id: string, actor?: SessionUser) {
    const storeScope = actor?.storeId ? eq(deliveryNotes.storeId, actor.storeId) : undefined
    const [note] = await db
      .select({
        id: deliveryNotes.id,
        dnNumber: deliveryNotes.dnNumber,
        orderId: deliveryNotes.orderId,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        customerName: customers.name,
        customerAddress: customers.address,
        storeId: deliveryNotes.storeId,
        storeName: sql<string | null>`(SELECT name FROM ${stores} WHERE id = ${deliveryNotes.storeId})`,
        storeAddress: sql<string | null>`(SELECT address FROM ${stores} WHERE id = ${deliveryNotes.storeId})`,
        status: deliveryNotes.status,
        submittedBy: deliveryNotes.submittedBy,
        submittedByName: sql<string | null>`(SELECT name FROM ${users} WHERE id = ${deliveryNotes.submittedBy})`,
        approvedBy: deliveryNotes.approvedBy,
        approvedByName: sql<string | null>`(SELECT name FROM ${users} WHERE id = ${deliveryNotes.approvedBy})`,
        submittedAt: deliveryNotes.submittedAt,
        approvedAt: deliveryNotes.approvedAt,
        createdAt: deliveryNotes.createdAt,
        updatedAt: deliveryNotes.updatedAt,
      })
      .from(deliveryNotes)
      .innerJoin(orders, eq(deliveryNotes.orderId, orders.id))
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(storeScope ? and(eq(deliveryNotes.id, id), storeScope) : eq(deliveryNotes.id, id))
      .limit(1)
    if (!note) throw new DataNotFoundError('Delivery note not found')
    return note
  }

  async function noteDetail(id: string, actor?: SessionUser) {
    const note = await noteHeader(id, actor)
    const lines = await db
      .select({
        id: deliveryNoteLines.id,
        equipmentItemId: deliveryNoteLines.equipmentItemId,
        equipmentName: equipmentItems.name,
        unitOfMeasure: equipmentItems.unitOfMeasure,
        issuedQty: deliveryNoteLines.issuedQty,
        handedOverQty: deliveryNoteLines.handedOverQty,
        countedQty: deliveryNoteLines.countedQty,
        mismatchReason: deliveryNoteLines.mismatchReason,
        mismatchDetail: deliveryNoteLines.mismatchDetail,
      })
      .from(deliveryNoteLines)
      .innerJoin(equipmentItems, eq(deliveryNoteLines.equipmentItemId, equipmentItems.id))
      .where(eq(deliveryNoteLines.deliveryNoteId, id))
      .orderBy(equipmentItems.name)
    return {
      ...note,
      noteType: 'delivery_note' as const,
      lines: lines.map((line) => ({
        ...line,
        countDifference: line.countedQty === null ? null : line.countedQty - line.handedOverQty,
      })),
    }
  }

  async function tokenRecord(raw: string, requestId: string) {
    const hash = await sha256(raw)
    const [token] = await db.select().from(noteTokens).where(eq(noteTokens.tokenHash, hash)).limit(1)
    if (!token || token.noteType !== 'delivery_note') {
      await db.insert(auditLogs).values({ actorType: 'token', actorId: null, action: 'note_token.denied', entityType: 'note_token', entityId: null, before: null, after: { reason: 'not_found' }, requestId })
      throw new DataNotFoundError('Note link not found')
    }
    if (token.status === 'revoked' || token.expiresAt <= new Date()) {
      await db.insert(auditLogs).values({ actorType: 'token', actorId: token.id, action: 'note_token.denied', entityType: 'delivery_note', entityId: token.noteId, before: null, after: { reason: token.status === 'revoked' ? 'revoked' : 'expired' }, requestId })
      throw new DataConflictError('The note link is expired or revoked')
    }
    return token
  }

  function requireStore(actor: SessionUser) {
    if (!actor.storeId) throw new DataConflictError('A store-scoped user is required')
    return actor.storeId
  }

  return {
    async resolveTokenType(raw: string, requestId: string) {
      const [token] = await db.select().from(noteTokens)
        .where(eq(noteTokens.tokenHash, await sha256(raw))).limit(1)
      if (!token || !['delivery_note', 'retention_note'].includes(token.noteType)) {
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
          entityType: token.noteType, entityId: token.noteId, before: null,
          after: { reason: token.status === 'revoked' ? 'revoked' : 'expired' }, requestId,
        })
        throw new DataConflictError('The note link is expired or revoked')
      }
      return token.noteType as 'delivery_note' | 'retention_note'
    },

    async createFromOrder(orderId: string, input: DeliveryNoteCreate, actor: AuditActor) {
      const [order] = await db
        .select({ id: orders.id, status: orders.status, customerId: orders.customerId, storeId: customers.storeId })
        .from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(actor.storeId ? and(eq(orders.id, orderId), eq(customers.storeId, actor.storeId)) : eq(orders.id, orderId))
        .limit(1)
      if (!order) throw new DataNotFoundError('Order not found')
      if (order.status !== 'open') throw new DataConflictError('Delivery notes require an open order')
      await requireActiveFieldStaff(db, input.fieldStaffUserId, order.storeId)
      const sourceLines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(orderLines.equipmentItemId)
      if (sourceLines.length === 0) throw new DataConflictError('The order has no lines')
      const sourceByItem = new Map(sourceLines.map((line) => [line.equipmentItemId, line]))
      if (input.lines.some((line) => !sourceByItem.has(line.equipmentItemId))) throw new DataConflictError('Every delivery item must belong to the order')
      const alreadyIssued = await db.select({
        equipmentItemId: deliveryNoteLines.equipmentItemId,
        quantity: sql<number>`COALESCE(SUM(${deliveryNoteLines.issuedQty}), 0)::int`,
      }).from(deliveryNoteLines).innerJoin(deliveryNotes, eq(deliveryNoteLines.deliveryNoteId, deliveryNotes.id))
        .where(and(eq(deliveryNotes.orderId, orderId), sql`${deliveryNotes.status} <> 'rejected'`))
        .groupBy(deliveryNoteLines.equipmentItemId)
      const issuedByItem = new Map(alreadyIssued.map((line) => [line.equipmentItemId, line.quantity]))
      for (const line of input.lines) {
        const ordered = sourceByItem.get(line.equipmentItemId)!
        if ((issuedByItem.get(line.equipmentItemId) ?? 0) + line.issuedQty > ordered.quantity) {
          throw new DataConflictError('Delivery quantities exceed the remaining ordered quantity')
        }
      }
      const now = new Date()
      const noteId = crypto.randomUUID()
      const dnNumber = await nextDnNumber(now)
      const token = await tokenValues(noteId, actor.id, now)
      const note = {
        id: noteId,
        dnNumber,
        orderId,
        storeId: order.storeId,
        status: 'draft' as const,
        submittedBy: null,
        approvedBy: null,
        submittedAt: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      const requestedLines = input.lines.map((line) => ({
        id: crypto.randomUUID(), equipment_item_id: line.equipmentItemId, issued_qty: line.issuedQty,
      }))
      await db.batch([
        db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`),
        db.insert(deliveryNotes).values(note),
        db.execute(sql`INSERT INTO ${deliveryNoteLines} (id, delivery_note_id, equipment_item_id, issued_qty, handed_over_qty, counted_qty, mismatch_reason, mismatch_detail)
          SELECT requested.id, ${noteId}::uuid, requested.equipment_item_id, requested.issued_qty, requested.issued_qty, NULL, NULL, NULL
          FROM jsonb_to_recordset(${JSON.stringify(requestedLines)}::jsonb) AS requested(id uuid, equipment_item_id uuid, issued_qty integer)
          JOIN ${orderLines} ordered ON ordered.order_id = ${orderId}::uuid AND ordered.equipment_item_id = requested.equipment_item_id
          WHERE requested.issued_qty <= ordered.quantity - COALESCE((
            SELECT SUM(existing_line.issued_qty) FROM ${deliveryNoteLines} existing_line
            JOIN ${deliveryNotes} existing_note ON existing_note.id = existing_line.delivery_note_id
            WHERE existing_note.order_id = ${orderId}::uuid AND existing_note.status <> 'rejected'
              AND existing_line.equipment_item_id = requested.equipment_item_id
          ), 0)`),
        db.insert(noteTokens).values(token.row),
        db.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          eventType: 'delivery_note_link_created',
          aggregateType: 'delivery_note',
          aggregateId: noteId,
          idempotencyKey: 'delivery_note_link_created:' + noteId + ':' + token.row.id,
          payload: {
            deliveryNoteId: noteId,
            tokenId: token.row.id,
            recipientUserId: input.fieldStaffUserId,
            initiatedByUserId: actor.id,
            requestId: actor.requestId,
          },
        }),
        db.insert(auditLogs).values({
          actorType: 'user', actorId: actor.id, action: 'delivery_note.create', entityType: 'delivery_note',
          entityId: noteId, before: null, after: snapshot(note), requestId: actor.requestId,
        }),
        db.execute(sql`SELECT 1 / CASE WHEN COUNT(*) = ${requestedLines.length} THEN 1 ELSE 0 END
          FROM ${deliveryNoteLines} WHERE delivery_note_id = ${noteId}::uuid`),
      ])
      return { ...(await noteDetail(noteId, actor)), submissionLink: submissionLink(token.raw), tokenExpiresAt: token.row.expiresAt }
    },

    async listForOrder(orderId: string, actor: SessionUser) {
      const storeScope = actor.storeId ? eq(deliveryNotes.storeId, actor.storeId) : undefined
      const condition = storeScope ? and(eq(deliveryNotes.orderId, orderId), storeScope) : eq(deliveryNotes.orderId, orderId)
      return db.select({
        id: deliveryNotes.id, dnNumber: deliveryNotes.dnNumber, orderId: deliveryNotes.orderId,
        storeId: deliveryNotes.storeId, status: deliveryNotes.status, createdAt: deliveryNotes.createdAt,
        submittedAt: deliveryNotes.submittedAt, approvedAt: deliveryNotes.approvedAt,
      }).from(deliveryNotes).where(condition).orderBy(desc(deliveryNotes.createdAt))
    },

    getDeliveryNote: noteDetail,

    async getLink(id: string, actor: AuditActor) {
      const note = await noteHeader(id, actor)
      if (note.status === 'approved') throw new DataConflictError('An approved delivery note no longer accepts field submissions')
      let [token] = await db.select().from(noteTokens).where(and(
        eq(noteTokens.noteType, 'delivery_note'), eq(noteTokens.noteId, id), inArray(noteTokens.status, ['active', 'used']),
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
          db.insert(auditLogs).values({ actorType: 'user', actorId: actor.id, action: 'note_token.create', entityType: 'delivery_note', entityId: id, before: null, after: { tokenId: created.row.id, expiresAt: created.row.expiresAt.toISOString() }, requestId: actor.requestId }),
        ])
        return { submissionLink: submissionLink(created.raw), expiresAt: created.row.expiresAt }
      }
      return { submissionLink: submissionLink(await rawToken(token.id)), expiresAt: token.expiresAt }
    },

    async regenerateLink(id: string, input: NoteLinkRecipient, actor: AuditActor) {
      const note = await noteHeader(id, actor)
      if (note.status === 'approved') throw new DataConflictError('An approved delivery note cannot receive a new link')
      if (!note.storeId) throw new DataConflictError('The delivery note has no store')
      const recipient = await resolveFieldStaffRecipient(db, input.fieldStaffUserId, id, note.storeId)
      const now = new Date()
      const created = await tokenValues(id, actor.id, now)
      await db.batch([
        db.update(noteTokens).set({ status: 'revoked' }).where(and(eq(noteTokens.noteType, 'delivery_note'), eq(noteTokens.noteId, id), inArray(noteTokens.status, ['active', 'used']))),
        db.insert(noteTokens).values(created.row),
        db.insert(outboxEvents).values({
          id: crypto.randomUUID(), eventType: 'delivery_note_link_regenerated', aggregateType: 'delivery_note', aggregateId: id,
          idempotencyKey: `delivery_note_link_regenerated:${id}:${created.row.id}`,
          payload: {
            deliveryNoteId: id,
            tokenId: created.row.id,
            recipientUserId: recipient.id,
            initiatedByUserId: actor.id,
            requestId: actor.requestId,
          },
        }),
        db.insert(auditLogs).values({ actorType: 'user', actorId: actor.id, action: 'note_token.regenerate', entityType: 'delivery_note', entityId: id, before: null, after: { tokenId: created.row.id, expiresAt: created.row.expiresAt.toISOString() }, requestId: actor.requestId }),
      ])
      return { submissionLink: submissionLink(created.raw), expiresAt: created.row.expiresAt }
    },

    async readByToken(raw: string, requestId: string) {
      const token = await tokenRecord(raw, requestId)
      const note = await noteDetail(token.noteId)
      if (!['draft', 'reopened', 'pending_approval'].includes(note.status)) {
        throw new DataConflictError('The delivery note is not open for field submission')
      }
      await db.insert(auditLogs).values({
        actorType: 'token', actorId: token.id, action: 'note_token.read', entityType: 'delivery_note',
        entityId: note.id, before: null, after: { status: note.status }, requestId,
      })
      return note
    },

    async submitByToken(raw: string, input: DeliveryNoteSubmission, requestId: string) {
      const token = await tokenRecord(raw, requestId)
      const before = await noteDetail(token.noteId)
      if (!['draft', 'reopened', 'pending_approval'].includes(before.status)) throw new DataConflictError('The delivery note is not open for field submission')
      if (before.lines.some((line) => line.countedQty !== null)) throw new DataConflictError('Field correction is closed because physical counting has started')
      const known = new Map(before.lines.map((line) => [line.id, line]))
      if (input.lines.length !== before.lines.length || input.lines.some((line) => !known.has(line.lineId))) {
        throw new DataConflictError('Submission must include every delivery note line exactly once')
      }
      const normalized = input.lines.map((line) => {
        const current = known.get(line.lineId)!
        const mismatched = current.issuedQty !== line.handedOverQty
        if (mismatched && !line.mismatchReason) throw new DataConflictError('A mismatch reason is required when issued and handed-over quantities differ')
        if (mismatched && line.mismatchReason === 'other' && !line.mismatchDetail?.trim()) throw new DataConflictError('Mismatch detail is required when the reason is Other')
        return {
          lineId: line.lineId,
          handedOverQty: line.handedOverQty,
          mismatchReason: mismatched ? line.mismatchReason! : null,
          mismatchDetail: mismatched ? line.mismatchDetail?.trim() || null : null,
        }
      })
      const now = new Date()
      const pendingNotification = before.status === 'pending_approval'
        ? db.execute(sql`SELECT 1`)
        : db.insert(outboxEvents).values({
            id: crypto.randomUUID(),
            eventType: 'delivery_note_pending_approval',
            aggregateType: 'delivery_note',
            aggregateId: before.id,
            idempotencyKey: 'delivery_note_pending_approval:' + before.id + ':' + token.id,
            payload: {
              deliveryNoteId: before.id,
              noteType: 'delivery_note',
              noteNumber: before.dnNumber,
              storeId: before.storeId,
              requestId,
            },
          })
      const mutationQuery = db.execute<{ id: string }>(sql`
        WITH updated_note AS (
          UPDATE ${deliveryNotes}
          SET status = 'pending_approval', submitted_at = COALESCE(submitted_at, ${now}), updated_at = ${now}
          WHERE id = ${before.id}::uuid
            AND status IN ('draft', 'reopened', 'pending_approval')
            AND NOT EXISTS (SELECT 1 FROM ${deliveryNoteLines} WHERE delivery_note_id = ${before.id}::uuid AND counted_qty IS NOT NULL)
          RETURNING id, order_id
        ), input_lines AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(normalized)}::jsonb)
          AS x("lineId" uuid, "handedOverQty" integer, "mismatchReason" discrepancy_type, "mismatchDetail" text)
        ), updated_lines AS (
          UPDATE ${deliveryNoteLines} line
          SET handed_over_qty = input."handedOverQty", mismatch_reason = input."mismatchReason", mismatch_detail = input."mismatchDetail"
          FROM input_lines input, updated_note note
          WHERE line.id = input."lineId" AND line.delivery_note_id = note.id AND line.counted_qty IS NULL
          RETURNING line.*
        ), upserted AS (
          INSERT INTO ${discrepancies} (id, source_type, source_note_id, source_line_id, order_id, equipment_item_id, quantity, discrepancy_type, reason, responsible_party, value_cents, status, created_at, resolved_at, updated_at)
          SELECT gen_random_uuid(), 'delivery_note', ${before.id}::uuid, line.id, note.order_id, line.equipment_item_id,
            abs(line.issued_qty - line.handed_over_qty), line.mismatch_reason, line.mismatch_detail, NULL, 0, 'open', ${now}, NULL, ${now}
          FROM updated_lines line, updated_note note WHERE line.issued_qty <> line.handed_over_qty
          ON CONFLICT (source_type, source_line_id) WHERE source_line_id IS NOT NULL DO UPDATE
          SET quantity = EXCLUDED.quantity, discrepancy_type = EXCLUDED.discrepancy_type, reason = EXCLUDED.reason,
            responsible_party = NULL, status = 'open', resolved_at = NULL, updated_at = EXCLUDED.updated_at
          RETURNING id
        ), resolved AS (
          UPDATE ${discrepancies} discrepancy
          SET status = 'resolved', resolved_at = ${now}, updated_at = ${now}
          FROM updated_lines line
          WHERE discrepancy.source_type = 'delivery_note' AND discrepancy.source_line_id = line.id
            AND line.issued_qty = line.handed_over_qty AND discrepancy.status = 'open'
          RETURNING discrepancy.id
        ), used_token AS (
          UPDATE ${noteTokens} SET status = 'used', used_at = COALESCE(used_at, ${now})
          WHERE id = ${token.id}::uuid AND EXISTS (SELECT 1 FROM updated_note)
        )
        SELECT id FROM updated_note
      `)
      const [mutation] = await db.batch([
        mutationQuery,
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'token'::audit_actor_type, ${token.id}::uuid, 'discrepancy.record', 'discrepancy', id,
          NULL, to_jsonb(discrepancy.*), ${requestId} FROM ${discrepancies}
          WHERE source_type = 'delivery_note' AND source_note_id = ${before.id}::uuid AND updated_at = ${now}`),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'token'::audit_actor_type, ${token.id}::uuid, 'delivery_note.submit', 'delivery_note', note.id,
          ${JSON.stringify(snapshot(before))}::jsonb, to_jsonb(note.*), ${requestId} FROM ${deliveryNotes} note
          WHERE note.id = ${before.id}::uuid AND note.status = 'pending_approval' AND note.updated_at = ${now}`),
        pendingNotification,
      ])
      if (!mutation.rows[0]) throw new DataConflictError('Counting started or the delivery note changed; reload and retry')
      return noteDetail(before.id)
    },

    async listApprovals(actor: SessionUser) {
      const storeId = requireStore(actor)
      return db.select({
        id: deliveryNotes.id, dnNumber: deliveryNotes.dnNumber, orderId: deliveryNotes.orderId,
        orderNumber: orders.orderNumber, customerName: customers.name, status: deliveryNotes.status,
        submittedAt: deliveryNotes.submittedAt, createdAt: deliveryNotes.createdAt,
      }).from(deliveryNotes).innerJoin(orders, eq(deliveryNotes.orderId, orders.id)).innerJoin(customers, eq(orders.customerId, customers.id))
        .where(and(eq(deliveryNotes.storeId, storeId), inArray(deliveryNotes.status, ['pending_approval', 'rejected', 'reopened'])))
        .orderBy(desc(deliveryNotes.submittedAt), desc(deliveryNotes.createdAt))
    },

    async countNote(id: string, input: DeliveryNoteCount, actor: AuditActor) {
      const before = await noteDetail(id, actor)
      if (before.status !== 'pending_approval') throw new DataConflictError('Only a pending delivery note may be counted')
      const knownIds = new Set(before.lines.map((line) => line.id))
      if (input.lines.length !== before.lines.length || input.lines.some((line) => !knownIds.has(line.lineId))) throw new DataConflictError('Physical count must include every delivery note line exactly once')
      const now = new Date()
      const mutationQuery = db.execute<{ id: string }>(sql`
        WITH updated_note AS (
          UPDATE ${deliveryNotes} SET updated_at = ${now}
          WHERE id = ${id}::uuid AND store_id = ${requireStore(actor)}::uuid AND status = 'pending_approval'
          RETURNING id
        ), input_lines AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(input.lines)}::jsonb) AS x("lineId" uuid, "countedQty" integer)
        ), updated_lines AS (
          UPDATE ${deliveryNoteLines} line SET counted_qty = input."countedQty"
          FROM input_lines input, updated_note note
          WHERE line.id = input."lineId" AND line.delivery_note_id = note.id
        ), revoked AS (
          UPDATE ${noteTokens} SET status = 'revoked'
          WHERE note_type = 'delivery_note' AND note_id = ${id}::uuid AND status IN ('active', 'used') AND EXISTS (SELECT 1 FROM updated_note)
        ) SELECT id FROM updated_note
      `)
      const [mutation] = await db.batch([
        mutationQuery,
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'delivery_note.count', 'delivery_note', note.id,
          ${JSON.stringify(snapshot(before))}::jsonb, to_jsonb(note.*), ${actor.requestId} FROM ${deliveryNotes} note
          WHERE note.id = ${id}::uuid AND note.status = 'pending_approval' AND note.updated_at = ${now}`),
      ])
      if (!mutation.rows[0]) throw new DataConflictError('The delivery note changed; reload and retry')
      return noteDetail(id, actor)
    },

    async approveNote(id: string, actor: AuditActor) {
      const before = await noteDetail(id, actor)
      if (before.status !== 'pending_approval') throw new DataConflictError('Only a pending delivery note may be approved')
      if (before.lines.some((line) => line.countedQty === null)) throw new DataConflictError('Physical count is required for every line before approval')
      const now = new Date()
      const ledgerInsert = db.execute(sql`INSERT INTO ${stockLedger} (id, equipment_item_id, store_id, source_type, source_note_id, direction, quantity_delta, created_by, created_at)
        SELECT gen_random_uuid(), line.equipment_item_id, note.store_id, 'delivery_note', note.id, 'out'::stock_direction,
          -line.counted_qty, ${actor.id}::uuid, ${now}
        FROM ${deliveryNoteLines} line JOIN ${deliveryNotes} note ON note.id = line.delivery_note_id
        WHERE note.id = ${id}::uuid AND note.status = 'approved' AND note.updated_at = ${now} AND line.counted_qty > 0`)
      const [updated] = await db.batch([
        db.update(deliveryNotes).set({ status: 'approved', approvedBy: actor.id, approvedAt: now, updatedAt: now })
          .where(and(eq(deliveryNotes.id, id), eq(deliveryNotes.storeId, requireStore(actor)), eq(deliveryNotes.status, 'pending_approval'), sql`NOT EXISTS (SELECT 1 FROM ${deliveryNoteLines} WHERE delivery_note_id = ${id}::uuid AND counted_qty IS NULL)`)).returning(),
        ledgerInsert,
        db.execute(reconcileReorderAlertsForLedger('delivery_note', id, now, actor)),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'stock_ledger.post', 'stock_ledger', ledger.id,
          NULL, to_jsonb(ledger.*), ${actor.requestId} FROM ${stockLedger} ledger
          WHERE ledger.source_type = 'delivery_note' AND ledger.source_note_id = ${id}::uuid AND ledger.created_at = ${now}`),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'delivery_note.approve', 'delivery_note', note.id,
          ${JSON.stringify(snapshot(before))}::jsonb, to_jsonb(note.*), ${actor.requestId} FROM ${deliveryNotes} note
          WHERE note.id = ${id}::uuid AND note.status = 'approved' AND note.updated_at = ${now}`),
        db.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          eventType: 'delivery_note_approved',
          aggregateType: 'delivery_note',
          aggregateId: id,
          idempotencyKey: 'delivery_note_approved:' + id + ':' + now.toISOString(),
          payload: {
            deliveryNoteId: id,
            noteType: 'delivery_note',
            noteNumber: before.dnNumber,
            storeId: before.storeId,
            requestId: actor.requestId,
          },
        }),
      ])
      if (!updated[0]) throw new DataConflictError('The delivery note changed; reload and retry')
      return noteDetail(id, actor)
    },

    async rejectNote(id: string, actor: AuditActor) {
      const before = await noteDetail(id, actor)
      if (before.status !== 'pending_approval') throw new DataConflictError('Only a pending delivery note may be rejected')
      const now = new Date()
      const [updated] = await db.batch([
        db.update(deliveryNotes).set({ status: 'rejected', updatedAt: now }).where(and(eq(deliveryNotes.id, id), eq(deliveryNotes.storeId, requireStore(actor)), eq(deliveryNotes.status, 'pending_approval'))).returning(),
        db.update(noteTokens).set({ status: 'revoked' }).where(and(eq(noteTokens.noteType, 'delivery_note'), eq(noteTokens.noteId, id), inArray(noteTokens.status, ['active', 'used']))),
        db.insert(auditLogs).values({ actorType: 'user', actorId: actor.id, action: 'delivery_note.reject', entityType: 'delivery_note', entityId: id, before: snapshot(before), after: { status: 'rejected' }, requestId: actor.requestId }),
      ])
      if (!updated[0]) throw new DataConflictError('The delivery note changed; reload and retry')
      return noteDetail(id, actor)
    },

    async reopenNote(id: string, actor: AuditActor) {
      const before = await noteDetail(id, actor)
      if (before.status !== 'rejected') throw new DataConflictError('Only a rejected delivery note may be reopened')
      const now = new Date()
      const created = await tokenValues(id, actor.id, now)
      const [, updated] = await db.batch([
        db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${before.orderId}))`),
        db.update(deliveryNotes).set({ status: 'reopened', submittedAt: null, updatedAt: now }).where(and(eq(deliveryNotes.id, id), eq(deliveryNotes.storeId, requireStore(actor)), eq(deliveryNotes.status, 'rejected'))).returning(),
        db.update(deliveryNoteLines).set({ countedQty: null }).where(eq(deliveryNoteLines.deliveryNoteId, id)),
        db.update(noteTokens).set({ status: 'revoked' }).where(and(eq(noteTokens.noteType, 'delivery_note'), eq(noteTokens.noteId, id), inArray(noteTokens.status, ['active', 'used']))),
        db.insert(noteTokens).values(created.row),
        db.insert(auditLogs).values({ actorType: 'user', actorId: actor.id, action: 'delivery_note.reopen', entityType: 'delivery_note', entityId: id, before: snapshot(before), after: { status: 'reopened', tokenId: created.row.id }, requestId: actor.requestId }),
        db.execute(sql`SELECT 1 / CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM (
          SELECT issued.equipment_item_id
          FROM ${deliveryNoteLines} issued
          JOIN ${deliveryNotes} note ON note.id = issued.delivery_note_id
          JOIN ${orderLines} ordered ON ordered.order_id = note.order_id AND ordered.equipment_item_id = issued.equipment_item_id
          WHERE note.order_id = ${before.orderId}::uuid AND note.status <> 'rejected'
          GROUP BY issued.equipment_item_id, ordered.quantity
          HAVING SUM(issued.issued_qty) > ordered.quantity
        ) over_issued`),
      ])
      if (!updated[0]) throw new DataConflictError('The delivery note changed; reload and retry')
      return { ...(await noteDetail(id, actor)), submissionLink: submissionLink(created.raw), tokenExpiresAt: created.row.expiresAt }
    },

    async listStock(actor: SessionUser) {
      const storeId = requireStore(actor)
      return db.select({
        equipmentItemId: equipmentItems.id,
        equipmentName: equipmentItems.name,
        unitOfMeasure: equipmentItems.unitOfMeasure,
        quantity: sql<number>`COALESCE(SUM(${stockLedger.quantityDelta}), 0)::int`,
        reorderThreshold: equipmentItems.reorderThreshold,
        reorderAlertId: reorderAlerts.id,
        reorderAlertOpenedAt: reorderAlerts.openedAt,
        isBelowReorderThreshold: sql<boolean>`COALESCE(${reorderAlerts.id} IS NOT NULL, false)`,
        currentUnitPriceCents: equipmentItems.currentUnitPriceCents,
        valueCents: sql<number>`(COALESCE(SUM(${stockLedger.quantityDelta}), 0) * ${equipmentItems.currentUnitPriceCents})::int`,
      }).from(equipmentItems)
        .leftJoin(stockLedger, and(eq(stockLedger.equipmentItemId, equipmentItems.id), eq(stockLedger.storeId, storeId)))
        .leftJoin(reorderAlerts, and(
          eq(reorderAlerts.equipmentItemId, equipmentItems.id),
          eq(reorderAlerts.storeId, storeId),
          eq(reorderAlerts.status, 'open'),
        ))
        .groupBy(equipmentItems.id, reorderAlerts.id).orderBy(equipmentItems.name)
    },
  }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
