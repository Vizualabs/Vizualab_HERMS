import { expect, test } from '@playwright/test'

const customerId = '30000000-0000-4000-8000-000000000001'
const equipmentItemId = '50000000-0000-4000-8000-000000000001'

test('edits and permanently removes a recurring customer price without crashing', async ({ page }) => {
  const pageErrors: string[] = []
  let savedPrices: Array<{ equipmentItemId: string; unitPriceCents: number }> = [{
    equipmentItemId,
    unitPriceCents: 50_000,
  }]
  let updatedAt = '2026-09-12T10:00:00.000Z'

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

    if (pathname === '/api/items') {
      await route.fulfill({ json: { data: [{
        id: equipmentItemId,
        name: 'Dinner Plate',
        category: 'Plates',
        unitOfMeasure: 'unit',
        currentUnitPriceCents: 50_000,
        reorderThreshold: 10,
        createdAt: '2026-09-12T09:00:00.000Z',
        updatedAt: '2026-09-12T09:00:00.000Z',
      }] } })
      return
    }

    if (pathname === `/api/customers/${customerId}/prices` && request.method() === 'PUT') {
      const body = request.postDataJSON() as {
        prices: Array<{ equipmentItemId: string; unitPriceCents: number }>
      }
      savedPrices = body.prices
      updatedAt = '2026-09-12T10:01:00.000Z'
      await route.fulfill({ json: { data: customer(savedPrices, updatedAt) } })
      return
    }

    if (pathname === `/api/customers/${customerId}`) {
      await route.fulfill({ json: { data: customer(savedPrices, updatedAt) } })
      return
    }

    await route.fulfill({ status: 404, json: { error: { message: 'Unexpected test request' } } })
  })

  await page.goto(`/customers/${customerId}`)
  const priceInput = page.getByLabel('Dinner Plate special price in LKR')
  await expect(priceInput).toHaveValue('500.00')
  await priceInput.click()
  await priceInput.fill('450.75')
  await expect(priceInput).toHaveValue('450.75')
  await expect(page.getByRole('heading', { name: 'Customer special prices' })).toBeVisible()

  const saveRequest = page.waitForRequest((request) =>
    request.method() === 'PUT'
      && new URL(request.url()).pathname === `/api/customers/${customerId}/prices`)
  await page.getByRole('button', { name: 'Remove Dinner Plate special price' }).click()
  expect((await saveRequest).postDataJSON()).toEqual({ prices: [] })
  await expect(page.getByText('No exceptions selected.')).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('Dinner Plate special price in LKR')).toHaveCount(0)
  expect(savedPrices).toEqual([])

  await page.getByLabel('Equipment for special price').selectOption(equipmentItemId)
  await expect(page.getByLabel('Dinner Plate special price in LKR')).toHaveValue('500.00')

  const addRequest = page.waitForRequest((request) =>
    request.method() === 'PUT'
      && new URL(request.url()).pathname === `/api/customers/${customerId}/prices`)
  await page.getByRole('button', { name: 'Save special prices' }).click()
  expect((await addRequest).postDataJSON()).toEqual({
    prices: [{ equipmentItemId, unitPriceCents: 50_000 }],
  })
  expect(pageErrors).toEqual([])
})

function customer(
  prices: Array<{ equipmentItemId: string; unitPriceCents: number }>,
  updatedAt: string,
) {
  return {
    id: customerId,
    storeId: '10000000-0000-4000-8000-000000000001',
    name: 'Ocean Pearl Hotels',
    type: 'recurring',
    phone: '+94770000001',
    email: 'ocean@example.test',
    address: 'Test address',
    outstandingBalanceCents: 0,
    createdAt: '2026-09-12T08:00:00.000Z',
    updatedAt,
    prices: prices.map((price, index) => ({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      customerId,
      equipmentItemId: price.equipmentItemId,
      unitPriceCents: price.unitPriceCents,
      effectiveFrom: updatedAt,
      effectiveTo: null,
    })),
  }
}
