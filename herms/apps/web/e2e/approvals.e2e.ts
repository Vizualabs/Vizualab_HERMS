import { expect, test, type Page } from '@playwright/test'

async function acceptAppConfirm(page: Page, confirmName: string | RegExp) {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: confirmName }).click()
  await expect(dialog).toBeHidden()
}

const storeAdmin = {
  id: '30000000-0000-4000-8000-000000000001',
  storeId: '20000000-0000-4000-8000-000000000001',
  name: 'Store Admin',
  role: 'store_admin',
  isDeputyAdmin: false,
  email: 'store@example.test',
}

const commonNote = {
  orderId: '60000000-0000-4000-8000-000000000001',
  orderNumber: 'ORD-2026-000001',
  customerId: '10000000-0000-4000-8000-000000000001',
  customerName: 'Example Hotel',
  customerAddress: '1 Example Road',
  storeId: storeAdmin.storeId,
  storeName: 'Main Store',
  storeAddress: '2 Store Road',
  submittedBy: '30000000-0000-4000-8000-000000000002',
  submittedByName: 'Field User',
  approvedBy: null,
  approvedByName: null,
  submittedAt: '2026-09-11T02:00:00.000Z',
  approvedAt: null,
  createdAt: '2026-09-11T01:00:00.000Z',
  updatedAt: '2026-09-11T02:00:00.000Z',
}

const deliveryNote = {
  ...commonNote,
  id: '70000000-0000-4000-8000-000000000001',
  noteType: 'delivery_note' as const,
  dnNumber: 'DN-2026-000001',
  status: 'pending_approval' as const,
  lines: [{
    id: '80000000-0000-4000-8000-000000000001',
    equipmentItemId: '50000000-0000-4000-8000-000000000001',
    equipmentName: 'Scaffold frame',
    unitOfMeasure: 'unit',
    issuedQty: 10,
    handedOverQty: 8,
    countedQty: null as number | null,
    mismatchReason: 'damaged' as const,
    mismatchDetail: 'Two frames held back',
    countDifference: null as number | null,
  }],
}

const retentionNote = {
  ...commonNote,
  id: '90000000-0000-4000-8000-000000000001',
  noteType: 'retention_note' as const,
  rnNumber: 'RN-2026-000001',
  deliveryNoteId: null,
  deliveryNoteNumber: null,
  status: 'pending_approval' as const,
  submittedAt: '2026-09-11T03:00:00.000Z',
  lines: [{
    id: '91000000-0000-4000-8000-000000000001',
    equipmentItemId: '50000000-0000-4000-8000-000000000001',
    equipmentName: 'Scaffold frame',
    unitOfMeasure: 'unit',
    deliveredQty: 10,
    returnedQty: 6,
    balanceQty: 2,
    missingDamagedQty: 0,
    countedReturnedQty: null as number | null,
    mismatchReason: null,
    responsibleParty: null,
    reasonDetail: null,
    countDifference: null as number | null,
    discrepancyId: null,
    discrepancyStatus: null,
    writeOffLedgerId: null,
    writeOffCreatedAt: null,
    writeOffReversed: false,
  }],
}

type ApprovalNote =
  | (Omit<typeof deliveryNote, 'status'> & {
      status: string
      submissionLink?: string
      tokenExpiresAt?: string
    })
  | (Omit<typeof retentionNote, 'status'> & {
      status: string
      submissionLink?: string
      tokenExpiresAt?: string
    })

type ApprovalMockOptions = {
  pauseCount?: boolean
  failApprovalOnceFor?: string
}

