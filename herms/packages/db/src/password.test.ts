import { expect, test } from 'bun:test'

import { verifyPassword } from './password'

test('verifies Bun argon2id hashes used for seeded users', async () => {
  const hash = await Bun.password.hash('test-password-123', {
    algorithm: 'argon2id',
    memoryCost: 65_536,
    timeCost: 3,
  })

  expect(await verifyPassword('test-password-123', hash)).toBe(true)
  expect(await verifyPassword('wrong-password', hash)).toBe(false)
})
