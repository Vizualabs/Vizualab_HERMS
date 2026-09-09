import { useEffect, useState } from 'react'

export const REPORTING_REFRESH_INTERVAL_MS = 60_000

export function currentColomboMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (!year || !month) throw new Error('The current reporting month could not be resolved')
  return `${year}-${month}`
}

export function useCurrentColomboMonth() {
  const [month, setMonth] = useState(() => currentColomboMonth())

  useEffect(() => {
    const syncMonth = () => {
      const nextMonth = currentColomboMonth()
      setMonth((currentMonth) => currentMonth === nextMonth ? currentMonth : nextMonth)
    }
    const interval = window.setInterval(syncMonth, REPORTING_REFRESH_INTERVAL_MS)
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') syncMonth()
    }

    window.addEventListener('focus', syncMonth)
    document.addEventListener('visibilitychange', syncWhenVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', syncMonth)
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [])

  return month
}
