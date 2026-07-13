import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { devCoachProxyPlugin } from './dev/coachProxyMiddleware'

function isAppModule(id: string, path: string): boolean {
  return id.includes(path)
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), devCoachProxyPlugin(env)],
    test: {
      setupFiles: ['./vitest.setup.ts'],
      // Vitest's default include glob has no notion of git worktrees living
      // inside the repo tree (e.g. Claude Code's native worktree tool places
      // them under .claude/worktrees/); without this, running tests from a
      // checkout that happens to have one nested inside doubles every test
      // file and can produce spurious cross-copy module-resolution failures.
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '.git/**',
        '.claude/worktrees/**',
        '.worktrees/**',
        'worktrees/**',
      ],
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
    resolve: {
      dedupe: ['react', 'react-dom', 'react-router-dom'],
    },
    optimizeDeps: {
      entries: [
        'index.html',
        'src/**/*.{ts,tsx}',
        '!src/**/*.test.{ts,tsx}',
        '!src/**/__tests__/**',
      ],
      include: [
        '@supabase/supabase-js',
        'date-fns',
        'date-fns/locale',
        'dexie',
        'lucide-react',
        'pdfjs-dist',
        'pdfjs-dist/build/pdf.min.mjs',
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react-router-dom',
        'zustand',
      ],
    },
    server: {
      host: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
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
  }
})
