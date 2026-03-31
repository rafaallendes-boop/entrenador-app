import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react'
          }
          if (id.includes('node_modules/react-router-dom/')) {
            return 'router'
          }
          if (id.includes('node_modules/dexie/')) {
            return 'db'
          }
          if (id.includes('node_modules/date-fns/')) {
            return 'date'
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons'
          }
          return undefined
        },
      },
    },
  },
})
