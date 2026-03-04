import { configDefaults, defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    exclude: [
      ...configDefaults.exclude,
      'db/node_provider_plugins/covalt-n8n-nodes/tests/**',
    ],
  },
})
