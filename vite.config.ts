import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

function isAppModule(id: string, path: string): boolean {
  return id.includes(path)
}

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/services/**/*.ts'],
      exclude: [
        'src/services/**/__tests__/**',
        'src/services/ai/providers/**',
      ],
    },
  },
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'react'
          }
          if (id.includes('/node_modules/react-router-dom/') || id.includes('/node_modules/react-router/')) {
            return 'router'
          }
          if (id.includes('/node_modules/zustand/')) {
            return 'state'
          }
          if (id.includes('/node_modules/@supabase/')) {
            return 'supabase'
          }
          if (id.includes('/node_modules/dexie/')) {
            return 'db'
          }
          if (id.includes('/node_modules/date-fns/')) {
            return 'date'
          }
          if (id.includes('/node_modules/pdfjs-dist/')) {
            return 'pdf'
          }
          if (id.includes('/node_modules/lucide-react/')) {
            return 'icons'
          }
          if (
            isAppModule(id, '/src/services/syncService.ts') ||
            isAppModule(id, '/src/services/syncUtils.ts') ||
            isAppModule(id, '/src/services/auth.ts')
          ) {
            return 'sync'
          }
          return undefined
        },
      },
    },
  },
})
