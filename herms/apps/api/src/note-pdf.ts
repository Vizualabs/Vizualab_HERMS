import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

type PdfDate = Date | string | null

type NoteBase = {
  orderNumber: string
  customerName: string
  customerAddress: string | null
  storeName: string | null
  storeAddress: string | null
  status: string
  submittedByName: string | null
  approvedByName: string | null
  submittedAt: PdfDate
  approvedAt: PdfDate
  createdAt: PdfDate
}

type DeliveryNotePdfData = NoteBase & {
  dnNumber: string
  lines: Array<{
    equipmentName: string
    unitOfMeasure: string
    issuedQty: number
    handedOverQty: number
    countedQty: number | null
    mismatchReason: string | null
    mismatchDetail: string | null
  }>
}

type RetentionNotePdfData = NoteBase & {
  rnNumber: string
  deliveryNoteNumber: string | null
  lines: Array<{
    equipmentName: string
    unitOfMeasure: string
    deliveredQty: number
    returnedQty: number
    balanceQty: number
    missingDamagedQty: number
    countedReturnedQty: number | null
    mismatchReason: string | null
    responsibleParty: string | null
    reasonDetail: string | null
  }>
}

type Column = { label: string; x: number; width: number }

const ink = rgb(0.12, 0.16, 0.2)
const rule = rgb(0.72, 0.75, 0.78)
const headerFill = rgb(0.91, 0.94, 0.96)

function text(value: unknown) {
  return String(value ?? '-')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim() || '-'
}

function date(value: PdfDate) {
  if (!value) return '-'
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toISOString().slice(0, 10)
}

function fit(value: unknown, font: PDFFont, size: number, width: number) {
  const input = text(value)
  if (font.widthOfTextAtSize(input, size) <= width) return input
  let result = input
  while (result.length > 1 && font.widthOfTextAtSize(result + '...', size) > width) {
    result = result.slice(0, -1)
  }
  return result + '...'
}

function drawPageNumber(document: PDFDocument, font: PDFFont) {
  const pages = document.getPages()
  pages.forEach((page, index) => {
    page.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: page.getWidth() - 92,
      y: 22,
      size: 8,
      font,
      color: rgb(0.4, 0.44, 0.48),
    })
  })
}

function drawTableHeader(
  page: PDFPage,
  columns: Column[],
  bold: PDFFont,
  y: number,
) {
  const left = columns[0]?.x ?? 45
  const right = columns.at(-1)
  const width = right ? right.x + right.width - left : 505
  page.drawRectangle({ x: left - 4, y: y - 7, width: width + 8, height: 24, color: headerFill })
  for (const column of columns) {
    page.drawText(fit(column.label, bold, 8, column.width - 4), {
      x: column.x,
      y,
      size: 8,
      font: bold,
      color: ink,
    })
  }
}

function drawTableRow(
  page: PDFPage,
  columns: Column[],
  values: unknown[],
  regular: PDFFont,
  y: number,
) {
  columns.forEach((column, index) => {
    page.drawText(fit(values[index], regular, 8, column.width - 4), {
      x: column.x,
      y,
      size: 8,
      font: regular,
      color: ink,
    })
  })
  page.drawLine({
    start: { x: columns[0]!.x - 2, y: y - 7 },
    end: { x: columns.at(-1)!.x + columns.at(-1)!.width, y: y - 7 },
    thickness: 0.4,
    color: rule,
  })
}

function drawSignatures(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  y: number,
  submittedBy: string | null,
  submittedAt: PdfDate,
  approvedBy: string | null,
  approvedAt: PdfDate,
) {
  const width = page.getWidth()
  const left = 52
  const right = Math.max(330, width - 300)
  page.drawLine({ start: { x: left, y }, end: { x: left + 210, y }, thickness: 0.6, color: rule })
  page.drawLine({ start: { x: right, y }, end: { x: right + 210, y }, thickness: 0.6, color: rule })
  page.drawText('Submitted / issued by', { x: left, y: y - 15, size: 8, font: bold, color: ink })
  page.drawText(fit(submittedBy, regular, 9, 205), { x: left, y: y - 29, size: 9, font: regular, color: ink })
  page.drawText(`Date: ${date(submittedAt)}`, { x: left, y: y - 43, size: 8, font: regular, color: ink })
  page.drawText('Approved by', { x: right, y: y - 15, size: 8, font: bold, color: ink })
  page.drawText(fit(approvedBy, regular, 9, 205), { x: right, y: y - 29, size: 9, font: regular, color: ink })
  page.drawText(`Date: ${date(approvedAt)}`, { x: right, y: y - 43, size: 8, font: regular, color: ink })
}

