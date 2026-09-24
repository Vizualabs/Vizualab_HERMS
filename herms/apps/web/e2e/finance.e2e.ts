import { expect, test, type Page } from '@playwright/test'

const password = process.env.SEED_USER_PASSWORD
const reportOrderId = '60000000-0000-4000-8000-000000000099'
const reportCustomerId = '10000000-0000-4000-8000-000000000099'

async function routeStableFinanceReport(page: Page) {
  await page.route('**/api/orders', (route) => route.fulfill({
    status: 200,
    json: {
      data: [{
        id: reportOrderId,
        orderNumber: 'ORD-REPORT-001',
        quotationId: null,
        customerId: reportCustomerId,
        customerName: 'Report Customer',
        status: 'open',
        totalValueCents: 100_000,
        createdAt: '2026-09-01T00:00:00.000Z',
      }],
    },
  }))
  await page.route(`**/api/orders/${reportOrderId}/invoice`, (route) => route.fulfill({
    status: 200,
    json: {
      data: {
        id: reportOrderId,
        orderNumber: 'ORD-REPORT-001',
        quotationId: null,
        customerId: reportCustomerId,
        customerName: 'Report Customer',
        status: 'open',
        createdAt: '2026-09-01T00:00:00.000Z',
        orderValueCents: 100_000,
        claimAmountCents: 0,
        invoiceValueCents: 100_000,
        paidAmountCents: 25_000,
        outstandingBalanceCents: 75_000,
        currency: 'LKR',
        lines: [],
      },
    },
  }))
  await page.route(`**/api/customers/${reportCustomerId}/balance`, (route) => route.fulfill({
    status: 200,
    json: {
      data: {
        id: reportCustomerId,
        name: 'Report Customer',
        outstandingBalanceCents: 75_000,
        currency: 'LKR',
        orders: [],
      },
    },
  }))
  await page.route('**/api/finance/monthly?*', (route) => {
    const month = new URL(route.request().url()).searchParams.get('month') ?? '2026-09'
    return route.fulfill({
      status: 200,
      json: {
        data: {
          month,
          incomeCents: 25_000,
          expenseCents: 5_000,
          outstandingCents: 525_000,
          netPositionCents: 20_000,
          currency: 'LKR',
          timezone: 'Asia/Colombo',
          history: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map(
            (historyMonth, index) => ({
              month: historyMonth,
              incomeCents: (index + 1) * 10_000,
              expenseCents: (index + 1) * 2_000,
            }),
          ),
          recentPayments: [{
            id: 'payment-report-1',
            paymentDate: '2026-09-10T00:00:00.000Z',
            customerName: 'Report Customer',
            orderNumber: 'ORD-REPORT-001',
            method: 'bank_transfer',
            amountCents: 25_000,
          }],
          recentExpenses: [{
            id: 'expense-report-1',
            expenseDate: '2026-09-10T00:00:00.000Z',
            category: 'Transport',
            description: 'Delivery fuel',
            amountCents: 5_000,
          }],
          outstandingBalances: Array.from({ length: 7 }, (_, index) => ({
            id: `customer-report-${index + 1}`,
            customerName: `Outstanding Customer ${index + 1}`,
            openOrders: 1,
            invoicedCents: 100_000,
            paidCents: 25_000,
            outstandingCents: 75_000,
          })),
        },
      },
    })
  })
}

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
    await routeStableFinanceReport(page)
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
    const graphPoints = page.getByRole('button', { name: /Income LKR .*Expenses LKR/ })
    await expect(graphPoints).toHaveCount(6)
    const restingBackground = await graphPoints.first().evaluate((element) =>
      getComputedStyle(element).backgroundColor)
    await graphPoints.first().hover()
    await expect.poll(() => graphPoints.first().evaluate((element) =>
      getComputedStyle(element).backgroundColor)).not.toBe(restingBackground)
    const graphTooltip = page.getByRole('tooltip')
    await expect(graphTooltip).toContainText(/Income: LKR/)
    await expect(graphTooltip).toContainText(/Expenses: LKR/)
    await expect(graphTooltip).toHaveCSS('animation-name', 'finance-chart-tooltip-in')
    await expect(graphTooltip).toHaveCSS('animation-duration', '0.18s')
    await graphTooltip.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    const firstPointBox = await graphPoints.first().boundingBox()
    const firstTooltipBox = await graphTooltip.boundingBox()
    if (!firstPointBox || !firstTooltipBox) throw new Error('First graph tooltip was not measurable')
    expect(Math.abs(firstTooltipBox.x - firstPointBox.x)).toBeLessThan(2)

    await graphPoints.last().hover()
    await graphTooltip.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    const lastPointBox = await graphPoints.last().boundingBox()
    const lastTooltipBox = await graphTooltip.boundingBox()
    if (!lastPointBox || !lastTooltipBox) throw new Error('Last graph tooltip was not measurable')
    expect(Math.abs(
      (lastTooltipBox.x + lastTooltipBox.width) - (lastPointBox.x + lastPointBox.width),
    )).toBeLessThan(2)
    await expect(page.getByRole('heading', { name: 'Payments received' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Outstanding balances' })).toBeVisible()
    const outstandingTable = page.getByRole('region', { name: 'Outstanding balances table' })
    await expect(outstandingTable).toBeVisible()
    const outstandingScroll = await outstandingTable.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(outstandingScroll.clientHeight).toBeLessThanOrEqual(340)
    expect(outstandingScroll.scrollHeight).toBeGreaterThan(outstandingScroll.clientHeight)
    await expect(page.getByRole('heading', { name: 'Record payments & expenses' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Order invoice & balance' })).toBeVisible()

    await page.getByRole('combobox', { name: 'Order' }).click()
    await page.getByRole('option').first().click()
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
    const graphPoints = page.getByRole('button', { name: /Income LKR .*Expenses LKR/ })
    await expect(graphPoints).toHaveCount(6)
    await graphPoints.last().click()
    await expect(page.getByRole('tooltip')).toBeVisible()
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1,
    )).toBe(true)

    await page.screenshot({
      path: testInfo.outputPath('finance-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('accepts cents and clears the payment amount after a successful save', async ({ page }) => {
    const orderId = '60000000-0000-4000-8000-000000000001'
    const customerId = '10000000-0000-4000-8000-000000000001'
    await page.route('**/api/orders', (route) => route.fulfill({
      status: 200,
      json: {
        data: [{
          id: orderId,
          orderNumber: 'ORD-CENTS-001',
          quotationId: '50000000-0000-4000-8000-000000000001',
          customerId,
          customerName: 'Cents Test Customer',
          status: 'open',
          totalValueCents: 10_000,
          createdAt: '2026-09-10T00:00:00.000Z',
        }],
      },
    }))
    await page.route(`**/api/orders/${orderId}/invoice`, (route) => route.fulfill({
      status: 200,
      json: {
        data: {
          id: orderId,
          orderNumber: 'ORD-CENTS-001',
          quotationId: '50000000-0000-4000-8000-000000000001',
          customerId,
          customerName: 'Cents Test Customer',
          status: 'open',
          createdAt: '2026-09-10T00:00:00.000Z',
          orderValueCents: 10_000,
          claimAmountCents: 0,
          invoiceValueCents: 10_000,
          paidAmountCents: 0,
          outstandingBalanceCents: 10_000,
          currency: 'LKR',
          lines: [],
        },
      },
    }))
    await page.route(`**/api/customers/${customerId}/balance`, (route) => route.fulfill({
      status: 200,
      json: {
        data: {
          id: customerId,
          name: 'Cents Test Customer',
          outstandingBalanceCents: 10_000,
          currency: 'LKR',
          orders: [],
        },
      },
    }))
    await page.route('**/api/payments', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      await route.fulfill({ status: 201, json: { data: { id: 'payment-test-id' } } })
    })

    await signInAsFinance(page)

    const orderSelect = page.getByRole('combobox', { name: 'Order' })
    const paymentAmount = page.getByLabel(/^Amount \(LKR\)/)
    await orderSelect.click()
    await page.getByRole('option', { name: /ORD-CENTS-001/ }).click()
    await expect(page.getByText('Order selected')).toBeVisible()

    await expect(paymentAmount).toBeEnabled()
    await expect(paymentAmount).toHaveAttribute('step', '0.01')
    await expect(paymentAmount).toHaveAttribute('inputmode', 'decimal')

    const paymentRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === '/api/payments' && request.method() === 'POST')

    await paymentAmount.fill('0.01')
    await page.getByRole('button', { name: 'Record payment' }).click()

    expect((await paymentRequest).postDataJSON()).toMatchObject({ amountCents: 1 })
    await expect(page.getByText('Payment recorded and balances updated.')).toBeVisible()
    await expect(paymentAmount).toBeEmpty()
  })

  test('rolls the live finance graph forward at Colombo midnight', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-30T18:29:30.000Z') })
    await signInAsFinance(page)

    await expect(page.getByText(/September 2026.*auto-updates every minute/)).toBeVisible()
    const graph = page.getByRole('region', { name: 'Income vs expenses — last 6 months' })
    await expect(graph.getByText('Apr', { exact: true })).toBeVisible()
    await expect(graph.getByText('Sep', { exact: true })).toBeVisible()
    const octoberReport = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/finance/monthly'
        && url.searchParams.get('month') === '2026-10'
    })

    await page.clock.fastForward(60_000)

    expect((await octoberReport).ok()).toBe(true)
    await expect(page.getByLabel('Reporting month')).toHaveValue('2026-10')
    await expect(page.getByText(/October 2026.*auto-updates every minute/)).toBeVisible()
    await expect(graph.getByText('Apr', { exact: true })).toHaveCount(0)
    await expect(graph.getByText('May', { exact: true })).toBeVisible()
    await expect(graph.getByText('Oct', { exact: true })).toBeVisible()
  })
})
