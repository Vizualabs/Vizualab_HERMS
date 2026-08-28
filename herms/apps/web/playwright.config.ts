import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const testEnv = loadEnv('', fileURLToPath(new URL('../..', import.meta.url)), '')
process.env.SEED_USER_PASSWORD ??= testEnv.SEED_USER_PASSWORD

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../../tmp/playwright-phase8',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    },
  },
  projects: [{
    name: 'edge',
    use: { ...devices['Desktop Edge'] },
  }],
  webServer: [
    {
      command: 'bun run --cwd ../.. dev:api',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: true,
    },
    {
      command: 'bun run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
    },
  ],
})
