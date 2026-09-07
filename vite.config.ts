import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { devCoachProxyPlugin } from './dev/coachProxyMiddleware'
import { resolveReleaseId } from './scripts/generate-release-manifest.mjs'
import { isSourcemapArchiveEnabled } from './scripts/archive-sourcemaps.mjs'

function isAppModule(id: string, path: string): boolean {
  return id.includes(path)
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), devCoachProxyPlugin(env)],
    // Identificador del build para la telemetría de errores de cliente. Sin
    // esto el campo `release` sería constante y se perdería lo único que
    // importa en una beta: distinguir «esto lo rompió el deploy de ayer».
    //
    // Usa **la misma función** que `scripts/generate-release-manifest.mjs` y
    // `scripts/archive-sourcemaps.mjs`. Con dos implementaciones divergía en
    // dos formas silenciosas: un `APP_RELEASE` con espacios se horneaba en el
    // cliente y el servidor lo rechazaba con 400 en cada evento, y un
    // `COMMIT_REF` leído sólo por `loadEnv` bakeaba un release que el script
    // nunca escribía al catálogo, dejando `stack_frames` permanentemente null.
    define: {
      __APP_RELEASE__: JSON.stringify(resolveReleaseId(process.env)),
    },
    test: {
      setupFiles: ['./vitest.setup.ts'],
      // La suite completa transforma varios grafos pesados (sync/plan builder)
      // en paralelo. El default de 5s puede expirar durante el import inicial
      // aunque la misma prueba termine en milisegundos de forma aislada.
      testTimeout: 10_000,
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
      // Sólo cuando hay dónde archivarlos. `build-archive/` vive en el
      // contenedor efímero de Netlify: generarlos sin un paso de subida los
      // destruye con el contenedor y deja la simbolización rota, no pendiente.
      // `hidden` quita el comentario `sourceMappingURL`, pero eso no los hace
      // privados — de eso se encarga `scripts/archive-sourcemaps.mjs`.
      sourcemap: isSourcemapArchiveEnabled(process.env) ? 'hidden' : false,
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
