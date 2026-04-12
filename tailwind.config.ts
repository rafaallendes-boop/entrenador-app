import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f0f13',
          deep:    '#08080b',
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
        sans:    ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card:    '1rem',
        'card-sm': '0.75rem',
        pill:    '9999px',
      },
      boxShadow: {
        card:       '0 2px 16px 0 rgba(0,0,0,0.4)',
        'card-hover': '0 4px 28px 0 rgba(0,0,0,0.55)',
        glow:       '0 0 20px 2px rgba(124,92,252,0.25)',
        'glow-sm':  '0 0 10px 1px rgba(124,92,252,0.18)',
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
