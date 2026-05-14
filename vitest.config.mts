import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      'db/node_provider_plugins/covalt-n8n-nodes/tests/**',
    ],
  },
})
