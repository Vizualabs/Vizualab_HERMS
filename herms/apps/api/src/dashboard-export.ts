import type { DashboardReport } from '@herms/db'
import { Workbook, type Worksheet } from 'exceljs'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

const money = (value: number, currency: string) =>
  `${currency} ${(value / 100).toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

function date(value: string) {
  return value.slice(0, 10)
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

function table(
  context: PdfContext,
  columns: PdfColumn[],
  rows: string[][],
) {
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
  for (const row of rows) {
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

export async function createDashboardPdf(report: DashboardReport) {
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
  context.page.drawText('HERMS MANAGEMENT REPORT', {
    x: MARGIN,
    y: context.y,
    font: bold,
    size: 20,
    color: rgb(0.11, 0.24, 0.19),
  })
  context.y -= 24
  context.page.drawText(
    `Period ${report.filters.from} to ${report.filters.to} | Generated ${date(report.generatedAt)}`,
    { x: MARGIN, y: context.y, font: regular, size: 9, color: rgb(0.36, 0.4, 0.4) },
  )
  context.y -= 30

  heading(context, 'Financial overview')
  table(context, [
    { label: 'Period', width: 85 },
    { label: 'Pending', width: 110, align: 'right' },
    { label: 'Received', width: 105, align: 'right' },
    { label: 'Expenses', width: 105, align: 'right' },
    { label: 'Net', width: 106, align: 'right' },
  ], [
    [
      report.payments.current.month,
      money(report.payments.current.pendingAmountCents, report.payments.currency),
      money(report.payments.current.receivedAmountCents, report.payments.currency),
      money(report.incomeExpenses.current.expenseCents, report.payments.currency),
      money(report.incomeExpenses.current.netPositionCents, report.payments.currency),
    ],
    [
      report.payments.previous.month,
      money(report.payments.previous.pendingAmountCents, report.payments.currency),
      money(report.payments.previous.receivedAmountCents, report.payments.currency),
      money(report.incomeExpenses.previous.expenseCents, report.payments.currency),
      money(report.incomeExpenses.previous.netPositionCents, report.payments.currency),
    ],
  ])

  heading(context, 'Stock by equipment')
  table(context, [
    { label: 'Equipment', width: 190 },
    { label: 'Category', width: 105 },
    { label: 'Quantity', width: 75, align: 'right' },
    { label: 'Unit price', width: 70, align: 'right' },
    { label: 'Value', width: 71, align: 'right' },
  ], report.stock.items.map((item) => [
    item.equipmentName,
    item.category,
    `${item.quantity} ${item.unitOfMeasure}`,
    money(item.currentUnitPriceCents, report.stock.currency),
    money(item.valueCents, report.stock.currency),
  ]))

  heading(context, 'Open missing and damaged equipment')
  table(context, [
    { label: 'Recorded', width: 62 },
    { label: 'Customer', width: 105 },
    { label: 'Equipment', width: 115 },
    { label: 'Type', width: 55 },
    { label: 'Party', width: 66 },
    { label: 'Qty', width: 35, align: 'right' },
    { label: 'Value', width: 73, align: 'right' },
  ], report.discrepancies.rows.map((row) => [
    date(row.recordedAt),
    row.customerName ?? '-',
    row.equipmentName,
    row.discrepancyType,
    row.responsibleParty?.replaceAll('_', ' ') ?? '-',
    String(row.quantity),
    money(row.valueCents, report.discrepancies.currency),
  ]))

  heading(context, 'Top 10 equipment')
  table(context, [
    { label: 'Equipment', width: 235 },
    { label: 'Cases', width: 75, align: 'right' },
    { label: 'Quantity', width: 85, align: 'right' },
    { label: 'Value', width: 116, align: 'right' },
  ], report.rankings.items.map((row) => [
    row.name,
    String(row.caseCount),
    String(row.quantity),
    money(row.valueCents, report.rankings.currency),
  ]))

  heading(context, 'Top 10 customers')
  table(context, [
    { label: 'Customer', width: 235 },
    { label: 'Cases', width: 75, align: 'right' },
    { label: 'Quantity', width: 85, align: 'right' },
    { label: 'Value', width: 116, align: 'right' },
  ], report.rankings.customers.map((row) => [
    row.name,
    String(row.caseCount),
    String(row.quantity),
    money(row.valueCents, report.rankings.currency),
  ]))

  if (report.escalations) {
    heading(context, 'Owner price escalation')
    ensureSpace(context, 30)
    context.page.drawText(
      `Current 10% preview: ${report.escalations.preview.itemCount} items, ${money(
        report.escalations.preview.currentValueCents,
        report.escalations.currency,
      )} to ${money(
        report.escalations.preview.escalatedValueCents,
        report.escalations.currency,
      )}`,
      { x: MARGIN, y: context.y, font: bold, size: 9, color: rgb(0.12, 0.28, 0.22) },
    )
    context.y -= 24
    table(context, [
      { label: 'Applied', width: 85 },
      { label: 'Owner', width: 165 },
      { label: 'Items', width: 60, align: 'right' },
      { label: 'Before', width: 100, align: 'right' },
      { label: 'After', width: 101, align: 'right' },
    ], report.escalations.history.map((row) => [
      date(row.effectiveDate),
      row.ownerName,
      String(row.itemCount),
      money(row.previousValueCents, report.escalations!.currency),
      money(row.escalatedValueCents, report.escalations!.currency),
    ]))
  }

  const pages = document.getPages()
  pages.forEach((page, index) => {
    page.drawText('HERMS | Reconciled management reporting', {
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

const HEADER_FILL = 'FF287A5B'
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true }
const MONEY_FORMAT = '\"LKR\" #,##0.00'

function styleSheet(sheet: Worksheet, widths: number[]) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.getRow(1).height = 24
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle' }
  })
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width
  })
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: widths.length },
  }
}

function addSummarySheet(workbook: Workbook, report: DashboardReport) {
  const sheet = workbook.addWorksheet('Summary', {
    properties: { tabColor: { argb: HEADER_FILL } },
  })
  sheet.columns = [
    { header: 'Metric', key: 'metric', width: 34 },
    { header: 'Current period', key: 'current', width: 22 },
    { header: 'Previous period', key: 'previous', width: 22 },
  ]
  sheet.addRows([
    {
      metric: 'Report month',
      current: report.payments.current.month,
      previous: report.payments.previous.month,
    },
    {
      metric: 'Pending payments',
      current: report.payments.current.pendingAmountCents / 100,
      previous: report.payments.previous.pendingAmountCents / 100,
    },
    {
      metric: 'Received payments',
      current: report.payments.current.receivedAmountCents / 100,
      previous: report.payments.previous.receivedAmountCents / 100,
    },
    {
      metric: 'Expenses',
      current: report.incomeExpenses.current.expenseCents / 100,
      previous: report.incomeExpenses.previous.expenseCents / 100,
    },
    {
      metric: 'Net position',
      current: report.incomeExpenses.current.netPositionCents / 100,
      previous: report.incomeExpenses.previous.netPositionCents / 100,
    },
    {
      metric: 'Stock quantity',
      current: report.stock.totalQuantity,
      previous: null,
    },
    {
      metric: 'Stock value',
      current: report.stock.totalValueCents / 100,
      previous: null,
    },
    {
      metric: 'Open missing/damaged cases',
      current: report.discrepancies.openCount,
      previous: null,
    },
    {
      metric: 'Open missing/damaged value',
      current: report.discrepancies.totalValueCents / 100,
      previous: null,
    },
  ])
  for (const rowNumber of [3, 4, 5, 6, 8, 10]) {
    sheet.getRow(rowNumber).getCell(2).numFmt = MONEY_FORMAT
    sheet.getRow(rowNumber).getCell(3).numFmt = MONEY_FORMAT
  }
  sheet.getCell('A12').value = 'Generated at'
  sheet.getCell('B12').value = new Date(report.generatedAt)
  sheet.getCell('B12').numFmt = 'yyyy-mm-dd hh:mm'
  sheet.getCell('A13').value = 'Timezone'
  sheet.getCell('B13').value = report.payments.timezone
  sheet.getCell('A14').value = 'Date filter'
  sheet.getCell('B14').value = `${report.filters.from} to ${report.filters.to}`
  styleSheet(sheet, [34, 22, 22])
}

export async function createDashboardXlsx(report: DashboardReport) {
  const workbook = new Workbook()
  workbook.creator = 'HERMS'
  workbook.title = 'HERMS Management Report'
  workbook.subject = `Management dashboard for ${report.filters.month}`
  workbook.created = new Date(report.generatedAt)
  workbook.modified = new Date(report.generatedAt)
  addSummarySheet(workbook, report)

  const stock = workbook.addWorksheet('Stock')
  stock.columns = [
    { header: 'Equipment', key: 'equipmentName' },
    { header: 'Category', key: 'category' },
    { header: 'Unit', key: 'unitOfMeasure' },
    { header: 'Quantity', key: 'quantity' },
    { header: 'Unit price', key: 'unitPrice' },
    { header: 'Value', key: 'value' },
  ]
  stock.addRows(report.stock.items.map((item) => ({
    equipmentName: item.equipmentName,
    category: item.category,
    unitOfMeasure: item.unitOfMeasure,
    quantity: item.quantity,
    unitPrice: item.currentUnitPriceCents / 100,
    value: item.valueCents / 100,
  })))
  stock.getColumn(4).numFmt = '#,##0'
  stock.getColumn(5).numFmt = MONEY_FORMAT
  stock.getColumn(6).numFmt = MONEY_FORMAT
  styleSheet(stock, [30, 20, 12, 12, 16, 18])

  const discrepancies = workbook.addWorksheet('Open Discrepancies')
  discrepancies.columns = [
    { header: 'Recorded', key: 'recordedAt' },
    { header: 'Order', key: 'orderNumber' },
    { header: 'Customer', key: 'customerName' },
    { header: 'Equipment', key: 'equipmentName' },
    { header: 'Type', key: 'type' },
    { header: 'Responsible party', key: 'party' },
    { header: 'Quantity', key: 'quantity' },
    { header: 'Unit price', key: 'unitPrice' },
    { header: 'Value', key: 'value' },
    { header: 'Reason', key: 'reason' },
  ]
  discrepancies.addRows(report.discrepancies.rows.map((row) => ({
    recordedAt: new Date(row.recordedAt),
    orderNumber: row.orderNumber ?? '',
    customerName: row.customerName ?? '',
    equipmentName: row.equipmentName,
    type: row.discrepancyType,
    party: row.responsibleParty?.replaceAll('_', ' ') ?? '',
    quantity: row.quantity,
    unitPrice: row.unitPriceCents / 100,
    value: row.valueCents / 100,
    reason: row.reason ?? '',
  })))
  discrepancies.getColumn(1).numFmt = 'yyyy-mm-dd'
  discrepancies.getColumn(7).numFmt = '#,##0'
  discrepancies.getColumn(8).numFmt = MONEY_FORMAT
  discrepancies.getColumn(9).numFmt = MONEY_FORMAT
  styleSheet(discrepancies, [14, 18, 26, 26, 12, 18, 11, 16, 16, 42])

  const addRankingSheet = (
    name: string,
    rows: DashboardReport['rankings']['items'],
    firstHeader: string,
  ) => {
    const sheet = workbook.addWorksheet(name)
    sheet.columns = [
      { header: firstHeader, key: 'name' },
      { header: 'Cases', key: 'caseCount' },
      { header: 'Quantity', key: 'quantity' },
      { header: 'Value', key: 'value' },
    ]
    sheet.addRows(rows.map((row) => ({
      name: row.name,
      caseCount: row.caseCount,
      quantity: row.quantity,
      value: row.valueCents / 100,
    })))
    sheet.getColumn(2).numFmt = '#,##0'
    sheet.getColumn(3).numFmt = '#,##0'
    sheet.getColumn(4).numFmt = MONEY_FORMAT
    styleSheet(sheet, [34, 12, 14, 18])
  }
  addRankingSheet('Top Equipment', report.rankings.items, 'Equipment')
  addRankingSheet('Top Customers', report.rankings.customers, 'Customer')

  if (report.escalations) {
    const escalation = workbook.addWorksheet('Price Escalations')
    escalation.columns = [
      { header: 'Applied at', key: 'effectiveDate' },
      { header: 'Owner', key: 'ownerName' },
      { header: 'Items', key: 'itemCount' },
      { header: 'Previous price book', key: 'previousValue' },
      { header: 'Escalated price book', key: 'escalatedValue' },
    ]
    escalation.addRows(report.escalations.history.map((row) => ({
      effectiveDate: new Date(row.effectiveDate),
      ownerName: row.ownerName,
      itemCount: row.itemCount,
      previousValue: row.previousValueCents / 100,
      escalatedValue: row.escalatedValueCents / 100,
    })))
    escalation.getColumn(1).numFmt = 'yyyy-mm-dd hh:mm'
    escalation.getColumn(3).numFmt = '#,##0'
    escalation.getColumn(4).numFmt = MONEY_FORMAT
    escalation.getColumn(5).numFmt = MONEY_FORMAT
    styleSheet(escalation, [20, 28, 12, 22, 22])
    const previewRow = escalation.rowCount + 3
    escalation.getCell(previewRow, 1).value = 'Current 10% preview'
    escalation.getCell(previewRow, 1).font = { bold: true }
    escalation.getCell(previewRow + 1, 1).value = 'Items'
    escalation.getCell(previewRow + 1, 2).value = report.escalations.preview.itemCount
    escalation.getCell(previewRow + 2, 1).value = 'Current price book'
    escalation.getCell(previewRow + 2, 2).value =
      report.escalations.preview.currentValueCents / 100
    escalation.getCell(previewRow + 2, 2).numFmt = MONEY_FORMAT
    escalation.getCell(previewRow + 3, 1).value = 'After 10% escalation'
    escalation.getCell(previewRow + 3, 2).value =
      report.escalations.preview.escalatedValueCents / 100
    escalation.getCell(previewRow + 3, 2).numFmt = MONEY_FORMAT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}
