import { parseSeedEnv, USER_ROLES } from '@herms/shared'

import { createDatabase } from './client'
import {
  stores,
  users,
} from './schema'

const env = parseSeedEnv(process.env)
const db = createDatabase(env.MIGRATION_DATABASE_URL)
const passwordHash = await Bun.password.hash(env.SEED_USER_PASSWORD, {
  algorithm: 'argon2id',
  memoryCost: 65_536,
  timeCost: 3,
})

const storeId = '10000000-0000-4000-8000-000000000001'
const seededAt = new Date('2026-08-24T00:00:00.000Z')

const seedUsers = USER_ROLES.filter((role) => role !== 'super_user').map((role, index) => {
  const localPart = {
    business_owner: 'owner',
    sales: 'sales',
    field_staff: 'field',
    store_admin: 'store-admin',
    finance: 'finance',
    system_admin: 'system-admin',
  }[role]
  return {
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    storeId: role === 'business_owner' || role === 'system_admin' ? null : storeId,
    name: role
      .split('_')
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' '),
    role,
    email: `${localPart}@herms.local`,
    phone: '+9477000000' + String(index + 1),
    passwordHash,
    active: true,
    isDeputyAdmin: false,
    createdAt: seededAt,
    updatedAt: seededAt,
  }
})

await db
    .insert(stores)
    .values({
      id: storeId,
      name: env.SEED_STORE_NAME,
      address: env.SEED_STORE_ADDRESS || null,
      createdAt: seededAt,
    })
    .onConflictDoUpdate({
      target: stores.id,
      set: { name: env.SEED_STORE_NAME, address: env.SEED_STORE_ADDRESS || null },
    })

for (const user of seedUsers) {
    await db.insert(users).values(user).onConflictDoUpdate({
      target: users.id,
      set: {
        name: user.name,
        storeId: user.storeId,
        role: user.role,
        email: user.email,
        phone: user.phone,
        passwordHash,
        active: true,
        updatedAt: new Date(),
      },
    })
}

console.log(
  JSON.stringify({
    event: 'seed_completed',
    stores: 1,
    users: seedUsers.length,
  }),
)
