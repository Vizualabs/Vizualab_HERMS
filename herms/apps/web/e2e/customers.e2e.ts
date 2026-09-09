import { expect, test, type Page } from '@playwright/test'

const password = process.env.SEED_USER_PASSWORD

async function signInAsOwner(page: Page) {
  if (!password) throw new Error('SEED_USER_PASSWORD is required for customer pricing E2E tests')
  await page.goto('/login')
  await page.getByLabel('Email').fill('owner@herms.local')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/customers')
  await expect(page.getByRole('heading', { name: 'Customers & Pricing' })).toBeVisible()
}

test.describe('Customers & Pricing register', () => {
  test('shows the customer register, fixed prices, price history, and create dialog', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await signInAsOwner(page)

    await expect(page.getByRole('heading', { name: 'Customer register' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Customer register table' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Fixed price list' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Price history' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Price history table' })).toBeVisible()

    await page.getByRole('button', { name: 'New customer' }).click()
    const dialog = page.getByRole('dialog', { name: 'New customer' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Name')).toBeFocused()
    await expect(dialog.getByLabel('Email')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()

    await page.screenshot({
      path: testInfo.outputPath('customers-pricing-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('keeps customer pricing within a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signInAsOwner(page)

    await expect(page.getByRole('heading', { name: 'Fixed price list' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Price history' })).toBeVisible()
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1,
    )).toBe(true)
  })
})
