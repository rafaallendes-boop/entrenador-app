import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f0f13',
          card:    '#17171e',
          raised:  '#1e1e28',
          border:  '#2a2a38',
        },
        brand: {
          DEFAULT: '#7c5cfc',
          light:   '#a88bfd',
          glow:    '#7c5cfc33',
        },
        ink: {
          DEFAULT: '#f0f0f5',
          muted:   '#8888a0',
          faint:   '#44445a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '1rem',
        pill: '9999px',
      },
      boxShadow: {
        card:     '0 2px 16px 0 rgba(0,0,0,0.4)',
        glow:     '0 0 20px 2px rgba(124,92,252,0.25)',
        'inner-sm': 'inset 0 1px 3px rgba(0,0,0,0.3)',
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
