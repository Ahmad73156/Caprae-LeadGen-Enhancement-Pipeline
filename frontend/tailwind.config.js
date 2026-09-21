/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Inter',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        glass: {
          surface: 'rgba(255,255,255,0.05)',
          raised: 'rgba(255,255,255,0.08)',
          edge: 'rgba(255,255,255,0.10)',
          line: 'rgba(255,255,255,0.06)',
        },
        signal: {
          high: '#5eead4',
          medium: '#fcd34d',
          low: '#fb7185',
          accent: '#818cf8',
        },
      },
      backdropBlur: {
        xs: '2px',
        '2.5xl': '44px',
      },
      backdropSaturate: {
        180: '1.8',
      },
      boxShadow: {
        crystal:
          '0 1px 0 0 rgba(255,255,255,0.09) inset, 0 24px 60px -24px rgba(0,0,0,0.85)',
        'crystal-lg':
          '0 1px 0 0 rgba(255,255,255,0.12) inset, 0 40px 90px -30px rgba(0,0,0,0.9)',
        glow: '0 0 0 1px rgba(129,140,248,0.25), 0 20px 60px -20px rgba(99,102,241,0.45)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      fontSize: {
        display: ['clamp(2.1rem, 4vw, 3.25rem)', { lineHeight: '1.04', letterSpacing: '-0.035em' }],
        metric: ['clamp(1.75rem, 2.6vw, 2.35rem)', { lineHeight: '1.1', letterSpacing: '-0.03em' }],
      },
      transitionTimingFunction: {
        crystal: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        drift: {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(0,-18px,0) scale(1.06)' },
        },
        sheen: {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(220%)' },
        },
      },
      animation: {
        drift: 'drift 18s ease-in-out infinite',
        sheen: 'sheen 1.1s cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