async function mockApprovals(
  page: Page,
  initialNotes: ApprovalNote[],
  { pauseCount = false, failApprovalOnceFor }: ApprovalMockOptions = {},
) {
  const notes = new Map(initialNotes.map((note) => [note.id, structuredClone(note)]))
  const calls: Array<{ action: string; noteId: string; body?: unknown }> = []
  let approvalFailureUsed = false
  let releaseCount = () => {}
  const countGate = new Promise<void>((resolve) => {
    releaseCount = resolve
  })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/me') {
      await route.fulfill({ status: 200, json: { data: storeAdmin } })
      return
    }

    const activeNotes = [...notes.values()].filter((note) =>
      ['pending_approval', 'rejected', 'reopened'].includes(note.status))
    if (url.pathname === '/api/approvals/metrics') {
      await route.fulfill({
        status: 200,
        json: {
          data: {
            pendingApproval: activeNotes.filter((note) => note.status === 'pending_approval').length,
            approvedToday: [...notes.values()].filter((note) => note.status === 'approved').length,
            mismatchesFlagged: activeNotes.filter((note) => note.status === 'pending_approval').length,
          },
        },
      })
      return
    }
    if (url.pathname === '/api/approvals') {
      await route.fulfill({
        status: 200,
        json: {
          data: activeNotes.map((note) => ({
            id: note.id,
            noteType: note.noteType,
            dnNumber: note.noteType === 'delivery_note' ? note.dnNumber : undefined,
            rnNumber: note.noteType === 'retention_note' ? note.rnNumber : undefined,
            orderId: note.orderId,
            orderNumber: note.orderNumber,
            customerName: note.customerName,
            status: note.status,
            submittedAt: note.submittedAt,
            createdAt: note.createdAt,
          })),
        },
      })
      return
    }

    const match = url.pathname.match(/^\/api\/approvals\/([^/]+)(?:\/(count|approve|reject|reopen))?$/)
    if (match) {
      const [, noteId, action] = match
      const note = notes.get(noteId!)
      if (!note) {
        await route.fulfill({ status: 404, json: { error: { message: 'Approval note not found' } } })
        return
      }
      if (!action && request.method() === 'GET') {
        await route.fulfill({ status: 200, json: { data: note } })
        return
      }

      const body = request.postDataJSON()
      calls.push({ action: action!, noteId: note.id, body })
      if (action === 'count') {
        if (pauseCount) await countGate
        if (note.noteType === 'delivery_note') {
          const input = body as { lines: Array<{ lineId: string; countedQty: number }> }
          note.lines[0]!.countedQty = input.lines[0]!.countedQty
          note.lines[0]!.countDifference = input.lines[0]!.countedQty - note.lines[0]!.handedOverQty
        } else {
          const input = body as { lines: Array<{ lineId: string; countedReturnedQty: number }> }
          note.lines[0]!.countedReturnedQty = input.lines[0]!.countedReturnedQty
          note.lines[0]!.countDifference = input.lines[0]!.countedReturnedQty - note.lines[0]!.returnedQty
        }
      } else if (action === 'approve') {
        if (note.id === failApprovalOnceFor && !approvalFailureUsed) {
          approvalFailureUsed = true
          await route.fulfill({
            status: 409,
            json: { error: { message: 'Stock posting conflict. Reload and retry.' } },
          })
          return
        }
        note.status = 'approved'
      } else if (action === 'reject') {
        note.status = 'rejected'
      } else if (action === 'reopen') {
        note.status = 'reopened'
        Object.assign(note, {
          submissionLink: `http://localhost:3000/notes/reopened-${note.id}`,
          tokenExpiresAt: '2026-09-12T00:00:00.000Z',
        })
      }
      await route.fulfill({ status: 200, json: { data: note } })
      return
    }

    await route.fulfill({
      status: 404,
      json: { error: { message: `Unhandled test route ${url.pathname}` } },
    })
  })

  return { calls, notes, releaseCount }
}

