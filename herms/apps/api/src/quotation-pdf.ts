import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

type QuotationPdfData = {
  quotationNumber: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  customerAddress: string | null
  storeName: string
  storeAddress: string | null
  status: string
  currency: string
  createdAt: Date
  expiresAt: Date | null
  totalValueCents: number
  lines: Array<{
    equipmentName: string
    unitOfMeasure: string
    quantity: number
    unitPriceCents: number
    lineTotalCents: number
  }>
}

const money = (value: number, currency: string) => `${currency} ${(value / 100).toFixed(2)}`
const date = (value: Date | null) => value ? value.toISOString().slice(0, 10) : '-'

export async function createQuotationPdf(quotation: QuotationPdfData) {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  let page = document.addPage([595.28, 841.89])
  let y = 790

  const draw = (text: string, x: number, size = 10, useBold = false) => {
    page.drawText(text, { x, y, size, font: useBold ? bold : regular, color: rgb(0.12, 0.16, 0.2) })
  }
  const nextPage = () => {
    page = document.addPage([595.28, 841.89])
    y = 790
  }

  draw(quotation.storeName, 50, 20, true)
  y -= 22
  if (quotation.storeAddress) draw(quotation.storeAddress.slice(0, 82), 50, 9)
  y -= 38
  draw('QUOTATION', 50, 18, true)
  draw(quotation.quotationNumber, 390, 12, true)
  y -= 24
  draw(`Created: ${date(quotation.createdAt)}`, 390, 9)
  y -= 15
  draw(`Expires: ${date(quotation.expiresAt)}`, 390, 9)
  y -= 30
  draw('Prepared for', 50, 10, true)
  y -= 16
  draw(quotation.customerName.slice(0, 80), 50, 12, true)
  y -= 15
  if (quotation.customerAddress) { draw(quotation.customerAddress.slice(0, 82), 50, 9); y -= 14 }
  if (quotation.customerPhone) { draw(`Phone: ${quotation.customerPhone}`, 50, 9); y -= 14 }
  if (quotation.customerEmail) { draw(`Email: ${quotation.customerEmail}`, 50, 9); y -= 14 }
  y -= 22

  const header = () => {
    page.drawRectangle({ x: 45, y: y - 7, width: 505, height: 24, color: rgb(0.91, 0.94, 0.96) })
    draw('Item', 52, 9, true)
    draw('Qty', 335, 9, true)
    draw('Unit price', 390, 9, true)
    draw('Total', 485, 9, true)
    y -= 27
  }
  header()
  for (const line of quotation.lines) {
    if (y < 90) { nextPage(); header() }
    draw(line.equipmentName.slice(0, 48), 52, 9)
    draw(`${line.quantity} ${line.unitOfMeasure}`.slice(0, 14), 335, 9)
    draw(money(line.unitPriceCents, quotation.currency), 390, 9)
    draw(money(line.lineTotalCents, quotation.currency), 485, 9)
    y -= 22
    page.drawLine({ start: { x: 48, y: y + 8 }, end: { x: 547, y: y + 8 }, thickness: 0.4, color: rgb(0.82, 0.84, 0.86) })
  }
  y -= 16
  draw('Quotation total', 390, 11, true)
  draw(money(quotation.totalValueCents, quotation.currency), 485, 11, true)
  y -= 45
  draw(`Status: ${quotation.status.toUpperCase()}`, 50, 9, true)
  y -= 16
  draw('Prices are frozen for this quotation. Please reference the quotation number when responding.', 50, 8)

  const pages = document.getPages()
  pages.forEach((item, index) => {
    item.drawText(`Page ${index + 1} of ${pages.length}`, { x: 485, y: 28, size: 8, font: regular, color: rgb(0.4, 0.44, 0.48) })
  })
  return document.save()
}
