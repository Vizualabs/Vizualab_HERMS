import { handle } from 'hono/aws-lambda'

import app from './index'

export const handler = handle(app)
