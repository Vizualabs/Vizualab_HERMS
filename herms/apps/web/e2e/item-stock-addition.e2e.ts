import { expect, test } from '@playwright/test'

for (const role of ['system_admin', 'super_user'] as const) {
  const roleLabel = role === 'super_user' ? 'Super User' : 'System Admin'
  test(`${roleLabel} adds 150 units and the equipment total reaches 225 immediately`, async ({ page }) => {
  const itemId = '50000000-0000-4000-8000-000000000075'
  let stockAdded = false
  let submittedBody: unknown
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/me') {
      await route.fulfill({ json: { data: {
        id: '20000000-0000-4000-8000-000000000006',
        storeId: null,
        name: roleLabel,
        role,
        isDeputyAdmin: false,
        email: 'system@example.test',
      } } })
      return
    }
    if (pathname === `/api/items/${itemId}` && request.method() === 'GET') {
      await route.fulfill({ json: { data: {
        id: itemId,
        name: 'Dinner spoon',
        category: 'Cutlery',
        unitOfMeasure: 'unit',
        currentUnitPriceCents: 16_500,
        reorderThreshold: 20,
        currentStockQty: stockAdded ? 225 : 75,
        openingStockQty: 75,
        totalReceivedQty: stockAdded ? 225 : 75,
        pendingReceiptQty: 0,
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
      } } })
      return
    }
    if (pathname === `/api/items/${itemId}/stock-additions` && request.method() === 'POST') {
      submittedBody = request.postDataJSON()
      stockAdded = true
      await route.fulfill({ status: 201, json: { data: {
        equipmentItemId: itemId,
        equipmentName: 'Dinner spoon',
        quantity: 150,
        status: 'approved',
        noteId: '70000000-0000-4000-8000-000000000150',
        noteNumber: 'OB-000150',
        entryType: 'stock_addition',
      } } })
      return
    }
    await route.fulfill({
      status: 404,
      json: { error: { message: `Unexpected ${request.method()} ${pathname}` } },
    })
  })

  await page.goto(`/items/${itemId}`)
  await expect(page.getByText('Available now').locator('..')).toContainText('75')
  await expect(page.getByText('Total stock received').locator('..')).toContainText('75')

  await page.getByLabel('New units received').fill('150')
  await page.getByRole('button', { name: 'Add stock' }).click()

  expect(submittedBody).toEqual({ quantity: 150 })
  await expect(page.getByRole('status')).toContainText(
    'Added 150 units successfully. Available stock is now updated.',
  )
  await expect(page.getByText('Available now').locator('..')).toContainText('225')
  await expect(page.getByText('Opening stock').locator('..')).toContainText('75')
  await expect(page.getByText('Total stock received').locator('..')).toContainText('225')
  await expect(page.getByText('Awaiting approval').locator('..')).toContainText('0')
  expect(pageErrors).toEqual([])
  })
}
