const path = '.env'
const defaults = {
  BUSINESS_TIMEZONE: 'Asia/Colombo',
  BUSINESS_CURRENCY: 'LKR',
  QUOTATION_EXPIRY_DAYS: '14',
  QUOTATION_NUMBER_PREFIX: 'QT',
  ORDER_NUMBER_PREFIX: 'ORD',
}

const file = Bun.file(path)
if (!(await file.exists())) throw new Error('.env is required; Phase 1 configuration was not found')
let content = await file.text()
const added: string[] = []
for (const [name, value] of Object.entries(defaults)) {
  if (new RegExp(`^${name}=`, 'm').test(content)) continue
  content = `${content.trimEnd()}\n${name}=${value}\n`
  added.push(name)
}
await Bun.write(path, content)
console.log(JSON.stringify({ event: 'phase_2_environment_configured', added, secretsPrinted: false }))
