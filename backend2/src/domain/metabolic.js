/**
 * Metabolic formulas: the single JavaScript-side source of truth.
 *
 * The clinical formulas live here once, and every caller reads them from here.
 * These are published equations with fixed coefficients: a second copy is a
 * second place for one of them to be mistyped, and the error would be invisible
 * because the output would still look like a plausible number. Thresholds cite
 * their clinical source.
 */

// ACC/AHA 2017 and ADA thresholds. Mirrors ml/src/domain/models.py.
export const THRESHOLDS = Object.freeze({
  FLI_STEATOSIS: 60,
  HBA1C_PREDIABETES: 5.7,
  HBA1C_DIABETES: 6.5,
  SYSTOLIC_HYPERTENSION: 130,
  DIASTOLIC_HYPERTENSION: 80,
});

const ACTIVITY_FACTOR_LIGHT = 1.375;

export function bodyMassIndex(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  return weightKg / ((heightCm / 100) ** 2);
}

/** Mifflin-St Jeor basal metabolic rate, kcal/day. */
export function basalMetabolicRate({ weightKg, heightCm, age, sex }) {
  if (!weightKg || !heightCm || !age || !sex) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return base + (String(sex).toUpperCase().startsWith('M') ? 5 : -161);
}

export function totalEnergyExpenditure(profile) {
  const bmr = basalMetabolicRate(profile);
  return bmr === null ? null : bmr * ACTIVITY_FACTOR_LIGHT;
}

/**
 * Bedogni 2006 Fatty Liver Index, 0-100. Returns null when the inputs are
 * insufficient, because a placeholder mid-range value is indistinguishable from
 * a genuine moderate result once it reaches the screen.
 */
export function fattyLiverIndex({ triglycerides, bmi, ggt, waistCm }) {
  if (!(triglycerides > 0 && ggt > 0 && bmi > 0 && waistCm > 0)) return null;
  const z = 0.953 * Math.log(triglycerides)
    + 0.139 * bmi
    + 0.718 * Math.log(ggt)
    + 0.053 * waistCm
    - 15.745;
  return (Math.exp(z) / (1 + Math.exp(z))) * 100;
}

export function riskBand(score) {
  if (score === null || score === undefined) return null;
  if (score >= 60) return 'high';
  if (score >= 30) return 'moderate';
  return 'low';
}
