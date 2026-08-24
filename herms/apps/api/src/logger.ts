export type LogLevel = 'info' | 'error'

export type LogEntry = {
  level: LogLevel
  event: string
  requestId?: string
  [key: string]: unknown
}

export type AppLogger = (entry: LogEntry) => void

export const jsonLogger: AppLogger = (entry) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'herms-api',
      ...entry,
    }),
  )
}
