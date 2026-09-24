import { expect, test, type Page } from '@playwright/test'

const password = process.env.SEED_USER_PASSWORD

async function signIn(page: Page, email: string) {
  if (!password) throw new Error('SEED_USER_PASSWORD is required for Phase 8 E2E tests')
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  const reorderDialog = page.getByRole('alertdialog', { name: 'Reorder level reached' })
  await reorderDialog.waitFor({ state: 'visible', timeout: 4000 }).then(async () => {
    await reorderDialog.getByRole('button', { name: 'OK' }).click()
    await expect(reorderDialog).toBeHidden()
  }).catch(() => undefined)
}

test.describe('Phase 8 management dashboard', () => {
  test('Business Owner sees reconciled reporting, filters, and downloads', async ({
    page,
  }, testInfo) => {
    await signIn(page, 'owner@herms.local')
    await expect(page.getByText('Stock value', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pending payments', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Monthly income vs expenses' }))
      .toBeVisible()
    await expect(page.getByRole('heading', { name: 'Received vs pending payments' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Stock quantity & value by item' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Most missing / damaged items' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Customers most associated with loss' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Open missing / damaged records' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'At reorder level' })).toBeVisible()
    const incomeGraph = page.getByRole('group', { name: /Monthly income versus expenses/ })
    await expect(incomeGraph).toBeVisible()
    const financeMonthPoints = incomeGraph.getByRole('button', { name: /Income LKR .*Expenses LKR/ })
    await expect(financeMonthPoints).toHaveCount(6)
    await financeMonthPoints.nth(3).focus()
    await expect(page.getByText(/Income: LKR/)).toBeVisible()
    await expect(page.getByText(/Expenses: LKR/)).toBeVisible()
    const incomeTooltip = incomeGraph.getByRole('tooltip')
    await expect(incomeTooltip).toBeVisible()
    await expect(incomeTooltip).toHaveCSS('animation-name', 'finance-chart-tooltip-in')
    await expect(incomeTooltip).toHaveCSS('animation-duration', '0.18s')
    const paymentGraph = page.getByRole('group', { name: /Received versus pending payments/ })
    await expect(paymentGraph).toBeVisible()
    const paymentMonthPoints = paymentGraph.getByRole('button', { name: /Received LKR .*Pending LKR/ })
    await expect(paymentMonthPoints).toHaveCount(6)
    await paymentMonthPoints.nth(1).focus()
    await expect(page.getByText(/Received: LKR/)).toBeVisible()
    await expect(page.getByText(/Pending: LKR/)).toBeVisible()
    const paymentTooltip = paymentGraph.getByRole('tooltip')
    await expect(paymentTooltip).toBeVisible()
    await expect(paymentTooltip).toHaveCSS('animation-name', 'finance-chart-tooltip-in')

    const stockRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/dashboard/stock')
    const financeRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/finance/monthly')
    await page.getByRole('button', { name: 'Refresh dashboard' }).click()
    expect((await stockRefresh).ok()).toBe(true)
    expect((await financeRefresh).ok()).toBe(true)
    const filterButton = page.getByRole('button', { name: /Report filters/ })
    await expect(filterButton).toHaveAttribute('aria-expanded', 'false')
    await filterButton.click()
    await expect(filterButton).toHaveAttribute('aria-expanded', 'true')
    const customer = page.getByRole('combobox', { name: 'Customer' })
    await customer.click()
    await page.getByRole('option').nth(1).click()
    await expect(page).toHaveURL(/customerId=/)
    await expect(filterButton).toContainText('1')
    await page.getByRole('button', { name: 'Clear all filters' }).click()
    await expect(page).not.toHaveURL(/customerId=/)

    const pdfDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download PDF/ }).click()
    expect((await pdfDownload).suggestedFilename()).toMatch(/^herms-management-\d{4}-\d{2}\.pdf$/)

    const excelDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download Excel/ }).click()
    expect((await excelDownload).suggestedFilename()).toMatch(/^herms-management-\d{4}-\d{2}\.xlsx$/)

    await financeMonthPoints.nth(3).focus()
    await page.screenshot({
      path: testInfo.outputPath('owner-dashboard.png'),
      fullPage: true,
    })
  })

  test('Finance sees responsive reporting on mobile, tablet, and desktop', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, 'finance@herms.local')
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Download PDF/ })).toBeVisible()
    await expect(page.getByText('Stock value', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Report filters/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Monthly income vs expenses' })).toBeVisible()
    const incomeGraph = page.getByRole('group', { name: /Monthly income versus expenses/ })
    const paymentGraph = page.getByRole('group', { name: /Received versus pending payments/ })
    await expect(incomeGraph).toBeVisible()
    await expect(paymentGraph).toBeVisible()
    await incomeGraph.getByRole('button', { name: /Income LKR .*Expenses LKR/ }).last().click()
    await expect(incomeGraph.getByRole('tooltip')).toBeVisible()
    await paymentGraph.getByRole('button', { name: /Received LKR .*Pending LKR/ }).last().click()
    await expect(paymentGraph.getByRole('tooltip')).toBeVisible()

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await expect.poll(() => page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth + 1,
      )).toBe(true)
    }
  })

  test('rolls live graph months forward at Colombo midnight', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-30T18:29:30.000Z') })
    await signIn(page, 'owner@herms.local')

    await expect(page.getByText(/September 2026.*management overview/)).toBeVisible()
    const octoberPayments = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/dashboard/payments'
        && url.searchParams.get('month') === '2026-10'
    })
    const automaticStockRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/dashboard/stock')

    await page.clock.fastForward(60_000)

    expect((await octoberPayments).ok()).toBe(true)
    expect((await automaticStockRefresh).ok()).toBe(true)
    await expect(page.getByText(/October 2026.*management overview/)).toBeVisible()
    await expect(page.getByRole('button', { name: /October 2026: Income LKR .*Expenses LKR/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /October 2026: Received LKR .*Pending LKR/ })).toBeVisible()
  })
})
