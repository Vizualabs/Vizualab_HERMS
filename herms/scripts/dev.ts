import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const bunExecutable = process.execPath
const taskkillExecutable = path.join(Bun.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')

type Service = {
  name: string
  command: string[]
}

const services: Service[] = [
  {
    name: 'backend',
    command: [bunExecutable, 'run', 'dev:api'],
  },
  {
    name: 'frontend',
    command: [bunExecutable, 'run', 'dev:web'],
  },
]

const children = services.map((service) => {
  console.log(`Starting ${service.name}...`)
  const child = Bun.spawn(service.command, {
    cwd: projectRoot,
    env: Bun.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return { service, child }
})

let stopping = false

function stop(exitCode: number) {
  if (stopping) return
  stopping = true

  for (const { child } of children) {
    if (process.platform === 'win32') {
      Bun.spawnSync(
        [taskkillExecutable, '/PID', String(child.pid), '/T', '/F'],
        { stdout: 'ignore', stderr: 'ignore' },
      )
    } else {
      child.kill()
    }
  }

  process.exit(exitCode)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

const exits = children.map(async ({ service, child }) => {
  const exitCode = await child.exited
  return { service, exitCode }
})

const first = await Promise.race(exits)
if (!stopping) {
  console.error(`${first.service.name} exited with code ${first.exitCode}; stopping all services.`)
  stop(first.exitCode)
}
