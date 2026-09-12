import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 *
 * The shadcn/ui convention, so any component copied from a registry such as
 * 21st.dev composes with these primitives unchanged.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Format a 0-100 score for display. */
export const formatScore = (value) =>
  value === null || value === undefined ? '—' : Math.round(value).toString();

/** Human wording for a risk band. Never "you have X". */
export const BAND_LABEL = { low: 'Low', moderate: 'Moderate', high: 'Elevated' };

/** Display names. The API uses clinical terms; the UI says them plainly. */
export const CONDITION_LABEL = {
  fatty_liver: 'Fatty liver',
  dysglycaemia: 'Blood sugar',
  diabetes: 'Type-2 diabetes',
  hypertension: 'Blood pressure',
};

export const CONDITION_ORDER = ['fatty_liver', 'hypertension', 'dysglycaemia', 'diabetes'];
