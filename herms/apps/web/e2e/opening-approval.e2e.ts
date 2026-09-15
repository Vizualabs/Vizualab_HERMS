import { expect, test } from '@playwright/test'

test('counts and approves opening stock before it becomes available', async ({ page }) => {
  const noteId = '70000000-0000-4000-8000-000000000099'
  const lineId = '80000000-0000-4000-8000-000000000099'
  const note = {
    id: noteId,
    noteType: 'opening_balance',
    obNumber: 'OB-000099',
    entryType: 'opening_balance',
    storeId: '20000000-0000-4000-8000-000000000001',
    storeName: 'Main Store',
    storeAddress: '2 Store Road',
    status: 'pending_approval',
    submittedBy: '30000000-0000-4000-8000-000000000002',
    submittedByName: 'Business Owner',
    approvedBy: null,
    approvedByName: null,
    submittedAt: '2026-09-15T02:00:00.000Z',
    approvedAt: null,
    createdAt: '2026-09-15T02:00:00.000Z',
    updatedAt: '2026-09-15T02:00:00.000Z',
    lines: [{
      id: lineId,
      equipmentItemId: '50000000-0000-4000-8000-000000000099',
      equipmentName: 'Scaffold frame',
      unitOfMeasure: 'unit',
      requestedQty: 100,
      countedQty: null as number | null,
      countDifference: null as number | null,
    }],
  }
  const requests: Array<{ action: string; body: unknown }> = []

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/me') {
      await route.fulfill({ json: { data: {
        id: '30000000-0000-4000-8000-000000000001',
        storeId: note.storeId,
        name: 'Store Admin',
        role: 'store_admin',
        isDeputyAdmin: false,
        email: 'store@example.test',
      } } })
      return
    }
    if (pathname === `/api/approvals/${noteId}` && request.method() === 'GET') {
      await route.fulfill({ json: { data: note } })
      return
    }
    if (pathname === `/api/approvals/${noteId}/count`) {
      const body = request.postDataJSON() as {
        lines: Array<{ lineId: string; countedQty: number }>
      }
      requests.push({ action: 'count', body })
      note.lines[0]!.countedQty = body.lines[0]!.countedQty
      note.lines[0]!.countDifference = body.lines[0]!.countedQty - note.lines[0]!.requestedQty
      await route.fulfill({ json: { data: note } })
      return
    }
    if (pathname === `/api/approvals/${noteId}/approve`) {
      requests.push({ action: 'approve', body: request.postDataJSON() })
      note.status = 'approved'
      await route.fulfill({ json: { data: note } })
      return
    }
    await route.fulfill({
      status: 404,
      json: { error: { message: `Unexpected ${request.method()} ${pathname}` } },
    })
  })

  await page.goto(`/approvals/${noteId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'OB-000099' })).toBeVisible()
  await expect(page.getByText('Registered opening quantity 100')).toBeVisible()

  const approve = page.getByRole('button', { name: 'Approve and post stock' })
  await expect(approve).toBeDisabled()
  await page.getByLabel('Scaffold frame opening physical count').fill('100')
  await page.getByRole('button', { name: 'Save physical count' }).click()
  await expect(approve).toBeEnabled()

  page.once('dialog', (dialog) => dialog.accept())
  await approve.click()
  await expect(page.getByText('approved', { exact: true })).toBeVisible()
  expect(requests).toEqual([
    { action: 'count', body: { lines: [{ lineId, countedQty: 100 }] } },
    { action: 'approve', body: {} },
  ])
})
