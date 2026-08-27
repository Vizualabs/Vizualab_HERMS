import { createDatabase, createEscalationService } from '@herms/db'
import { parsePriceEscalationEnv } from '@herms/shared'

type ScheduledEvent = {
  id?: string
  time?: string
}

export async function handler(event: ScheduledEvent = {}) {
  const env = parsePriceEscalationEnv(process.env)
  const runAt = event.time ? new Date(event.time) : new Date()
  if (Number.isNaN(runAt.getTime())) throw new Error('Scheduled event time is invalid')
  const service = createEscalationService(createDatabase(env.DATABASE_URL), {
    effectiveDate: new Date(env.PRICE_ESCALATION_EFFECTIVE_DATE),
    mode: env.PRICE_ESCALATION_MODE,
  })
  const result = await service.run(
    runAt,
    `scheduled-escalation/${event.id ?? runAt.toISOString()}`,
  )
  return {
    mode: result.mode,
    dueEffectiveDates: result.effectiveDates.map((date) => date.toISOString()),
    escalatedCount: result.escalated.length,
    skippedMissingPriceCount: result.skippedMissingPrice.length,
  }
}
