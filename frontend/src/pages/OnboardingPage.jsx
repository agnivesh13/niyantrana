/**
 * Onboarding: the profile, then fourteen days of wearable history.
 *
 * Both steps are required for a reason the UI states plainly rather than
 * discovering at the end: the server refuses an assessment without a complete
 * profile and without 14 days of wearable data. The previous version generated
 * `5000 + i * 100` steps when history was missing and produced a confident
 * score from data that did not exist, so there was nothing to onboard into.
 *
 * The demo history exists because every consumer wearable API a solo developer
 * could register for has closed. A file export is the durable path, and a
 * seeded history means a reviewer with no device still sees a working app --
 * with every seeded row tagged `source: demo` in the database.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Upload } from 'lucide-react';

import apiService from '../services/apiService.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  Alert, Button, Card, CardBody, CardDescription, CardHeader,
  Disclaimer, Field, Input, Select,
} from '../ui/primitives.jsx';
import Wordmark from '../components/Wordmark.jsx';

const DEMO_DAYS = 90;

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

function StepHeader({ step, current, title }) {
  const done = current > step;
  return (
    <div className="flex items-center gap-3">
      <span
        className={
          done
            ? 'grid size-7 shrink-0 place-items-center rounded-full bg-status-good text-white'
            : current === step
              ? 'grid size-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-medium text-white'
              : 'grid size-7 shrink-0 place-items-center rounded-full bg-surface-sunken text-sm font-medium text-muted'
        }
      >
        {done ? <Check className="size-4" aria-hidden /> : step}
      </span>
      <h2 className={current === step ? 'font-medium text-primary' : 'font-medium text-muted'}>
        {title}
      </h2>
    </div>
  );
}

function ProfileStep({ onDone }) {
  const { saveProfile } = useAuth();
  const [values, setValues] = useState({
    age: '', height: '', weight: '', waist: '',
    gender: 'M', has_hereditary_risk: 'false', alcohol_drinks_week: '0', smoking_status: '0',
  });
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
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {PROFILE_FIELDS.map((field) => (
          <Field key={field.name} label={`${field.label} (${field.unit})`} htmlFor={field.name} hint={field.hint}>
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

        <Field
          label="Family history of diabetes or liver disease"
          htmlFor="has_hereditary_risk"
        >
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

      <Button type="submit" loading={busy}>Save and continue</Button>
    </form>
  );
}

function WearableStep({ onDone }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const loadDemo = async () => {
    setError(null);
    setBusy('demo');
    try {
      const response = await apiService.wearable.loadDemo(DEMO_DAYS);
      setResult(`Seeded ${response.days ?? DEMO_DAYS} days of demo history.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setBusy('import');
    try {
      const text = await file.text();
      const response = await apiService.wearable.import(text, 'import');
      setResult(
        `Imported ${response.imported} days`
        + (response.skipped ? `, skipped ${response.skipped} unusable rows` : '')
        + `. Range ${response.range?.from} to ${response.range?.to}.`,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(null);
      event.target.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-secondary">
        An assessment scores a 14-day window, and a trend needs at least 28 days. Import an
        export from your device, or load a demo history to see the app working now.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded border border-line p-4">
          <h3 className="text-sm font-medium text-primary">Import a device export</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-secondary">
            CSV or JSON from Fitbit, Apple Health, Oura, Withings or Google Takeout. Column
            names are matched against a wide alias list, so most exports need no editing.
          </p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3.5 py-2 text-sm text-primary hover:bg-surface-sunken">
            <Upload className="size-4" aria-hidden />
            {busy === 'import' ? 'Importing...' : 'Choose a file'}
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              onChange={importFile}
              disabled={busy !== null}
            />
          </label>
        </div>

        <div className="rounded border border-line p-4">
          <h3 className="text-sm font-medium text-primary">Load a demo history</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-secondary">
            {DEMO_DAYS} days of deterministic, internally correlated data on an improving
            trend. Every row is stored tagged as demo, so it is never mistaken for a real
            device reading.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            loading={busy === 'demo'}
            onClick={loadDemo}
          >
            Load {DEMO_DAYS} days
          </Button>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {result && <Alert tone="info">{result}</Alert>}

      <Button onClick={onDone} disabled={!result}>Go to my dashboard</Button>
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-ground">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center px-4 sm:px-6">
          <Wordmark to={null} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold text-primary">Set up your profile</h1>
        <p className="mt-2 text-secondary">
          Two steps. Both are needed before the model will score anything — it refuses
          rather than filling in what it does not know.
        </p>

        <div className="mt-8 space-y-4">
          <Card>
            <CardHeader>
              <StepHeader step={1} current={step} title="About you" />
              {step === 1 && (
                <CardDescription>
                  Height and waist are measured, not estimated, so the fatty-liver formula
                  has real inputs.
                </CardDescription>
              )}
            </CardHeader>
            {step === 1 && (
              <CardBody>
                <ProfileStep onDone={() => setStep(2)} />
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader>
              <StepHeader step={2} current={step} title="Wearable history" />
            </CardHeader>
            {step === 2 && (
              <CardBody>
                <WearableStep onDone={() => navigate('/dashboard', { replace: true })} />
              </CardBody>
            )}
          </Card>
        </div>

        <Disclaimer className="mt-8" />
      </main>
    </div>
  );
}
