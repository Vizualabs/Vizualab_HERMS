import { expect, test } from '@playwright/test'

test('registers equipment with an opening quantity for approval', async ({ page }) => {
  const pageErrors: string[] = []
  let submittedBody: Record<string, unknown> | undefined
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/me') {
      await route.fulfill({ json: { data: {
        id: '20000000-0000-4000-8000-000000000001',
        storeId: null,
        name: 'Business Owner',
        role: 'business_owner',
        isDeputyAdmin: false,
        email: 'owner@example.test',
      } } })
      return
    }
    if (pathname === '/api/items' && request.method() === 'POST') {
      submittedBody = request.postDataJSON() as Record<string, unknown>
      await route.fulfill({ status: 201, json: { data: {
        id: '50000000-0000-4000-8000-000000000001',
        ...submittedBody,
        openingBalanceStatus: 'pending_approval',
        openingBalanceNoteId: '60000000-0000-4000-8000-000000000001',
        openingBalanceNoteNumber: 'OB-000001',
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
      } } })
      return
    }
    if (pathname === '/api/items' || pathname === '/api/price-escalation') {
      await route.fulfill({ json: { data: [] } })
      return
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${pathname}` } } })
  })

  await page.goto('/items')
  await page.getByLabel('Name').fill('Scaffold frame')
  await page.getByLabel('Category').fill('Scaffolding')
  await page.getByLabel('Opening price (LKR)').fill('500.00')
  await page.getByLabel('Reorder threshold (optional)').fill('10')
  await page.getByLabel('Opening quantity').fill('75')
  await page.getByRole('button', { name: 'Create equipment' }).click()

  await expect(page.getByRole('status')).toContainText(
    'OB-000001 now awaits opening-stock approval',
  )
  expect(submittedBody).toEqual({
    name: 'Scaffold frame',
    category: 'Scaffolding',
    unitOfMeasure: 'unit',
    currentUnitPriceCents: 50_000,
    reorderThreshold: 10,
    openingQuantity: 75,
  })
  expect(pageErrors).toEqual([])
})
