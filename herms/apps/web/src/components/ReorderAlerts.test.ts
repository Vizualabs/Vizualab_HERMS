import { describe, expect, test } from 'bun:test'

import { itemsBelowReorder, reorderAlertMessage, unseenReorderItems } from './ReorderAlerts'

describe('reorder alerts', () => {
  test('keeps only items at or below the reorder level', () => {
    expect(itemsBelowReorder([
      { id: 'a', name: 'Plates', quantity: 4, reorderThreshold: 10, isBelowReorderThreshold: true },
      { id: 'b', name: 'Glasses', quantity: 20, reorderThreshold: 10, isBelowReorderThreshold: false },
    ])).toEqual([{ id: 'a', name: 'Plates', quantity: 4, reorderThreshold: 10 }])
  })

  test('skips items already acknowledged', () => {
    const items = [{ id: 'a', name: 'Plates', quantity: 4, reorderThreshold: 10 }]
    expect(unseenReorderItems(items, ['a'])).toEqual([])
    expect(unseenReorderItems(items, [])).toEqual(items)
  })

  test('names the item and both quantities in the popup', () => {
    expect(reorderAlertMessage([
      { id: 'a', name: 'Dinner Plate', quantity: 4, reorderThreshold: 10 },
    ])).toContain('Dinner Plate: in stock 4, reorder level 10')
  })
})
