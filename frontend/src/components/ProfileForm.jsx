/**
 * The profile form, shared by onboarding and the profile page.
 *
 * Extracted rather than duplicated because these eight fields are the model's
 * inputs: the ranges here mirror the server-side schema, and two copies would
 * drift apart silently — one of them accepting a value the API rejects, or
 * worse, rejecting one it accepts.
 *
 * Always prefilled from what is stored. That is what makes a profile you did
 * not set — the demo persona, say — visible the moment you open the form
 * instead of after you have wondered why your scores look like someone else's.
 */
import { useState } from 'react';

import { useAuth } from '../contexts/AuthContext.jsx';
import { Alert, Button, Field, Input, Select } from '../ui/primitives.jsx';

// Mirrors the server-side schema ranges, so a value this form accepts is a
// value the server accepts. Duplicated deliberately: client-side limits are a
// convenience, and the server validates independently.
const PROFILE_FIELDS = [
  { name: 'age', label: 'Age', unit: 'years', min: 18, max: 120 },
  { name: 'height', label: 'Height', unit: 'cm', min: 50, max: 260 },
  { name: 'weight', label: 'Weight', unit: 'kg', min: 20, max: 400 },
  {
    name: 'waist',
    label: 'Waist',
    unit: 'cm',
    min: 30,
    max: 250,
    hint: 'Measured at the navel. Waist drives the fatty-liver estimate more than weight does.',
  },
];

export default function ProfileForm({ initial, onSaved, submitLabel = 'Save' }) {
  const { saveProfile } = useAuth();
  const [values, setValues] = useState(() => ({
    age: initial?.age ?? '',
    height: initial?.height ?? '',
    weight: initial?.weight ?? '',
    waist: initial?.waist ?? '',
    gender: initial?.gender ?? 'M',
    has_hereditary_risk: String(Boolean(initial?.has_hereditary_risk)),
    alcohol_drinks_week: initial?.alcohol_drinks_week ?? '0',
    smoking_status: String(initial?.smoking_status ?? '0'),
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (name) => (event) => setValues((v) => ({ ...v, [name]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await saveProfile({
      age: Number(values.age),
      height: Number(values.height),
      weight: Number(values.weight),
      waist: Number(values.waist),
      gender: values.gender,
      has_hereditary_risk: values.has_hereditary_risk === 'true',
      alcohol_drinks_week: Number(values.alcohol_drinks_week),
      smoking_status: Number(values.smoking_status),
    });
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    onSaved?.(result.staticData);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {PROFILE_FIELDS.map((field) => (
          <Field
            key={field.name}
            label={`${field.label} (${field.unit})`}
            htmlFor={field.name}
            hint={field.hint}
          >
            <Input
              id={field.name}
              type="number"
              inputMode="numeric"
              required
              min={field.min}
              max={field.max}
              step="any"
              value={values[field.name]}
              onChange={set(field.name)}
            />
          </Field>
        ))}

        <Field label="Sex" htmlFor="gender" hint="Used by the model, which was fitted with it.">
          <Select id="gender" value={values.gender} onChange={set('gender')}>
            <option value="M">Male</option>
            <option value="F">Female</option>
          </Select>
        </Field>

        <Field label="Family history of diabetes or liver disease" htmlFor="has_hereditary_risk">
          <Select
            id="has_hereditary_risk"
            value={values.has_hereditary_risk}
            onChange={set('has_hereditary_risk')}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </Select>
        </Field>

        <Field
          label="Alcohol"
          htmlFor="alcohol_drinks_week"
          hint="Drinks per week. A major driver of liver enzymes."
        >
          <Input
            id="alcohol_drinks_week"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={values.alcohol_drinks_week}
            onChange={set('alcohol_drinks_week')}
          />
        </Field>

        <Field label="Smoking" htmlFor="smoking_status">
          <Select id="smoking_status" value={values.smoking_status} onChange={set('smoking_status')}>
            <option value="0">Never</option>
            <option value="1">Former</option>
            <option value="2">Current</option>
          </Select>
        </Field>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  );
}
