import { expect, test } from '@playwright/test'

test('shows submitted delivery and retention discrepancies through their lifecycle', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/me') {
      await route.fulfill({ json: { data: {
        id: '10000000-0000-4000-8000-000000000001',
        storeId: null,
        name: 'Business Owner',
        role: 'business_owner',
        isDeputyAdmin: false,
        email: 'owner@example.test',
      } } })
      return
    }
    if (pathname === '/api/claims') {
      await route.fulfill({ json: { data: [] } })
      return
    }
    if (pathname === '/api/discrepancies') {
      await route.fulfill({ json: { data: [
        discrepancy({
          id: '20000000-0000-4000-8000-000000000001',
          sourceType: 'delivery_note',
          sourceNoteNumber: 'DN-2026-000010',
          sourceNoteStatus: 'pending_approval',
          discrepancyType: 'not_accepted',
          responsibleParty: null,
          status: 'open',
        }),
        discrepancy({
          id: '20000000-0000-4000-8000-000000000002',
          sourceType: 'retention_note',
          sourceNoteNumber: 'RN-2026-000011',
          sourceNoteStatus: 'approved',
          discrepancyType: 'damaged',
          responsibleParty: 'staff_member',
          status: 'written_off',
        }),
      ] } })
      return
    }
    if (pathname === '/api/dashboard/rankings') {
      await route.fulfill({ json: { data: {
        currency: 'LKR',
        limit: 10,
        items: [],
        customers: [],
      } } })
      return
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${pathname}` } } })
  })

  await page.goto('/claims')
  await expect(page.getByRole('heading', { name: 'Discrepancy & Damage Registry' })).toBeVisible()
  await expect(page.getByText('DN-2026-000010')).toBeVisible()
  await expect(page.getByText('delivery note · pending approval')).toBeVisible()
  await expect(page.getByText('Not accepted')).toBeVisible()
  await expect(page.getByText('RN-2026-000011')).toBeVisible()
  await expect(page.getByText('retention note · approved')).toBeVisible()
  await expect(page.getByText('Staff member')).toBeVisible()
  await expect(page.getByText('2 records')).toBeVisible()
  expect(pageErrors).toEqual([])
})

function discrepancy(overrides: Record<string, unknown>) {
  return {
    id: '20000000-0000-4000-8000-000000000000',
    sourceType: 'delivery_note',
    sourceNoteId: '30000000-0000-4000-8000-000000000001',
    sourceNoteNumber: 'DN-2026-000001',
    sourceNoteStatus: 'pending_approval',
    orderId: '40000000-0000-4000-8000-000000000001',
    orderNumber: 'ORD-2026-000001',
    customerId: '50000000-0000-4000-8000-000000000001',
    customerName: 'Example Hotel',
    equipmentItemId: '60000000-0000-4000-8000-000000000001',
    equipmentName: 'Scaffold frame',
    quantity: 1,
    discrepancyType: 'damaged',
    reason: 'Recorded in the field note',
    responsibleParty: 'customer',
    status: 'open',
    recordedAt: '2026-09-15T05:00:00.000Z',
    resolvedAt: null,
    unitPriceCents: 50_000,
    valueCents: 50_000,
    ...overrides,
  }
}
