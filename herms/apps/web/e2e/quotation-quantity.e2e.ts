import { expect, test } from '@playwright/test'

const customerId = '30000000-0000-4000-8000-000000000001'
const equipmentItemId = '50000000-0000-4000-8000-000000000001'

test('selects equipment and edits its quotation quantity without crashing', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname

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

    if (pathname === '/api/quotations') {
      await route.fulfill({ json: { data: [] } })
      return
    }

    if (pathname === '/api/customers') {
      await route.fulfill({ json: { data: [customer()] } })
      return
    }

    if (pathname === `/api/customers/${customerId}`) {
      await route.fulfill({ json: { data: { ...customer(), prices: [] } } })
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

    await route.fulfill({ status: 404, json: { error: { message: 'Unexpected test request' } } })
  })

  await page.goto('/quotations')
  await page.getByRole('button', { name: 'New quotation' }).click()
  await page.getByRole('combobox').first().selectOption(customerId)
  await page.getByLabel('Equipment for item 1').selectOption(equipmentItemId)

  const quantity = page.getByLabel('Quantity')
  await quantity.click()
  await quantity.fill('3')

  await expect(quantity).toHaveValue('3')
  await expect(page.getByText('Applied price: LKR 500.00')).toBeVisible()
  await page.getByText('Custom pricing', { exact: true }).click()
  const customPrice = page.getByLabel('Unit price (LKR)')
  await customPrice.fill('475.50')
  await expect(customPrice).toHaveValue('475.50')
  expect(pageErrors).toEqual([])
})

function customer() {
  return {
    id: customerId,
    storeId: '10000000-0000-4000-8000-000000000001',
    name: 'Cinnamon Grand',
    type: 'new',
    phone: '+94770000001',
    email: 'cinnamon@example.test',
    address: 'Test address',
    outstandingBalanceCents: 0,
    createdAt: '2026-09-12T08:00:00.000Z',
    updatedAt: '2026-09-12T08:00:00.000Z',
  }
}
