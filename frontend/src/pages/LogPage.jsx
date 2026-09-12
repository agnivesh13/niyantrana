/**
 * Logging: meals and measured vitals.
 *
 * The meal flow deliberately does not let the browser assert nutrition
 * numbers. A search returns foods from the Anuvaad Indian food database; the
 * client sends a food code and a serving count, and the server resolves the
 * macros. The previous design posted client-computed `dietTotals`, so a browser
 * could claim any intake it liked and the model would treat it as observed.
 *
 * Vitals matter more than they look: a real lab value or cuff reading overrides
 * the model estimate for that biomarker, and flips that part of the assessment
 * from `model` provenance to `heuristic`. That is the one path in the app where
 * the user beats the model, by design.
 */
import { useCallback, useEffect, useState } from 'react';
import { Search, Utensils } from 'lucide-react';

import apiService from '../services/apiService.jsx';
import {
  Alert, Button, Card, CardBody, CardDescription, CardHeader, CardTitle,
  EmptyState, Field, Input, Select, Spinner,
} from '../ui/primitives.jsx';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 250;

/** Only the biomarkers the inference service accepts as measured. */
const VITAL_FIELDS = [
  { name: 'systolic_bp', label: 'Systolic BP', unit: 'mmHg', min: 60, max: 260 },
  { name: 'diastolic_bp', label: 'Diastolic BP', unit: 'mmHg', min: 30, max: 160 },
  { name: 'hba1c', label: 'HbA1c', unit: '%', min: 3, max: 20, step: '0.1' },
  { name: 'triglycerides', label: 'Triglycerides', unit: 'mg/dL', min: 20, max: 1500 },
  { name: 'ggt', label: 'GGT', unit: 'U/L', min: 3, max: 1000 },
  { name: 'fasting_glucose', label: 'Fasting glucose', unit: 'mg/dL', min: 30, max: 600 },
];

const round = (value) => (typeof value === 'number' ? Math.round(value) : '-');

