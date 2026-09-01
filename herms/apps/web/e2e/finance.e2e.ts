import { expect, test, type Page } from '@playwright/test'

const password = process.env.SEED_USER_PASSWORD

async function signInAsFinance(page: Page) {
  if (!password) throw new Error('SEED_USER_PASSWORD is required for finance E2E tests')
  await page.goto('/login')
  await page.getByLabel('Email').fill('finance@herms.local')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/finance')
  await expect(page.getByRole('heading', { name: 'Payments & Finance' })).toBeVisible()
}

test.describe('Payments & Finance report', () => {
  test('renders the report, preserves finance tools, and exports CSV', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await signInAsFinance(page)

    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await expect(page.getByText('Received this month')).toBeVisible()
    await expect(page.getByText('Expenses this month')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Income vs expenses — last 6 months' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Payments received' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Outstanding balances' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Record payments & expenses' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Order invoice & balance' })).toBeVisible()

    await page.getByRole('combobox', { name: 'Order' }).selectOption({ index: 1 })
    await expect(page.getByText('Ready for payment')).toBeVisible()
    await expect(page.getByText('Order selected')).toBeVisible()

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export report' }).click()
    expect((await download).suggestedFilename()).toMatch(/^herms-finance-\d{4}-\d{2}\.csv$/)

    await page.screenshot({
      path: testInfo.outputPath('finance-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
    expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toHaveLength(0)
    expect(pageErrors, `Page errors:\n${pageErrors.join('\n')}`).toHaveLength(0)
  })

  test('keeps the finance report within a mobile viewport', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signInAsFinance(page)

    await expect(page.getByRole('heading', { name: 'Payments & Finance' })).toBeVisible()
    await expect(page.getByText('Received this month')).toBeVisible()
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1,
    )).toBe(true)

    await page.screenshot({
      path: testInfo.outputPath('finance-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    })
  })
})
