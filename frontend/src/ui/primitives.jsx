/**
 * UI primitives.
 *
 * Written in shadcn/ui style — `cn()` composition, variant maps, CSS-variable
 * theming, `forwardRef` on anything focusable — so a component copied from a
 * registry such as 21st.dev sits alongside these without adaptation.
 *
 * Deliberately small. A screening app needs a button, a card, a field and a
 * status pill; a full component library here would be scaffolding nobody reads.
 */
import { forwardRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';

import { cn } from '../lib/utils.js';

/* ---------------------------------------------------------------- Button -- */

const BUTTON_VARIANTS = {
  // One accent colour in the whole app, and it means "this is the action".
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface text-primary border border-line-strong hover:bg-surface-sunken',
  ghost: 'text-secondary hover:bg-surface-sunken hover:text-primary',
  danger: 'bg-white text-status-critical border border-line-strong hover:bg-status-critical-soft',
};

const BUTTON_SIZES = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-[0.9375rem] gap-2',
  lg: 'h-12 px-7 text-base gap-2',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium',
        'transition-colors duration-150 select-none',
        'disabled:opacity-50 disabled:pointer-events-none',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ Card -- */

export function Card({ className, as: Tag = 'div', ...props }) {
  return (
    <Tag
      className={cn(
        'bg-surface border border-line rounded-lg shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('px-6 pt-6 pb-4', className)} {...props} />;
}

export function CardTitle({ className, as: Tag = 'h2', ...props }) {
  return <Tag className={cn('text-base font-semibold text-primary', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-secondary mt-1', className)} {...props} />;
}

export function CardBody({ className, ...props }) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}

/* ----------------------------------------------------------- Risk band ---- */

/**
 * Status colour NEVER travels alone.
 *
 * Every band pairs its colour with an icon and the word, because the status
 * ramp's warning step sits below 3:1 against a white surface — and because a
 * colourblind reader must get the same information as everyone else.
 */
const BAND_STYLE = {
  low: {
    label: 'Low',
    icon: CheckCircle2,
    pill: 'bg-status-good-soft text-status-good',
    dot: 'var(--status-good)',
  },
  moderate: {
    label: 'Moderate',
    icon: Info,
    pill: 'bg-status-warning-soft text-[#8a6100]',
    dot: 'var(--status-warning)',
  },
  high: {
    label: 'Elevated',
    icon: AlertTriangle,
    pill: 'bg-status-critical-soft text-status-critical',
    dot: 'var(--status-critical)',
  },
};

export function BandPill({ band, className }) {
  const style = BAND_STYLE[band] ?? BAND_STYLE.moderate;
  const Icon = style.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
        'text-xs font-medium',
        style.pill,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {style.label}
    </span>
  );
}

export const bandColor = (band) => (BAND_STYLE[band] ?? BAND_STYLE.moderate).dot;

/* ------------------------------------------------------------ Provenance -- */

/**
 * Where a number came from.
 *
 * Surfaced in the UI because the API makes it a required field: a score that
 * cannot say its own origin is the defect this whole project exists to remove.
 */
const PROVENANCE_COPY = {
  model: { label: 'Model estimate', tone: 'text-secondary' },
  heuristic: { label: 'From your measurements', tone: 'text-status-good' },
  simulation: { label: 'Simulation-trained', tone: 'text-[#8a6100]' },
  unavailable: { label: 'Unavailable', tone: 'text-status-critical' },
};

export function ProvenanceTag({ provenance, className }) {
  const copy = PROVENANCE_COPY[provenance] ?? PROVENANCE_COPY.model;
  return (
    <span className={cn('text-xs', copy.tone, className)}>{copy.label}</span>
  );
}

/* ----------------------------------------------------------------- Field -- */

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full h-11 px-3.5 rounded bg-surface text-primary',
        'border border-line-strong placeholder:text-muted',
        'transition-shadow duration-150',
        'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20',
        invalid && 'border-status-critical focus:border-status-critical',
        className,
      )}
      {...props}
    />
  );
});

export function Field({ label, hint, error, htmlFor, children, className }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-primary">
          {label}
        </label>
      )}
      {children}
      {/* Hint and error occupy the same slot so the form does not jump. */}
      {error ? (
        <p className="text-xs text-status-critical" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Select({ className, children, ...props }) {
  return (
    <select
      className={cn(
        'w-full h-11 px-3 rounded bg-surface text-primary',
        'border border-line-strong appearance-none',
        'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/* ----------------------------------------------------------------- Alert -- */

const ALERT_TONE = {
  info: 'bg-accent-soft border-accent/20 text-primary',
  warning: 'bg-status-warning-soft border-[#f0d79a] text-primary',
  error: 'bg-status-critical-soft border-[#f3c0bb] text-primary',
};

export function Alert({ tone = 'info', title, children, className }) {
  const Icon = tone === 'error' ? AlertTriangle : tone === 'warning' ? AlertTriangle : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded border p-4 text-sm', ALERT_TONE[tone], className)}
    >
      <Icon className="size-4 shrink-0 mt-0.5 text-secondary" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-secondary', title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Feedback -- */

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span role="status" aria-label={label}>
      <Loader2 className={cn('size-5 animate-spin text-muted', className)} aria-hidden />
    </span>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded bg-surface-sunken', className)} aria-hidden />;
}

/** Shown when a list is genuinely empty, rather than faking content. */
export function EmptyState({ icon: Icon, title, children, action, className }) {
  return (
    <div className={cn('text-center py-12 px-6', className)}>
      {Icon && (
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-surface-sunken">
          <Icon className="size-5 text-muted" aria-hidden />
        </div>
      )}
      <p className="font-medium text-primary">{title}</p>
      {children && <p className="mt-1.5 text-sm text-secondary max-w-sm mx-auto">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ Disclaimer -- */

/**
 * The standing medical disclaimer.
 *
 * Present on every screen that shows a risk number. The API returns this text
 * on every assessment; repeating it in the UI is not redundancy, it is the
 * difference between a screening tool and an implied diagnosis.
 */
export function Disclaimer({ className, children }) {
  return (
    <p className={cn('text-xs leading-relaxed text-muted', className)}>
      {children
        ?? 'A screening estimate, not a diagnosis. Niyantrana is not a medical device. Confirm any concern with clinical testing.'}
    </p>
  );
}
