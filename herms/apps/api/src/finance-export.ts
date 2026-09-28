import type { FinanceService } from '@herms/db'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

type MonthlyFinanceReport = Awaited<ReturnType<FinanceService['getMonthly']>>

const money = (value: number, currency: string) =>
  `${currency} ${(value / 100).toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

function formatMonth(month: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(new Date(value))
}

function formatMethod(method: string) {
  return method.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase())
}

type PdfContext = {
  document: PDFDocument
  regular: PDFFont
  bold: PDFFont
  page: PDFPage
  y: number
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 42

function fit(text: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(text, size) <= width) return text
  let result = text
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) {
    result = result.slice(0, -1)
  }
  return `${result}...`
}

function addPage(context: PdfContext) {
  context.page = context.document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  context.y = PAGE_HEIGHT - MARGIN
  context.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 12,
    width: PAGE_WIDTH,
    height: 12,
    color: rgb(0.16, 0.48, 0.36),
  })
}

function ensureSpace(context: PdfContext, height: number) {
  if (context.y - height < 48) addPage(context)
}

function heading(context: PdfContext, title: string) {
  ensureSpace(context, 34)
  context.page.drawText(title, {
    x: MARGIN,
    y: context.y,
    font: context.bold,
    size: 13,
    color: rgb(0.12, 0.22, 0.28),
  })
  context.y -= 23
}

type PdfColumn = { label: string; width: number; align?: 'left' | 'right' }

function table(context: PdfContext, columns: PdfColumn[], rows: string[][]) {
  const drawHeader = () => {
    ensureSpace(context, 42)
    context.page.drawRectangle({
      x: MARGIN,
      y: context.y - 6,
      width: PAGE_WIDTH - MARGIN * 2,
      height: 22,
      color: rgb(0.9, 0.95, 0.92),
    })
    let x = MARGIN + 5
    columns.forEach((column) => {
      const label = fit(column.label, context.bold, 8, column.width - 10)
      const textWidth = context.bold.widthOfTextAtSize(label, 8)
      context.page.drawText(label, {
        x: column.align === 'right' ? x + column.width - textWidth - 5 : x,
        y: context.y,
        font: context.bold,
        size: 8,
        color: rgb(0.12, 0.28, 0.22),
      })
      x += column.width
    })
    context.y -= 24
  }
  drawHeader()
  const body = rows.length > 0 ? rows : [columns.map(() => '—')]
  for (const row of body) {
    if (context.y < 62) {
      addPage(context)
      drawHeader()
    }
    let x = MARGIN + 5
    columns.forEach((column, index) => {
      const value = fit(row[index] ?? '', context.regular, 7.5, column.width - 10)
      const textWidth = context.regular.widthOfTextAtSize(value, 7.5)
      context.page.drawText(value, {
        x: column.align === 'right' ? x + column.width - textWidth - 5 : x,
        y: context.y,
        font: context.regular,
        size: 7.5,
        color: rgb(0.16, 0.19, 0.22),
      })
      x += column.width
    })
    context.page.drawLine({
      start: { x: MARGIN, y: context.y - 6 },
      end: { x: PAGE_WIDTH - MARGIN, y: context.y - 6 },
      thickness: 0.35,
      color: rgb(0.84, 0.86, 0.85),
    })
    context.y -= 19
  }
  context.y -= 9
}

export async function createFinancePdf(report: MonthlyFinanceReport) {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const context: PdfContext = {
    document,
    regular,
    bold,
    page: document.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN,
  }
  context.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 12,
    width: PAGE_WIDTH,
    height: 12,
    color: rgb(0.16, 0.48, 0.36),
  })
  context.page.drawText('HERMS PAYMENTS & FINANCE', {
    x: MARGIN,
    y: context.y,
    font: bold,
    size: 20,
    color: rgb(0.11, 0.24, 0.19),
  })
  context.y -= 24
  context.page.drawText(
    `${formatMonth(report.month)} | Generated ${formatDate(new Date().toISOString(), report.timezone)}`,
    { x: MARGIN, y: context.y, font: regular, size: 9, color: rgb(0.36, 0.4, 0.4) },
  )
  context.y -= 30

  heading(context, 'Summary')
  table(context, [
    { label: 'Metric', width: 255 },
    { label: 'Amount', width: 256, align: 'right' },
  ], [
    ['Received this month', money(report.incomeCents, report.currency)],
    ['Outstanding', money(report.outstandingCents, report.currency)],
    ['Expenses this month', money(report.expenseCents, report.currency)],
    ['Net position', money(report.netPositionCents, report.currency)],
  ])

  heading(context, 'Income vs expenses — last 6 months')
  table(context, [
    { label: 'Month', width: 171 },
    { label: 'Income', width: 170, align: 'right' },
    { label: 'Expenses', width: 170, align: 'right' },
  ], report.history.map((row) => [
    formatMonth(row.month),
    money(row.incomeCents, report.currency),
    money(row.expenseCents, report.currency),
  ]))

  heading(context, 'Payments received')
  table(context, [
    { label: 'Date', width: 70 },
    { label: 'Customer', width: 130 },
    { label: 'Order', width: 100 },
    { label: 'Method', width: 80 },
    { label: 'Amount', width: 131, align: 'right' },
  ], report.recentPayments.map((row) => [
    formatDate(row.paymentDate, report.timezone),
    row.customerName,
    row.orderNumber,
    formatMethod(row.method),
    money(row.amountCents, report.currency),
  ]))

  heading(context, 'Other income')
  table(context, [
    { label: 'Date', width: 70 },
    { label: 'Category', width: 110 },
    { label: 'Description', width: 200 },
    { label: 'Amount', width: 131, align: 'right' },
  ], report.recentOtherIncomes.map((row) => [
    formatDate(row.incomeDate, report.timezone),
    row.category,
    row.description ?? '—',
    money(row.amountCents, report.currency),
  ]))

  heading(context, 'Expenses')
  table(context, [
    { label: 'Date', width: 70 },
    { label: 'Category', width: 110 },
    { label: 'Description', width: 200 },
    { label: 'Amount', width: 131, align: 'right' },
  ], report.recentExpenses.map((row) => [
    formatDate(row.expenseDate, report.timezone),
    row.category,
    row.description ?? '—',
    money(row.amountCents, report.currency),
  ]))

  heading(context, 'Outstanding balances')
  table(context, [
    { label: 'Customer', width: 151 },
    { label: 'Open orders', width: 70, align: 'right' },
    { label: 'Invoiced', width: 96, align: 'right' },
    { label: 'Paid', width: 96, align: 'right' },
    { label: 'Outstanding', width: 98, align: 'right' },
  ], report.outstandingBalances.map((row) => [
    row.customerName,
    String(row.openOrders),
    money(row.invoicedCents, report.currency),
    money(row.paidCents, report.currency),
    money(row.outstandingCents, report.currency),
  ]))

  const pages = document.getPages()
  pages.forEach((page, index) => {
    page.drawText('HERMS | Payments & Finance', {
      x: MARGIN,
      y: 25,
      font: regular,
      size: 7.5,
      color: rgb(0.42, 0.45, 0.45),
    })
    const pageLabel = `Page ${index + 1} of ${pages.length}`
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageLabel, 7.5),
      y: 25,
      font: regular,
      size: 7.5,
      color: rgb(0.42, 0.45, 0.45),
    })
  })
  return document.save()
}