function MacroTotals({ totals, logged }) {
  if (!logged) {
    return (
      <p className="text-sm text-secondary">
        Nothing logged today yet. An empty day is recorded as unknown, not as zero
        calories — the model is told you did not log, not that you did not eat.
      </p>
    );
  }

  const rows = [
    { label: 'Energy', value: `${round(totals.energy_kcal)} kcal` },
    { label: 'Protein', value: `${round(totals.protein_g)} g` },
    { label: 'Carbs', value: `${round(totals.carb_g)} g` },
    { label: 'Fat', value: `${round(totals.fat_g)} g` },
    { label: 'Fibre', value: `${round(totals.fibre_g)} g` },
    { label: 'Sugar', value: `${round(totals.sugar_g)} g` },
  ];

  return (
    <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="text-xs text-secondary">{row.label}</dt>
          <dd className="mt-0.5 font-semibold text-primary tabular">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MealLogger({ onLogged }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [servings, setServings] = useState('1');
  const [mealType, setMealType] = useState('lunch');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Debounced so typing a dish name is one request, not eight.
  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      setResults([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const response = await apiService.logs.searchFood(term);
        setResults(response.results ?? []);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const submit = async (event) => {
    event.preventDefault();
    if (!selected) return;

    setError(null);
    setBusy(true);
    try {
      await apiService.logs.logMeal({
        foodCode: selected.food_code,
        foodName: selected.food_name,
        servings: Number(servings),
        mealType,
      });
      setSelected(null);
      setQuery('');
      setResults([]);
      setServings('1');
      onLogged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field
        label="Find a food"
        htmlFor="food-search"
        hint="1,014 Indian foods from Anuvaad INDB 2024.11. Macros are per 100 g."
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            id="food-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Mutton biryani, paneer butter masala, idli..."
            className="pl-9"
            autoComplete="off"
          />
        </div>
      </Field>

      {searching && <div className="flex justify-center py-2"><Spinner /></div>}

      {results.length > 0 && (
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded border border-line">
          {results.map((food) => (
            <li key={food.food_code ?? food.food_name}>
              <button
                type="button"
                onClick={() => setSelected(food)}
                className={
                  selected?.food_code === food.food_code
                    ? 'flex w-full items-center justify-between gap-3 bg-accent-soft px-3 py-2.5 text-left'
                    : 'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-sunken'
                }
              >
                <span className="min-w-0 truncate text-sm text-primary">{food.food_name}</span>
                <span className="shrink-0 text-xs text-muted tabular">
                  {round(food.energy_kcal)} kcal / 100 g
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= MIN_QUERY && !searching && results.length === 0 && !error && (
        <p className="text-sm text-muted">No match in the food database.</p>
      )}

      {selected && (
        <form onSubmit={submit} className="space-y-4 rounded border border-line p-4">
          <p className="text-sm font-medium text-primary">{selected.food_name}</p>
          <p className="text-xs text-secondary tabular">
            Per 100 g: {round(selected.energy_kcal)} kcal, {round(selected.protein_g)} g
            protein, {round(selected.carb_g)} g carbs, {round(selected.fat_g)} g fat
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Servings" htmlFor="servings" hint="One serving is 100 g.">
              <Input
                id="servings"
                type="number"
                min="0.1"
                max="50"
                step="0.1"
                value={servings}
                onChange={(event) => setServings(event.target.value)}
              />
            </Field>
            <Field label="Meal" htmlFor="mealType">
              <Select
                id="mealType"
                value={mealType}
                onChange={(event) => setMealType(event.target.value)}
              >
                {MEAL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type[0].toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex gap-3">
            <Button type="submit" loading={busy}>Log it</Button>
            <Button type="button" variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function VitalsLogger() {
  const [values, setValues] = useState({});
  const [source, setSource] = useState('manual');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const filled = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== '' && value !== undefined),
    );
    if (!Object.keys(filled).length) {
      setError('Enter at least one reading.');
      return;
    }

    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      await apiService.logs.logVitals({ ...filled, source });
      setValues({});
      setSaved('Saved. Measured values override the model estimate for those biomarkers.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {VITAL_FIELDS.map((field) => (
          <Field key={field.name} label={`${field.label} (${field.unit})`} htmlFor={field.name}>
            <Input
              id={field.name}
              type="number"
              inputMode="decimal"
              min={field.min}
              max={field.max}
              step={field.step ?? '1'}
              value={values[field.name] ?? ''}
              onChange={(event) => setValues((v) => ({ ...v, [field.name]: event.target.value }))}
            />
          </Field>
        ))}
        <Field label="Source" htmlFor="source" hint="A lab result is the most trustworthy.">
          <Select id="source" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="manual">Entered by hand</option>
            <option value="device">Home device</option>
            <option value="lab">Lab report</option>
          </Select>
        </Field>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">{saved}</Alert>}

      <Button type="submit" loading={busy}>Save reading</Button>
    </form>
  );
}

export default function LogPage() {
  const [daily, setDaily] = useState(null);
  const [meals, setMeals] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [totals, recent] = await Promise.all([
        apiService.logs.dailyMacros(),
        apiService.logs.meals(10),
      ]);
      setDaily(totals);
      setMeals(recent.meals ?? []);
      setError(null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Log</h1>
        <p className="mt-1.5 text-secondary">
          Meals feed the diet features the model uses. Measured vitals outrank it entirely.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>Totals resolved server-side from what you logged.</CardDescription>
          </CardHeader>
          <CardBody>
            <MacroTotals totals={daily?.totals} logged={Boolean(daily?.logged)} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent meals</CardTitle>
          </CardHeader>
          <CardBody>
            {meals.length === 0 ? (
              <EmptyState icon={Utensils} title="No meals logged yet" className="py-6" />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {meals.map((meal) => (
                  <li key={meal._id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-primary">{meal.foodName}</span>
                      <span className="text-xs text-muted">
                        {meal.mealType} / {meal.servings} serving
                        {meal.servings === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="shrink-0 text-primary tabular">
                      {round(meal.energy_kcal)} kcal
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Log a meal</CardTitle>
          <CardDescription>
            Pick the food and the servings; the server works out the macros.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <MealLogger onLogged={load} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record a measurement</CardTitle>
          <CardDescription>
            A real blood pressure or lab value replaces the estimate for that biomarker on
            your next assessment.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <VitalsLogger />
        </CardBody>
      </Card>
    </div>
  );
}