test('Approval detail saves a physical count before enabling stock approval', async ({ page }) => {
  const { calls, releaseCount } = await mockApprovals(page, [deliveryNote], { pauseCount: true })

  await page.goto(`/approvals/${deliveryNote.id}`)
  await expect(page.getByRole('heading', { level: 1, name: deliveryNote.dnNumber })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Store Admin Approvals' })).toHaveCount(0)

  const approve = page.getByRole('button', { name: 'Approve and post stock' })
  const count = page.getByLabel('Scaffold frame physical count')
  await expect(approve).toBeDisabled()
  await count.fill('7')
  await page.getByRole('button', { name: 'Save physical count' }).click()
  await expect(count).toBeDisabled()
  releaseCount()
  await expect(page.getByRole('button', { name: 'Update physical count' })).toBeVisible()
  await expect(approve).toBeEnabled()

  await approve.click()
  await expect(page.getByRole('alertdialog')).toContainText('post its stock movements')
  await acceptAppConfirm(page, 'Approve')

  await expect(page.getByText('approved', { exact: true })).toBeVisible()
  await expect(approve).toHaveCount(0)
  expect(calls.map((call) => call.action)).toEqual(['count', 'approve'])
  expect(calls[0]!.body).toEqual({
    lines: [{ lineId: deliveryNote.lines[0]!.id, countedQty: 7 }],
  })
})

test('Approval queue approves Delivery and Retention Notes and refreshes its metrics', async ({ page }) => {
  const { calls } = await mockApprovals(page, [deliveryNote, retentionNote])

  await page.goto('/approvals')
  await expect(page.getByText('2', { exact: true }).first()).toBeVisible()

  const deliveryForm = page.getByRole('form', { name: `Approval for ${deliveryNote.dnNumber}` })
  await deliveryForm.getByLabel('Scaffold frame admin physical count').fill('8')
  await deliveryForm.getByRole('button', { name: 'Approve & post stock' }).click()
  await acceptAppConfirm(page, 'Approve')
  await expect(deliveryForm).toHaveCount(0)

  const retentionForm = page.getByRole('form', { name: `Approval for ${retentionNote.rnNumber}` })
  await retentionForm.getByLabel('Scaffold frame admin physical count').fill('6')
  await retentionForm.getByRole('button', { name: 'Approve & post stock' }).click()
  await acceptAppConfirm(page, 'Approve')
  await expect(retentionForm).toHaveCount(0)
  await expect(page.getByText('No notes await action.')).toBeVisible()

  expect(calls.map((call) => `${call.noteId}:${call.action}`)).toEqual([
    `${deliveryNote.id}:count`,
    `${deliveryNote.id}:approve`,
    `${retentionNote.id}:count`,
    `${retentionNote.id}:approve`,
  ])
})

test('Approval queue keeps a note pending and supports retry when stock posting fails', async ({ page }) => {
  const { calls } = await mockApprovals(page, [deliveryNote], {
    failApprovalOnceFor: deliveryNote.id,
  })

  await page.goto('/approvals')
  const approvalForm = page.getByRole('form', { name: `Approval for ${deliveryNote.dnNumber}` })
  const approve = approvalForm.getByRole('button', { name: 'Approve & post stock' })
  await approve.click()
  await acceptAppConfirm(page, 'Approve')

  await expect(approvalForm.getByRole('alert')).toContainText('Stock posting conflict')
  await expect(approvalForm).toBeVisible()
  await expect(approve).toBeEnabled()

  await approve.click()
  await acceptAppConfirm(page, 'Approve')
  await expect(approvalForm).toHaveCount(0)
  expect(calls.map((call) => call.action)).toEqual(['count', 'approve', 'count', 'approve'])
})

for (const note of [deliveryNote, retentionNote]) {
  const typeLabel = note.noteType === 'delivery_note' ? 'Delivery Note' : 'Retention Note'
  const messageType = note.noteType === 'delivery_note' ? 'Delivery' : 'Retention'
  const noteNumber = note.noteType === 'delivery_note' ? note.dnNumber : note.rnNumber

  test(`Reopening a rejected ${typeLabel} keeps Copy and WhatsApp Web sharing`, async ({ context, page }) => {
    const rejected: ApprovalNote = structuredClone(note)
    rejected.status = 'rejected'
    await mockApprovals(page, [rejected])
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:3000',
    })
    await context.route('https://web.whatsapp.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>WhatsApp Web test destination</title>',
      })
    })

    await page.goto('/approvals')
    await page.getByRole('button', { name: 'Reopen & create link' }).click()
    await acceptAppConfirm(page, 'Reopen')

    const submissionLink = `http://localhost:3000/notes/reopened-${note.id}`
    await expect(page.getByLabel(`${typeLabel} submission link created URL`)).toHaveValue(submissionLink)

    await page.getByRole('button', { name: 'Copy link' }).click()
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(submissionLink)

    const whatsapp = page.getByRole('link', {
      name: `Share ${typeLabel.toLowerCase()} submission link created via WhatsApp`,
    })
    await expect(whatsapp).toHaveAttribute('target', '_blank')
    await expect(whatsapp).toHaveAttribute('rel', 'noopener noreferrer')

    const whatsappUrl = new URL(await whatsapp.getAttribute('href') ?? '')
    expect(whatsappUrl.origin).toBe('https://web.whatsapp.com')
    expect(whatsappUrl.pathname).toBe('/send')
    expect(whatsappUrl.searchParams.get('text')).toBe(
      `${messageType} note ${noteNumber} for ${note.customerName} (${note.orderNumber}): ${submissionLink}`,
    )

    const popupPromise = page.waitForEvent('popup')
    await whatsapp.click()
    const whatsappPage = await popupPromise
    await expect(whatsappPage).toHaveURL(whatsappUrl.toString())
    await whatsappPage.close()
  })
}
