const path = '.env'
const file = Bun.file(path)
if (!(await file.exists())) {
  throw new Error('.env is required; earlier phase configuration was not found')
}

let content = await file.text()
const defaults: Record<string, string> = {
  RETENTION_NOTE_NUMBER_PREFIX: 'RN',
}
const added: string[] = []
for (const [name, value] of Object.entries(defaults)) {
  if (new RegExp(`^${name}=`, 'm').test(content)) continue
  content = `${content.trimEnd()}\n${name}=${value}\n`
  added.push(name)
}
await Bun.write(path, content)
console.log(JSON.stringify({
  event: 'phase_4_environment_configured',
  added,
  secretsPrinted: false,
}))
