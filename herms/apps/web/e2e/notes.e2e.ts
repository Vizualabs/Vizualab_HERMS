import { expect, test } from '@playwright/test'

const retentionLine = {
  id: '91000000-0000-4000-8000-000000000001',
  equipmentItemId: '50000000-0000-4000-8000-000000000001',
  equipmentName: 'Scaffold frame',
  unitOfMeasure: 'unit',
  deliveredQty: 100,
  availableQty: 100,
  returnedQty: 0,
  balanceQty: 0,
  missingDamagedQty: 0,
  countedReturnedQty: null,
  mismatchReason: null,
  responsibleParty: null,
  reasonDetail: null,
  countDifference: null,
  discrepancyId: null,
  discrepancyStatus: null,
  writeOffLedgerId: null,
  writeOffCreatedAt: null,
  writeOffReversed: false,
}

const retentionNote = {
  id: '90000000-0000-4000-8000-000000000001',
  rnNumber: 'RN-2026-000001',
  noteType: 'retention_note' as const,
  orderId: '60000000-0000-4000-8000-000000000001',
  orderNumber: 'ORD-2026-000001',
  customerId: '10000000-0000-4000-8000-000000000001',
  customerName: 'Example Hotel',
  customerAddress: '1 Example Road',
  deliveryNoteId: null,
  deliveryNoteNumber: null,
  storeId: '20000000-0000-4000-8000-000000000001',
  storeName: 'Main Store',
  storeAddress: '2 Store Road',
  status: 'draft' as const,
  submittedBy: null,
  submittedByName: null,
  approvedBy: null,
  approvedByName: null,
  submittedAt: null,
  approvedAt: null,
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
  tokenExpiresAt: '2026-09-12T00:00:00.000Z',
  lines: [retentionLine],
}

const deliveryLine = {
  id: '81000000-0000-4000-8000-000000000001',
  equipmentItemId: retentionLine.equipmentItemId,
  equipmentName: retentionLine.equipmentName,
  unitOfMeasure: 'unit',
  issuedQty: 10,
  handedOverQty: 10,
  countedQty: null,
  mismatchReason: null,
  mismatchDetail: null,
  countDifference: null,
}

const deliveryNote = {
  ...retentionNote,
  id: '80000000-0000-4000-8000-000000000001',
  dnNumber: 'DN-2026-000001',
  noteType: 'delivery_note' as const,
  lines: [deliveryLine],
}

test.describe('public field-note workflow', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('submits a partial Retention Note and stays on the confirmation screen', async ({ page }) => {
    let submittedBody: unknown
    await page.route(/\/api\/notes\/token\/partial-retention-token(?:\/submit)?$/, async (route) => {
      if (route.request().method() === 'POST') {
        submittedBody = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          json: { data: { ...retentionNote, status: 'pending_approval' } },
        })
        return
      }
      await route.fulfill({ status: 200, json: { data: retentionNote } })
    })

    await page.goto('/notes/partial-retention-token')
    await expect(page.getByRole('heading', { name: /RN-2026-000001/ })).toBeVisible()

    await page.getByLabel('Returned').fill('60')
    await expect(page.getByText('40 will remain available for a later note.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit note' })).toBeEnabled()
    await page.getByRole('button', { name: 'Submit note' }).click()

    await expect(page.getByRole('heading', { name: 'Note submitted' })).toBeVisible()
    await expect(page.getByText('You can safely close this page.')).toBeVisible()
    await expect(page).toHaveURL(/\/notes\/partial-retention-token$/)
    await expect(page.getByRole('link', { name: 'View approval queue' })).toHaveCount(0)
    expect(submittedBody).toEqual({
      lines: [{
        lineId: retentionLine.id,
        returnedQty: 60,
        balanceQty: 0,
        missingDamagedQty: 0,
        mismatchReason: null,
        responsibleParty: null,
        reasonDetail: null,
      }],
    })
  })

  test('blocks a Retention Note that exceeds the remaining quantity', async ({ page }) => {
    await page.route('**/api/notes/token/limited-retention-token', (route) => route.fulfill({
      status: 200,
      json: {
        data: {
          ...retentionNote,
          lines: [{ ...retentionLine, deliveredQty: 100, availableQty: 40 }],
        },
      },
    }))

    await page.goto('/notes/limited-retention-token')
    await page.getByLabel('Returned').fill('30')
    await page.getByLabel('Balance accounted').fill('20')

    await expect(page.getByRole('alert')).toContainText('only 40 remains')
    await expect(page.getByRole('button', { name: 'Submit note' })).toBeDisabled()
  })

  test('edits delivery and retention discrepancy fields without crashing', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.route('**/api/notes/token/delivery-fields-token', (route) => route.fulfill({
      status: 200,
      json: { data: deliveryNote },
    }))
    await page.route('**/api/notes/token/retention-fields-token', (route) => route.fulfill({
      status: 200,
      json: { data: retentionNote },
    }))

    await page.goto('/notes/delivery-fields-token')
    await page.getByLabel('Quantity handed over').fill('8')
    await page.getByLabel('Reason for difference').selectOption('damaged')
    await expect(page.getByLabel('Reason for difference')).toHaveValue('damaged')
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    await page.goto('/notes/retention-fields-token')
    await page.getByLabel('Returned').fill('8')
    await page.getByLabel('Balance accounted').fill('1')
    await page.getByLabel('Missing / damaged').fill('1')
    await page.getByLabel('Shortfall type').selectOption('damaged')
    await page.getByLabel('Responsible party').selectOption('customer')
    await expect(page.getByLabel('Shortfall type')).toHaveValue('damaged')
    await expect(page.getByLabel('Responsible party')).toHaveValue('customer')
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    expect(pageErrors, `Page errors:\n${pageErrors.join('\n')}`).toEqual([])
    expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toEqual([])
  })
})

