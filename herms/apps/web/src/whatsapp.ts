export function createWhatsAppWebUrl(message: string) {
  return `https://web.whatsapp.com/send?text=${encodeURIComponent(message)}`
}

export function createNoteShareMessage({
  noteType,
  noteNumber,
  orderNumber,
  customerName,
  submissionLink,
}: {
  noteType: 'Delivery' | 'Retention'
  noteNumber: string
  orderNumber: string
  customerName: string
  submissionLink: string
}) {
  return `${noteType} note ${noteNumber} for ${customerName} (${orderNumber}): ${submissionLink}`
}

export function createQuotationShareMessage({
  quotationNumber,
  customerName,
  submissionLink,
}: {
  quotationNumber: string
  customerName: string
  submissionLink?: string
}) {
  return submissionLink
    ? `Hello ${customerName}, please review quotation ${quotationNumber}: ${submissionLink}`
    : `Hello ${customerName}, please find quotation ${quotationNumber} attached.`
}
