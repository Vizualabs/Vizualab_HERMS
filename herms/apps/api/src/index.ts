import {
  createDatabase,
  createDbHealthCheck,
  createIdentityService,
  createMasterDataService,
} from '@herms/db'
import { parseApiEnv } from '@herms/shared'

import { createApp } from './app'

const env = parseApiEnv(process.env)
const db = createDatabase(env.DATABASE_URL)
const app = createApp({
  healthCheck: createDbHealthCheck(env.DATABASE_URL),
  identity: createIdentityService(db),
  masterData: createMasterDataService(db),
  auth: {
    secret: env.AUTH_SECRET,
    ttlSeconds: env.SESSION_TTL_SECONDS,
    secureCookie: env.SESSION_COOKIE_SECURE,
  },
})

export default app
export { app }
