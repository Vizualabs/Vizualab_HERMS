import { describe, expect, test } from 'bun:test'

import {
  createNoteShareMessage,
  createQuotationShareMessage,
  createWhatsAppWebUrl,
} from './whatsapp'

describe('manual WhatsApp sharing', () => {
  test('opens WhatsApp Web with encoded text and no automatic recipient', () => {
    const message = createNoteShareMessage({
      noteType: 'Delivery',
      noteNumber: 'DN-1001',
      orderNumber: 'ORD-1001',
      customerName: 'Cinnamon Grand',
      submissionLink: 'https://herms.example/notes/token?source=manual',
    })

    const url = new URL(createWhatsAppWebUrl(message))
    expect(url.origin).toBe('https://web.whatsapp.com')
    expect(url.pathname).toBe('/send')
    expect(url.searchParams.get('text')).toBe(message)
    expect(url.searchParams.has('phone')).toBe(false)
  })

  test('creates a quotation message that expects a manually attached PDF', () => {
    expect(createQuotationShareMessage({
      quotationNumber: 'QT-1001',
      customerName: 'Cinnamon Grand',
    })).toBe('Hello Cinnamon Grand, please find quotation QT-1001 attached.')
  })

  test('creates a manual quotation-link message without choosing a recipient', () => {
    const link = 'https://herms.example/quotes/secure-token'
    expect(createQuotationShareMessage({
      quotationNumber: 'QT-1001',
      customerName: 'Cinnamon Grand',
      submissionLink: link,
    })).toBe(`Hello Cinnamon Grand, please review quotation QT-1001: ${link}`)
  })
})
