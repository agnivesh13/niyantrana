/**
 * Tailwind mapped onto the CSS custom properties in index.css.
 *
 * Colours are declared as `hsl(var(--token) / <alpha-value>)` so opacity
 * modifiers work and a theme change happens in one place. This is the
 * shadcn/ui convention, which means a component copied from a registry such as
 * 21st.dev picks up the theme with no edits.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'hsl(var(--ground) / <alpha-value>)',
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          sunken: 'hsl(var(--surface-sunken) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          strong: 'hsl(var(--border-strong) / <alpha-value>)',
        },
        primary: 'hsl(var(--text-primary) / <alpha-value>)',
        secondary: 'hsl(var(--text-secondary) / <alpha-value>)',
        muted: 'hsl(var(--text-muted) / <alpha-value>)',
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          hover: 'hsl(var(--accent-hover) / <alpha-value>)',
          soft: 'hsl(var(--accent-soft) / <alpha-value>)',
        },
        // Status ramp: fixed hexes, deliberately outside the series ramp.
        status: {
          good: 'var(--status-good)',
          warning: 'var(--status-warning)',
          critical: 'var(--status-critical)',
          'good-soft': 'var(--status-good-soft)',
          'warning-soft': 'var(--status-warning-soft)',
          'critical-soft': 'var(--status-critical-soft)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        // Material-style elevation: barely-there, mostly carried by the border.
        card: '0 1px 2px 0 rgb(60 64 67 / 0.06), 0 1px 3px 1px rgb(60 64 67 / 0.04)',
        raised: '0 1px 3px 0 rgb(60 64 67 / 0.10), 0 4px 8px 3px rgb(60 64 67 / 0.05)',
      },
      fontSize: {
        // A display step for hero numbers, tight so a big figure stays compact.
        display: ['3.5rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
        hero: ['2.75rem', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
      },
      maxWidth: { content: '68rem' },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: { 'fade-up': 'fade-up 0.35s ease-out both' },
    },
  },
  plugins: [],
};
