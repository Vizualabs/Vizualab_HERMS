import { eq, sql } from 'drizzle-orm'

import { parseMigrationEnv } from '@herms/shared'

import { createDatabase } from './client'
import { auditLogs, stores, users } from './schema'

const { MIGRATION_DATABASE_URL } = parseMigrationEnv(process.env)
const email = process.env.SUPER_USER_EMAIL?.trim().toLowerCase()
const password = process.env.SUPER_USER_PASSWORD
const name = process.env.SUPER_USER_NAME?.trim() || 'HERMS Super User'
const requestedStoreId = process.env.SUPER_USER_STORE_ID?.trim()

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('SUPER_USER_EMAIL must be a valid email address')
}
if (!password || password.length < 16) {
  throw new Error('SUPER_USER_PASSWORD must contain at least 16 characters')
}

const db = createDatabase(MIGRATION_DATABASE_URL)
const [store] = requestedStoreId
  ? await db.select({ id: stores.id }).from(stores).where(eq(stores.id, requestedStoreId)).limit(1)
  : await db.select({ id: stores.id }).from(stores).orderBy(stores.createdAt).limit(1)

if (!store) {
  throw new Error(requestedStoreId
    ? 'SUPER_USER_STORE_ID does not identify an existing store'
    : 'At least one store must exist before provisioning the Super User')
}

const [existing] = await db.select({
  id: users.id,
  name: users.name,
  role: users.role,
  storeId: users.storeId,
  active: users.active,
}).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1)

const passwordHash = await Bun.password.hash(password, {
  algorithm: 'argon2id',
  memoryCost: 65_536,
  timeCost: 3,
})
const now = new Date()
const userId = existing?.id ?? crypto.randomUUID()

if (existing) {
  await db.update(users).set({
    name,
    role: 'super_user',
    storeId: store.id,
    passwordHash,
    active: true,
    isDeputyAdmin: false,
    updatedAt: now,
  }).where(eq(users.id, userId))
} else {
  await db.insert(users).values({
    id: userId,
    name,
    role: 'super_user',
    storeId: store.id,
    email,
    passwordHash,
    active: true,
    isDeputyAdmin: false,
    createdAt: now,
    updatedAt: now,
  })
}

await db.insert(auditLogs).values({
  actorType: 'user',
  actorId: userId,
  action: existing ? 'user.super_user.update' : 'user.super_user.create',
  entityType: 'user',
  entityId: userId,
  before: existing ?? null,
  after: {
    name,
    email,
    role: 'super_user',
    storeId: store.id,
    active: true,
  },
  requestId: crypto.randomUUID(),
  createdAt: now,
})

console.log(JSON.stringify({
  event: existing ? 'super_user_updated' : 'super_user_created',
  userId,
  email,
  role: 'super_user',
  storeId: store.id,
}))
