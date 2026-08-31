import { parseSeedEnv, USER_ROLES } from '@herms/shared'

import { createDatabase } from './client'
import {
  auditLogs,
  customerPrices,
  customers,
  equipmentItems,
  priceHistory,
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
const systemAdminId = '20000000-0000-4000-8000-000000000006'
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

const seedCustomers = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    storeId,
    name: 'Demo Recurring Customer',
    type: 'recurring' as const,
    email: 'recurring.customer@example.test',
    phone: '+94771000001',
    createdAt: seededAt,
    updatedAt: seededAt,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    storeId,
    name: 'Demo New Customer A',
    type: 'new' as const,
    email: 'new.customer.a@example.test',
    phone: '+94771000002',
    createdAt: seededAt,
    updatedAt: seededAt,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    storeId,
    name: 'Demo New Customer B',
    type: 'new' as const,
    email: 'new.customer.b@example.test',
    phone: '+94771000003',
    createdAt: seededAt,
    updatedAt: seededAt,
  },
]

const itemFixtures = [
  ['Adjustable Prop', 'Shoring', 125_000],
  ['Scaffolding Frame', 'Scaffolding', 180_000],
  ['Cross Brace', 'Scaffolding', 45_000],
  ['Base Jack', 'Scaffolding', 62_500],
  ['U-Head Jack', 'Shoring', 68_000],
  ['Steel Plank', 'Scaffolding', 95_000],
  ['Swivel Coupler', 'Accessories', 32_500],
  ['Access Ladder', 'Access', 150_000],
] as const

const seedItems = itemFixtures.map(([name, category, currentUnitPriceCents], index) => ({
  id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name,
  category,
  unitOfMeasure: 'unit',
  currentUnitPriceCents,
  createdAt: seededAt,
  updatedAt: seededAt,
}))

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

for (const customer of seedCustomers) {
    await db.insert(customers).values(customer).onConflictDoUpdate({
      target: customers.id,
      set: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        updatedAt: new Date(),
      },
    })
}

for (const item of seedItems) {
    await db.insert(equipmentItems).values(item).onConflictDoNothing()
    await db
      .insert(priceHistory)
      .values({
        id: item.id.replace('40000000', '50000000'),
        equipmentItemId: item.id,
        oldPriceCents: null,
        newPriceCents: item.currentUnitPriceCents,
        effectiveDate: seededAt,
        reason: 'negotiated',
        createdBy: systemAdminId,
        createdAt: seededAt,
      })
      .onConflictDoNothing()
    await db
      .insert(customerPrices)
      .values({
        id: item.id.replace('40000000', '60000000'),
        customerId: seedCustomers[0]!.id,
        equipmentItemId: item.id,
        unitPriceCents: item.currentUnitPriceCents,
        effectiveFrom: seededAt,
        createdAt: seededAt,
      })
      .onConflictDoNothing()
}

await db
    .insert(auditLogs)
    .values({
      id: '70000000-0000-4000-8000-000000000001',
      actorType: 'user',
      actorId: systemAdminId,
      action: 'seed.bootstrap',
      entityType: 'store',
      entityId: storeId,
      after: {
        storeName: env.SEED_STORE_NAME,
        users: seedUsers.length,
        customers: seedCustomers.length,
        equipmentItems: seedItems.length,
      },
      requestId: 'phase-1-seed',
      createdAt: seededAt,
    })
    .onConflictDoNothing()

console.log(
  JSON.stringify({
    event: 'seed_completed',
    users: seedUsers.length,
    customers: seedCustomers.length,
    equipmentItems: seedItems.length,
  }),
)
