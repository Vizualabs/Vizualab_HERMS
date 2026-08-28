import { expect, test, type Page } from '@playwright/test'

const password = process.env.SEED_USER_PASSWORD

async function signIn(page: Page, email: string) {
  if (!password) throw new Error('SEED_USER_PASSWORD is required for Phase 8 E2E tests')
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible()
}

test.describe('Phase 8 management dashboard', () => {
  test('Business Owner sees reconciled reporting, filters, escalation history, and downloads', async ({
    page,
  }, testInfo) => {
    await signIn(page, 'owner@herms.local')
    await expect(page.getByText('Current stock value')).toBeVisible()
    await expect(page.getByText('Pending payments')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Open missing and damaged equipment' }))
      .toBeVisible()
    await expect(page.getByRole('heading', { name: 'Most affected equipment' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Price escalation history' })).toBeVisible()

    const customer = page.getByLabel('Customer')
    await customer.selectOption({ index: 1 })
    await expect(page).toHaveURL(/customerId=/)
    await customer.selectOption('')

    const pdfDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download PDF/ }).click()
    expect((await pdfDownload).suggestedFilename()).toMatch(/^herms-management-\d{4}-\d{2}\.pdf$/)

    const excelDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download Excel/ }).click()
    expect((await excelDownload).suggestedFilename()).toMatch(/^herms-management-\d{4}-\d{2}\.xlsx$/)

    await page.screenshot({
      path: testInfo.outputPath('owner-dashboard.png'),
      fullPage: true,
    })
  })

  test('Finance sees reporting without owner escalation information on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, 'finance@herms.local')
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Download PDF/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Price escalation history' })).toHaveCount(0)
    await expect(page.getByText('Current stock value')).toBeVisible()
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1,
    )).toBe(true)
  })
})
