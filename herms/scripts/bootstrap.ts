import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const envFile = Bun.file(new URL('../.env', import.meta.url))
const envExampleFile = Bun.file(new URL('../.env.example', import.meta.url))
const withDatabase = process.argv.includes('--with-db')
const bunExecutable = process.execPath

function randomSecret(bytes: number) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')
}

async function run(command: string[]) {
  console.log(`\n> ${command.join(' ')}`)
  const process = Bun.spawn(command, {
    cwd: projectRoot,
    env: Bun.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await process.exited
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited with code ${exitCode}`)
  }
}

function readEnvValue(content: string, name: string) {
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim()
}

await run([bunExecutable, 'install', '--frozen-lockfile'])

if (await envFile.exists()) {
  console.log('\nPreserved the existing .env file.')
} else {
  let content = await envExampleFile.text()
  content = content
    .replace('generate-a-random-secret-with-at-least-32-characters', randomSecret(48))
    .replace('generate-a-separate-random-secret-with-at-least-32-characters', randomSecret(48))
    .replace('set-a-unique-local-password-with-at-least-12-characters', randomSecret(24))
  await Bun.write(envFile, content)
  console.log('\nCreated .env with generated local secrets. No secret values were printed.')
}

if (withDatabase) {
  const content = await envFile.text()
  const databaseUrl = readEnvValue(content, 'DATABASE_URL')
  const migrationDatabaseUrl = readEnvValue(content, 'MIGRATION_DATABASE_URL')
  const databaseIsConfigured =
    databaseUrl &&
    migrationDatabaseUrl &&
    !databaseUrl.includes('.example') &&
    !migrationDatabaseUrl.includes('.example')

  if (!databaseIsConfigured) {
    throw new Error(
      'Set DATABASE_URL and MIGRATION_DATABASE_URL in .env before using --with-db.',
    )
  }

  await run([bunExecutable, 'run', 'db:check'])
  await run([bunExecutable, 'run', 'db:migrate'])
  await run([bunExecutable, 'run', 'db:seed'])
}

console.log('\nBootstrap complete.')
if (!withDatabase) {
  console.log('Set DATABASE_URL and MIGRATION_DATABASE_URL in .env if they are not configured yet.')
  console.log('Then run `bun run bootstrap --with-db` once to migrate and seed the database.')
}
console.log('Start the frontend and backend with `bun run dev`.')
