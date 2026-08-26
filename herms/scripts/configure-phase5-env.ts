const path = '.env'
const file = Bun.file(path)
if (!(await file.exists())) {
  throw new Error('.env is required; earlier phase configuration was not found')
}

let content = await file.text()
const defaults: Record<string, string> = {
  WHATSAPP_PROVIDER_MODE: 'mock',
  OUTBOX_BATCH_SIZE: '10',
  OUTBOX_MAX_ATTEMPTS: '5',
  OUTBOX_LEASE_SECONDS: '240',
}
const added: string[] = []
for (const [name, value] of Object.entries(defaults)) {
  if (new RegExp(`^${name}=`, 'm').test(content)) continue
  content = `${content.trimEnd()}\n${name}=${value}\n`
  added.push(name)
}
await Bun.write(path, content)
console.log(JSON.stringify({
  event: 'phase_5_environment_configured',
  providerMode: 'mock',
  added,
  cloudConfigurationDeferred: true,
  secretsPrinted: false,
}))