test('order note forms use computed remaining quantities and hide ineligible items', async ({ page }) => {
  const orderId = '60000000-0000-4000-8000-000000000001'
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/me') {
      await route.fulfill({
        status: 200,
        json: { data: {
          id: '30000000-0000-4000-8000-000000000001',
          storeId: '20000000-0000-4000-8000-000000000001',
          name: 'Sales User',
          role: 'sales',
          isDeputyAdmin: false,
          email: 'sales@example.test',
        } },
      })
      return
    }
    if (url.pathname === `/api/orders/${orderId}`) {
      await route.fulfill({
        status: 200,
        json: { data: {
          id: orderId,
          orderNumber: 'ORD-2026-000001',
          quotationId: null,
          customerId: '10000000-0000-4000-8000-000000000001',
          customerName: 'Example Hotel',
          status: 'open',
          totalValueCents: 100000,
          createdAt: '2026-09-11T00:00:00.000Z',
          updatedAt: '2026-09-11T00:00:00.000Z',
          currency: 'LKR',
          timezone: 'Asia/Colombo',
          lines: [
            {
              id: '40000000-0000-4000-8000-000000000001',
              equipmentItemId: '50000000-0000-4000-8000-000000000001',
              equipmentName: 'Scaffold frame',
              unitOfMeasure: 'unit',
              quantity: 100,
              unitPriceCents: 1000,
              lineTotalCents: 100000,
              allocatedDeliveryQty: 40,
              approvedDeliveredQty: 60,
              accountedRetentionQty: 20,
              availableStockQty: 35,
            },
            {
              id: '40000000-0000-4000-8000-000000000002',
              equipmentItemId: '50000000-0000-4000-8000-000000000002',
              equipmentName: 'Undelivered jack',
              unitOfMeasure: 'unit',
              quantity: 50,
              unitPriceCents: 0,
              lineTotalCents: 0,
              allocatedDeliveryQty: 50,
              approvedDeliveredQty: 0,
              accountedRetentionQty: 0,
              availableStockQty: 0,
            },
          ],
        } },
      })
      return
    }
    if (url.pathname.endsWith('/delivery-notes') || url.pathname.endsWith('/retention-notes')) {
      await route.fulfill({ status: 200, json: { data: [] } })
      return
    }
    if (url.pathname === '/api/notification-recipients/field-staff') {
      await route.fulfill({
        status: 200,
        json: { data: [{
          id: '70000000-0000-4000-8000-000000000001',
          name: 'Field User',
          phoneMasked: '******1234',
        }] },
      })
      return
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unhandled test route ${url.pathname}` } } })
  })

  await page.goto(`/orders/${orderId}`)
  const deliverySection = page.getByRole('heading', { name: 'Create delivery note' }).locator('..')
  const retentionSection = page.getByRole('heading', { name: 'Create retention note' }).locator('..')

  await expect(deliverySection.getByRole('spinbutton')).toHaveValue('35')
  await expect(deliverySection.getByText('stock 35 · deliverable 35')).toBeVisible()
  await expect(deliverySection.getByText('Undelivered jack')).toHaveCount(0)
  await expect(retentionSection.getByRole('checkbox')).toHaveCount(1)
  await expect(retentionSection.getByText('available 40')).toBeVisible()
  await expect(retentionSection.getByText('Undelivered jack')).toHaveCount(0)
})
