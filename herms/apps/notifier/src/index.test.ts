import { expect, test } from 'bun:test'

import { handler } from './index'

test('propagates a valid request ID through the notifier seam', async () => {
  expect(await handler({ requestId: 'phase-0-notifier' })).toEqual({
    ok: true,
    requestId: 'phase-0-notifier',
  })
})
