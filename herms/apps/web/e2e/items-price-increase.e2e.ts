import { expect, test } from '@playwright/test'

test('lets the owner preview a chosen percent and cancel before applying', async ({ page }) => {
  const pageErrors: string[] = []
  let postedBody: Record<string, unknown> | undefined
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
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
    if (pathname === '/api/items' && request.method() === 'GET') {
      await route.fulfill({ json: { data: [{
        id: '50000000-0000-4000-8000-000000000001',
        name: 'Dinner Plate',
        category: 'Crockery',
        unitOfMeasure: 'unit',
        currentUnitPriceCents: 8000,
        reorderThreshold: null,
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
      }] } })
      return
    }
    if (pathname === '/api/price-escalation' && request.method() === 'GET') {
      const percent = Number(url.searchParams.get('percent'))
      const oldPriceCents = 8000
      const newPriceCents = Math.round((oldPriceCents * (10_000 + Math.round(percent * 100)) + 5_000) / 10_000)
      await route.fulfill({ json: { data: [{
        itemId: '50000000-0000-4000-8000-000000000001',
        itemName: 'Dinner Plate',
        oldPriceCents,
        newPriceCents,
      }] } })
      return
    }
    if (pathname === '/api/price-escalation' && request.method() === 'POST') {
      postedBody = request.postDataJSON() as Record<string, unknown>
      await route.fulfill({ json: { data: {
        effectiveDate: '2026-09-22T00:00:00.000Z',
        replayed: false,
        items: [],
      } } })
      return
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${pathname}` } } })
  })

  await page.goto('/items')
  await page.getByLabel('Increase by (%)').fill('15')
  await expect(page.getByText('1 equipment price will increase by 15%.')).toBeVisible()
  await expect(page.getByText('LKR 80.00 → 92.00')).toBeVisible()

  await page.getByRole('button', { name: 'Increase prices by 15%' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Increase all prices by 15%?')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  expect(postedBody).toBeUndefined()
  expect(pageErrors).toEqual([])
})
