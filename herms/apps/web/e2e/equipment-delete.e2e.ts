import { expect, test } from '@playwright/test'

test('replaces Edit details with icons and deletes unused equipment after confirm', async ({ page }) => {
  let deletedId: string | undefined

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/me') {
      await route.fulfill({ json: { data: {
        id: '20000000-0000-4000-8000-000000000001',
        storeId: '10000000-0000-4000-8000-000000000001',
        name: 'Sales User',
        role: 'sales',
        isDeputyAdmin: false,
        email: 'sales@example.test',
      } } })
      return
    }
    if (pathname === '/api/items' && request.method() === 'GET') {
      await route.fulfill({ json: { data: deletedId ? [] : [{
        id: '50000000-0000-4000-8000-000000000001',
        name: 'Spare Bowl',
        category: 'Crockery',
        unitOfMeasure: 'unit',
        currentUnitPriceCents: 2500,
        purchasePriceCents: 1500,
        reorderThreshold: 4,
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
      }] } })
      return
    }
    if (pathname === '/api/items/50000000-0000-4000-8000-000000000001' && request.method() === 'DELETE') {
      deletedId = '50000000-0000-4000-8000-000000000001'
      await route.fulfill({ json: { data: { id: deletedId, deleted: true } } })
      return
    }
    if (pathname === '/api/price-escalation') {
      await route.fulfill({ json: { data: [] } })
      return
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${pathname}` } } })
  })

  await page.goto('/items')
  await expect(page.getByText('Edit details')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Edit Spare Bowl' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete Spare Bowl' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Delete Spare Bowl?')
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Spare Bowl')).toHaveCount(0)
})

test('shows a popup when equipment is still used on quotations or orders', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/me') {
      await route.fulfill({ json: { data: {
        id: '20000000-0000-4000-8000-000000000001',
        storeId: '10000000-0000-4000-8000-000000000001',
        name: 'Sales User',
        role: 'sales',
        isDeputyAdmin: false,
        email: 'sales@example.test',
      } } })
      return
    }
    if (pathname === '/api/items' && request.method() === 'GET') {
      await route.fulfill({ json: { data: [{
        id: '50000000-0000-4000-8000-000000000002',
        name: 'Dinner Plate',
        category: 'Crockery',
        unitOfMeasure: 'unit',
        currentUnitPriceCents: 4500,
        purchasePriceCents: 2000,
        reorderThreshold: 10,
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
      }] } })
      return
    }
    if (pathname === '/api/items/50000000-0000-4000-8000-000000000002' && request.method() === 'DELETE') {
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'CONFLICT',
            message: 'Dinner Plate is used on 10 quotations, 7 orders, so it cannot be deleted.',
          },
        },
      })
      return
    }
    if (pathname === '/api/price-escalation') {
      await route.fulfill({ json: { data: [] } })
      return
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${pathname}` } } })
  })

  await page.goto('/items')
  await page.getByRole('button', { name: 'Delete Dinner Plate' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Cannot delete Dinner Plate')
  await expect(dialog).toContainText('used on 10 quotations, 7 orders')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Dinner Plate')).toBeVisible()
})
