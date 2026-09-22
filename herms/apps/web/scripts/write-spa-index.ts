import { copyFileSync, existsSync } from 'node:fs'

const shell = 'dist/client/_shell.html'
const index = 'dist/client/index.html'

if (!existsSync(shell)) {
  throw new Error(`SPA shell missing at ${shell}`)
}

copyFileSync(shell, index)