function drawIdentity(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  note: NoteBase,
  title: string,
  number: string,
  reference: string,
) {
  const width = page.getWidth()
  page.drawText(fit(note.storeName ?? 'HERMS', bold, 20, width - 100), { x: 50, y: page.getHeight() - 52, size: 20, font: bold, color: ink })
  page.drawText(fit(note.storeAddress, regular, 9, width - 100), { x: 50, y: page.getHeight() - 70, size: 9, font: regular, color: ink })
  page.drawText(title, { x: 50, y: page.getHeight() - 112, size: 18, font: bold, color: ink })
  page.drawText(fit(number, bold, 12, 230), { x: width - 280, y: page.getHeight() - 108, size: 12, font: bold, color: ink })
  page.drawText(`Date: ${date(note.createdAt)}`, { x: width - 280, y: page.getHeight() - 125, size: 9, font: regular, color: ink })
  page.drawText(`Order: ${text(note.orderNumber)}`, { x: 50, y: page.getHeight() - 150, size: 9, font: regular, color: ink })
  page.drawText(reference, { x: width - 280, y: page.getHeight() - 150, size: 9, font: regular, color: ink })
  page.drawText('Customer / project location', { x: 50, y: page.getHeight() - 178, size: 9, font: bold, color: ink })
  page.drawText(fit(note.customerName, bold, 11, width - 100), { x: 50, y: page.getHeight() - 194, size: 11, font: bold, color: ink })
  page.drawText(fit(note.customerAddress, regular, 9, width - 100), { x: 50, y: page.getHeight() - 210, size: 9, font: regular, color: ink })
}

export async function createDeliveryNotePdf(note: DeliveryNotePdfData) {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const columns: Column[] = [
    { label: 'Equipment', x: 48, width: 184 },
    { label: 'Unit', x: 234, width: 48 },
    { label: 'Issued', x: 284, width: 48 },
    { label: 'Handed', x: 334, width: 54 },
    { label: 'Counted', x: 390, width: 52 },
    { label: 'Reason / remarks', x: 444, width: 104 },
  ]
  let page = document.addPage([595.28, 841.89])
  drawIdentity(page, regular, bold, note, 'DELIVERY NOTE', note.dnNumber, `Status: ${text(note.status).toUpperCase()}`)
  let y = 596
  drawTableHeader(page, columns, bold, y)
  y -= 28
  for (const line of note.lines) {
    if (y < 110) {
      page = document.addPage([595.28, 841.89])
      y = 790
      drawTableHeader(page, columns, bold, y)
      y -= 28
    }
    const reason = [line.mismatchReason, line.mismatchDetail].filter(Boolean).join(': ')
    drawTableRow(page, columns, [line.equipmentName, line.unitOfMeasure, line.issuedQty, line.handedOverQty, line.countedQty, reason], regular, y)
    y -= 24
  }
  if (y < 105) {
    page = document.addPage([595.28, 841.89])
    y = 760
  }
  drawSignatures(page, regular, bold, y - 20, note.submittedByName, note.submittedAt, note.approvedByName, note.approvedAt)
  drawPageNumber(document, regular)
  return document.save()
}

export async function createRetentionNotePdf(note: RetentionNotePdfData) {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const columns: Column[] = [
    { label: 'Equipment', x: 42, width: 164 },
    { label: 'Unit', x: 208, width: 42 },
    { label: 'Delivered', x: 252, width: 52 },
    { label: 'Returned', x: 306, width: 52 },
    { label: 'Balance', x: 360, width: 48 },
    { label: 'Missing / damaged', x: 410, width: 76 },
    { label: 'Counted', x: 488, width: 50 },
    { label: 'Responsible / reason', x: 540, width: 254 },
  ]
  let page = document.addPage([841.89, 595.28])
  drawIdentity(page, regular, bold, note, 'RETENTION NOTE', note.rnNumber, `Delivery note: ${text(note.deliveryNoteNumber)}`)
  let y = 350
  drawTableHeader(page, columns, bold, y)
  y -= 28
  for (const line of note.lines) {
    if (y < 105) {
      page = document.addPage([841.89, 595.28])
      y = 540
      drawTableHeader(page, columns, bold, y)
      y -= 28
    }
    const reason = [line.responsibleParty, line.mismatchReason, line.reasonDetail].filter(Boolean).join(': ')
    drawTableRow(page, columns, [line.equipmentName, line.unitOfMeasure, line.deliveredQty, line.returnedQty, line.balanceQty, line.missingDamagedQty, line.countedReturnedQty, reason], regular, y)
    y -= 24
  }
  if (y < 100) {
    page = document.addPage([841.89, 595.28])
    y = 500
  }
  drawSignatures(page, regular, bold, y - 15, note.submittedByName, note.submittedAt, note.approvedByName, note.approvedAt)
  drawPageNumber(document, regular)
  return document.save()
}
