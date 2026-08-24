import { parseApiEnv } from '@herms/shared'

import app from './index'

const { PORT } = parseApiEnv(process.env)

export default {
  port: PORT,
  fetch: app.fetch,
}
