import { Buffer } from 'node:buffer'

const path = '.env'
const file = Bun.file(path)
if (!(await file.exists())) throw new Error('.env is required; earlier phase configuration was not found')

let content = await file.text()
const defaults: Record<string, string> = {
  DELIVERY_NOTE_NUMBER_PREFIX: 'DN',
  NOTE_TOKEN_TTL_SECONDS: '259200',
  PUBLIC_APP_URL: 'http://localhost:3000',
}
const added: string[] = []
for (const [name, value] of Object.entries(defaults)) {
  if (new RegExp(`^${name}=`, 'm').test(content)) continue
  content = `${content.trimEnd()}\n${name}=${value}\n`
  added.push(name)
}
if (!/^NOTE_TOKEN_SECRET=/m.test(content)) {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  content = `${content.trimEnd()}\nNOTE_TOKEN_SECRET=${Buffer.from(bytes).toString('base64url')}\n`
  added.push('NOTE_TOKEN_SECRET')
}
await Bun.write(path, content)
console.log(JSON.stringify({ event: 'phase_3_environment_configured', added, secretsPrinted: false }))
