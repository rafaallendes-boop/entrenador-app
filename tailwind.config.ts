import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0e0e0e',
          deep: '#080808',
          card: '#151515',
          raised: '#1d1d1d',
          panel: '#181818',
          glass: '#202020cc',
          border: '#303030',
          soft: '#484847',
        },
        brand: {
          DEFAULT: '#ff4d00',
          light: '#ff7a33',
          glow: '#ff4d0033',
        },
        forge: {
          lime: '#d1fc00',
          'lime-soft': '#f4ffc6',
          cyan: '#00e3fd',
          ember: '#ffeb9c',
          outline: '#484847',
        },
        ink: {
          DEFAULT: '#f5f5f7',
          muted: '#b0b0b3',
          faint: '#6e6e73',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Lexend', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '1rem',
        'card-sm': '0.75rem',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 2px 16px 0 rgba(0,0,0,0.4)',
        'card-hover': '0 4px 28px 0 rgba(0,0,0,0.55)',
        glow: '0 0 24px 2px rgba(255,77,0,0.24)',
        'glow-sm': '0 0 12px 1px rgba(255,77,0,0.16)',
        'inner-sm': 'inset 0 1px 3px rgba(0,0,0,0.3)',
        panel: '0 20px 60px -30px rgba(0,0,0,0.9)',
        hud: '0 24px 80px -36px rgba(0,0,0,0.92)',
        'lime-glow': '0 0 32px -10px rgba(209,252,0,0.35)',
      },
      screens: {
        xs: '375px',
        sm: '430px',
        md: '768px',
      },
    },
  },
  plugins: [],
}

export default config
