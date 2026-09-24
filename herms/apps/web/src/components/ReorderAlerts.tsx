import { useEffect, useRef } from 'react'

import { useConfirm } from './ConfirmDialog'

export type ReorderItem = {
  id: string
  name: string
  quantity: number
  reorderThreshold: number
}

const storageKey = (userId: string, surface: string) =>
  `herms.reorder-alerts-seen:${userId}:${surface}`

export function itemsBelowReorder(
  rows: Array<{
    id: string
    name: string
    quantity: number
    reorderThreshold?: number | null
    isBelowReorderThreshold?: boolean
  }>,
) {
  return rows.filter((row) => {
    const threshold = row.reorderThreshold == null ? null : Number(row.reorderThreshold)
    return row.isBelowReorderThreshold
      || (threshold != null && Number.isFinite(threshold) && row.quantity <= threshold)
  }).map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    reorderThreshold: Number(row.reorderThreshold ?? 0),
  }))
}

export function unseenReorderItems(items: ReorderItem[], seenIds: string[]) {
  const seen = new Set(seenIds)
  return items.filter((item) => !seen.has(item.id))
}

export function loadSeenReorderIds(userId: string, surface: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId, surface)) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export function saveSeenReorderIds(userId: string, surface: string, ids: string[]) {
  localStorage.setItem(storageKey(userId, surface), JSON.stringify([...new Set(ids)]))
}

export function reorderAlertMessage(items: ReorderItem[]) {
  const shown = items.slice(0, 5).map((item) => (
    `${item.name}: in stock ${item.quantity}, reorder level ${item.reorderThreshold}`
  ))
  const extra = items.length > 5 ? `\nAnd ${items.length - 5} more items.` : ''
  return `These items are at or below their reorder level.\n\n${shown.join('\n')}${extra}`
}

function itemsSignature(items: ReorderItem[]) {
  return items.map((item) => `${item.id}:${item.quantity}:${item.reorderThreshold}`).join('|')
}

export function ReorderAlerts({
  userId,
  items,
  surface,
  ready = true,
}: {
  userId: string
  items: ReorderItem[]
  surface: 'dashboard' | 'stock'
  ready?: boolean
}) {
  const confirm = useConfirm()
  const alerting = useRef(false)
  const itemKey = itemsSignature(items)

  useEffect(() => {
    if (!ready || alerting.current || items.length === 0) return
    const unseen = unseenReorderItems(items, loadSeenReorderIds(userId, surface))
    if (unseen.length === 0) return
    alerting.current = true
    void confirm({
      title: 'Reorder level reached',
      message: reorderAlertMessage(unseen),
      confirmLabel: 'OK',
      hideCancel: true,
    }).then(() => {
      saveSeenReorderIds(userId, surface, [...loadSeenReorderIds(userId, surface), ...unseen.map((item) => item.id)])
      alerting.current = false
    })
  }, [confirm, itemKey, items, ready, surface, userId])

  return null
}
