const envFile = Bun.file(new URL('../.env', import.meta.url))
if (!(await envFile.exists())) {
  throw new Error('Create .env from .env.example before configuring Phase 1')
}

const current = await envFile.text()
const lines = current.replace(/\r\n/g, '\n').trimEnd().split('\n')
const configured = new Set(
  lines
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf('='))),
)

function randomSecret(bytes: number) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')
}

const additions: Array<[string, string]> = [
  ['AUTH_SECRET', randomSecret(48)],
  ['SESSION_TTL_SECONDS', '28800'],
  ['SESSION_COOKIE_SECURE', 'false'],
  ['SEED_USER_PASSWORD', randomSecret(24)],
  ['SEED_STORE_NAME', 'HERMS Main Store'],
  ['SEED_STORE_ADDRESS', ''],
]

const added: string[] = []
for (const [name, value] of additions) {
  if (!configured.has(name)) {
    lines.push(`${name}=${value}`)
    added.push(name)
  }
}

await Bun.write(envFile, `${lines.join('\n')}\n`)
console.log(JSON.stringify({ event: 'phase_1_env_configured', added }))
