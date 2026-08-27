import {
  createDatabase,
  createDbHealthCheck,
  createCommercialService,
  createDeliveryService,
  createFinanceService,
  createIdentityService,
  createMasterDataService,
  createNotificationService,
  createRetentionService,
} from '@herms/db'
import { parseApiEnv } from '@herms/shared'

import { createApp } from './app'

const env = parseApiEnv(process.env)
const db = createDatabase(env.DATABASE_URL)
const app = createApp({
  healthCheck: createDbHealthCheck(env.DATABASE_URL),
  identity: createIdentityService(db),
  masterData: createMasterDataService(db),
  notifications: createNotificationService(db, {
    businessCurrency: env.BUSINESS_CURRENCY,
    noteTokenSecret: env.NOTE_TOKEN_SECRET,
    publicAppUrl: env.PUBLIC_APP_URL,
  }),
  commercial: createCommercialService(db, {
    timezone: env.BUSINESS_TIMEZONE,
    currency: env.BUSINESS_CURRENCY,
    quotationExpiryDays: env.QUOTATION_EXPIRY_DAYS,
    quotationNumberPrefix: env.QUOTATION_NUMBER_PREFIX,
    orderNumberPrefix: env.ORDER_NUMBER_PREFIX,
  }),
  delivery: createDeliveryService(db, {
    timezone: env.BUSINESS_TIMEZONE,
    deliveryNoteNumberPrefix: env.DELIVERY_NOTE_NUMBER_PREFIX,
    tokenSecret: env.NOTE_TOKEN_SECRET,
    tokenTtlSeconds: env.NOTE_TOKEN_TTL_SECONDS,
    publicAppUrl: env.PUBLIC_APP_URL,
  }),
  finance: createFinanceService(db, {
    timezone: env.BUSINESS_TIMEZONE,
    currency: env.BUSINESS_CURRENCY,
  }),
  retention: createRetentionService(db, {
    timezone: env.BUSINESS_TIMEZONE,
    retentionNoteNumberPrefix: env.RETENTION_NOTE_NUMBER_PREFIX,
    tokenSecret: env.NOTE_TOKEN_SECRET,
    tokenTtlSeconds: env.NOTE_TOKEN_TTL_SECONDS,
    publicAppUrl: env.PUBLIC_APP_URL,
  }),
  auth: {
    secret: env.AUTH_SECRET,
    ttlSeconds: env.SESSION_TTL_SECONDS,
    secureCookie: env.SESSION_COOKIE_SECURE,
  },
})

export default app
export { app }
