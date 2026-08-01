import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['test/unit/**/*.spec.ts'],
    exclude: ['test/e2e/**'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
  },
})
