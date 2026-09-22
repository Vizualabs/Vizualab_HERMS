import { argon2Verify } from 'hash-wasm'

export async function verifyPassword(password: string, passwordHash: string) {
  try {
    return await argon2Verify({ password, hash: passwordHash })
  } catch {
    return false
  }
}
