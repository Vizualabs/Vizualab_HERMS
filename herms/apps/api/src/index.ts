import { createDbHealthCheck } from '@herms/db'
import { parseRuntimeEnv } from '@herms/shared'

import { createApp } from './app'

const env = parseRuntimeEnv(process.env)
const app = createApp({
  healthCheck: createDbHealthCheck(env.DATABASE_URL),
})

export default app
export { app }
