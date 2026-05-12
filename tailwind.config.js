/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#ffffff',
          soft: '#f5f7f9',
          card: '#ffffff'
        },
        accent: {
          DEFAULT: '#0097d8',
          glow: '#3ab3d7',
          warm: '#f0ad4e'
        },
        ink: {
          DEFAULT: '#283947',
          mute: '#54708b',
          dim: '#9aa9ba'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        glow: '0 10px 40px -10px rgba(0, 151, 216, 0.35)',
        card: '0 1px 2px rgba(40,57,71,0.04), 0 8px 24px rgba(40,57,71,0.06)'
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.6)', opacity: '0' }
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.06)' }
        },
        wave: {
          '0%, 100%': { transform: 'scaleY(0.4)' },
          '50%': { transform: 'scaleY(1)' }
        }
      },
      animation: {
        pulseRing: 'pulseRing 1.6s ease-out infinite',
        breathe: 'breathe 3s ease-in-out infinite',
        wave: 'wave 0.9s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
