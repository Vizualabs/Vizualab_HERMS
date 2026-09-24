import { expect, test, type Page } from '@playwright/test'

const customerId = '30000000-0000-4000-8000-000000000001'
const equipmentItemId = '50000000-0000-4000-8000-000000000001'

test('selects equipment and edits its quotation quantity without crashing', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await mockQuotationApis(page, 10)
  await page.goto('/quotations')
  await page.getByRole('button', { name: 'New quotation' }).click()
  await chooseListedOption(page, 'Customer', 'Cinnamon Grand')
  await chooseListedOption(page, 'Equipment for item 1', 'Dinner Plate')

  const quantity = page.getByLabel('Quantity')
  await quantity.click()
  await quantity.fill('3')

  await expect(quantity).toHaveValue('3')
  await expect(page.getByText('In stock: 10')).toBeVisible()
  await expect(page.getByText('Applied price: LKR 500.00')).toBeVisible()
  await page.getByText('Custom pricing', { exact: true }).click()
  const customPrice = page.getByLabel('Unit price (LKR)')
  await customPrice.fill('475.50')
  await expect(customPrice).toHaveValue('475.50')
  expect(pageErrors).toEqual([])
})

test('blocks a quotation quantity above available stock and shows a notice', async ({ page }) => {
  await mockQuotationApis(page, 2)
  await page.goto('/quotations')
  await page.getByRole('button', { name: 'New quotation' }).click()
  await chooseListedOption(page, 'Customer', 'Cinnamon Grand')
  await chooseListedOption(page, 'Equipment for item 1', 'Dinner Plate')

  const quantity = page.getByLabel('Quantity')
  await quantity.click({ clickCount: 3 })
  await page.keyboard.type('5')

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Not enough stock')
  await expect(dialog).toContainText('Dinner Plate has only 2 in stock')
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(dialog).toBeHidden()
  await expect(quantity).toHaveValue('2')
})

test('shows a Quotations badge after customers accept or reject, then clears it when the list is opened', async ({ page }) => {
  const userId = '20000000-0000-4000-8000-000000000001'
  await page.addInitScript((id) => {
    localStorage.setItem(`herms.quotation-responses-seen:${id}`, '[]')
  }, userId)

  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/me') {
      await route.fulfill({ json: { data: {
        id: userId,
        storeId: '10000000-0000-4000-8000-000000000001',
        name: 'Sales User',
        role: 'sales',
        isDeputyAdmin: false,
        email: 'sales@example.test',
      } } })
      return
    }
    if (pathname === '/api/quotations') {
      await route.fulfill({ json: { data: [
        quotationSummary('accepted'),
        quotationSummary('rejected'),
        quotationSummary('sent'),
      ] } })
      return
    }
    if (pathname === '/api/customers' || pathname === '/api/items' || pathname === '/api/customers/pricing') {
      await route.fulfill({ json: { data: pathname === '/api/customers/pricing' ? { customers: [], fixedPrices: [], priceHistory: [] } : [] } })
      return
    }
    await route.fulfill({ status: 404, json: { error: { message: 'Unexpected test request' } } })
  })

  await page.goto('/items')
  const quotationsLink = page.getByRole('link', { name: 'Quotations, 2 new responses' }).first()
  await expect(quotationsLink).toBeVisible()
  await quotationsLink.click()
  await expect(page.getByRole('heading', { name: 'Quotations' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Quotations, 2 new responses' })).toHaveCount(0)
})

test('filters long equipment lists from the dropdown search', async ({ page }) => {
  await mockQuotationApis(page, 8, [
    item({ id: equipmentItemId, name: 'Dinner Plate', currentStockQty: 8 }),
    item({
      id: '50000000-0000-4000-8000-000000000002',
      name: 'Side Plate',
      currentStockQty: 4,
    }),
  ])
  await page.goto('/quotations')
  await page.getByRole('button', { name: 'New quotation' }).click()
  await chooseListedOption(page, 'Customer', 'Cinnamon Grand')
  await page.getByRole('combobox', { name: 'Equipment for item 1' }).click()
  await page.getByRole('searchbox', { name: 'Search options' }).fill('side')
  await expect(page.getByRole('option', { name: 'Dinner Plate' })).toHaveCount(0)
  await page.getByRole('option', { name: 'Side Plate' }).click()
  await expect(page.getByRole('combobox', { name: 'Equipment for item 1' })).toContainText('Side Plate')
})

async function chooseListedOption(page: Page, comboboxName: string, optionName: string) {
  await page.getByRole('combobox', { name: comboboxName }).click()
  await page.getByRole('option', { name: optionName }).click()
}

function item(input: { id: string; name: string; currentStockQty: number }) {
  return {
    id: input.id,
    name: input.name,
    category: 'Plates',
    unitOfMeasure: 'unit',
    currentUnitPriceCents: 50_000,
    purchasePriceCents: null,
    currentStockQty: input.currentStockQty,
    reorderThreshold: 10,
    createdAt: '2026-09-12T09:00:00.000Z',
    updatedAt: '2026-09-12T09:00:00.000Z',
  }
}

async function mockQuotationApis(
  page: Page,
  currentStockQty: number,
  items = [item({ id: equipmentItemId, name: 'Dinner Plate', currentStockQty })],
) {
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
      await route.fulfill({ json: { data: items } })
      return
    }

    await route.fulfill({ status: 404, json: { error: { message: 'Unexpected test request' } } })
  })
}

function quotationSummary(status: 'accepted' | 'rejected' | 'sent') {
  const suffix = status === 'accepted' ? '1' : status === 'rejected' ? '2' : '3'
  return {
    id: `60000000-0000-4000-8000-00000000000${suffix}`,
    quotationNumber: `QT-2026-00000${suffix}`,
    customerId,
    customerName: 'Cinnamon Grand',
    status,
    pricingMode: 'standard',
    totalValueCents: 50_000,
    createdAt: '2026-09-12T09:00:00.000Z',
    expiresAt: '2026-09-19T09:00:00.000Z',
    updatedAt: '2026-09-12T10:00:00.000Z',
    lineCount: 1,
    orderId: null,
  }
}

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
