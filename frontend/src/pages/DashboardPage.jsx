/**
 * The dashboard.
 *
 * Four things are true of every number on this screen, and they are the point
 * of the whole project:
 *
 * 1. It came from the API. Nothing is computed or filled in here.
 * 2. It arrives with a provenance and a basis, both displayed.
 * 3. If the model cannot be reached, this screen says so. The version this
 *    replaces rendered `Math.floor(Math.random() * 100)` as an AI risk
 *    assessment, and the API it called returned `150 + Math.random() * 50`
 *    with HTTP 200 on any failure.
 * 4. A refusal is shown as a refusal. Too little wearable history produces an
 *    actionable empty state, not a score computed from invented days.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, RefreshCw, Utensils } from 'lucide-react';

import apiService, { ApiError } from '../services/apiService.jsx';
import { CONDITION_LABEL, CONDITION_ORDER, formatScore } from '../lib/utils.js';
import {
  Alert, BandPill, Button, Card, CardBody, CardDescription, CardHeader, CardTitle,
  Disclaimer, EmptyState, ProvenanceTag, Skeleton,
} from '../ui/primitives.jsx';
import RiskCard from '../components/RiskCard.jsx';

/**
 * The chart is the only thing that needs the charting library, and it is the
 * heaviest dependency in the project. Loading it on demand keeps it out of the
 * bundle the landing and sign-in screens download.
 */
const TrajectoryChart = lazy(() => import('../components/TrajectoryChart.jsx'));

/** Biomarkers, with the units the API reports them in. */
const BIOMARKERS = [
  { key: 'fli', label: 'Fatty Liver Index', unit: '', digits: 1 },
  { key: 'triglycerides', label: 'Triglycerides', unit: 'mg/dL', digits: 0 },
  { key: 'ggt', label: 'GGT', unit: 'U/L', digits: 0 },
  { key: 'hba1c', label: 'HbA1c', unit: '%', digits: 1 },
  { key: 'systolic_bp', label: 'Systolic BP', unit: 'mmHg', digits: 0 },
  { key: 'diastolic_bp', label: 'Diastolic BP', unit: 'mmHg', digits: 0 },
];

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-56" />)}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

/**
 * The server refused, and said why in `details`.
 *
 * Rendered as a task rather than an error, because that is what it is: the user
 * needs 14 days of wearable data or a complete profile, and both are one click
 * away.
 */
function NotReadyState({ error, onRetry }) {
  const details = error.details ?? {};
  const needsProfile = Array.isArray(details.missing) && details.missing.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Not enough data yet</CardTitle>
        <CardDescription>{error.message}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {needsProfile ? (
          <>
            <p className="text-sm text-secondary">
              Missing from your profile: {details.missing.join(', ')}.
            </p>
            <Link to="/onboarding">
              <Button>Complete my profile</Button>
            </Link>
          </>
        ) : (
          <>
            {typeof details.available === 'number' && (
              <p className="text-sm text-secondary">
                {details.available} of {details.required} days recorded.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Link to="/onboarding">
                <Button>Add wearable history</Button>
              </Link>
              <Button variant="secondary" onClick={onRetry}>
                <RefreshCw className="size-4" aria-hidden />
                Try again
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The model is unreachable.
 *
 * This screen exists so that this case has somewhere honest to land. The free
 * hosting tier sleeps after fifteen minutes, so the first request after an idle
 * period can legitimately time out -- and the correct response to that is to
 * say so and offer a retry, never to substitute a number.
 */
function UnavailableState({ error, onRetry }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-status-critical" aria-hidden />
          <div>
            <CardTitle>The model is not answering</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm leading-relaxed text-secondary">
          No score is shown because none was produced. The inference service runs on a free
          tier that sleeps when idle, so a first request after a quiet spell can take up to
          a minute to wake it.
        </p>
        <Button onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden />
          Retry
        </Button>
      </CardBody>
    </Card>
  );
}

function BiomarkerPanel({ biomarkers, measuredKeys = [] }) {
  const present = BIOMARKERS.filter(({ key }) => biomarkers?.[key] !== null
    && biomarkers?.[key] !== undefined);
  if (!present.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimated biomarkers</CardTitle>
        <CardDescription>
          Model estimates unless marked measured. A real lab value always overrides an
          estimate.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          {present.map(({ key, label, unit, digits }) => (
            <div key={key}>
              <dt className="text-xs text-secondary">{label}</dt>
              <dd className="mt-0.5 flex items-baseline gap-1">
                <span className="text-lg font-semibold text-primary tabular">
                  {biomarkers[key].toFixed(digits)}
                </span>
                {unit && <span className="text-xs text-muted">{unit}</span>}
              </dd>
              {measuredKeys.includes(key) && (
                <p className="text-[11px] text-status-good">measured</p>
              )}
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

/** What the assessment was actually computed from. */
function InputsPanel({ inputs }) {
  if (!inputs) return null;
  const rows = [
    { label: 'Wearable days scored', value: inputs.wearableDays },
    { label: 'History available', value: `${inputs.historyDays} days` },
    { label: 'Meals counted', value: inputs.mealsCounted ?? 0 },
    {
      label: 'Measured biomarkers used',
      value: inputs.measuredBiomarkers?.length
        ? inputs.measuredBiomarkers.map((key) => key.replace(/_/g, ' ')).join(', ')
        : 'none',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>What this was computed from</CardTitle>
        <CardDescription>
          Macros come from your own meal logs, resolved server-side against the food
          database — never asserted by the browser.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <dl className="space-y-2.5 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-secondary">{row.label}</dt>
              <dd className="text-right font-medium text-primary tabular">{row.value}</dd>
            </div>
          ))}
        </dl>
        {!inputs.mealsCounted && (
          <Alert tone="warning" className="mt-4">
            No meals logged, so diet was left unknown rather than assumed to be zero.
            Logging a day of meals sharpens every score on this page.
            <div className="mt-3">
              <Link to="/log">
                <Button size="sm" variant="secondary">
                  <Utensils className="size-4" aria-hidden />
                  Log a meal
                </Button>
              </Link>
            </div>
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const [assessment, setAssessment] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const assess = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssessment(await apiService.risk.assess());
    } catch (requestError) {
      setError(requestError);
      setAssessment(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { assess(); }, [assess]);

  // Fixed display order, independent of the order the server happens to use.
  const risks = useMemo(() => {
    if (!assessment?.risks) return [];
    return CONDITION_ORDER
      .map((condition) => assessment.risks.find((risk) => risk.condition === condition))
      .filter(Boolean);
  }, [assessment]);

  const headline = useMemo(() => {
    if (!risks.length) return null;
    return risks.reduce((worst, risk) => (risk.score > worst.score ? risk : worst));
  }, [risks]);

  if (loading) return <LoadingState />;

  if (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status === 400) return <NotReadyState error={error} onRetry={assess} />;
    if (status === 503 || status === 0) return <UnavailableState error={error} onRetry={assess} />;
    return (
      <Alert tone="error" title="Could not load your assessment">
        {error.message}
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={assess}>Retry</Button>
        </div>
      </Alert>
    );
  }

  if (!risks.length) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No assessment available"
        action={<Button onClick={assess}>Run an assessment</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Headline: the condition that needs attention, named and banded. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Your metabolic risk</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-secondary">
            Highest right now:
            <span className="font-medium text-primary">
              {CONDITION_LABEL[headline.condition]} at {formatScore(headline.score)}
            </span>
            <BandPill band={headline.band} />
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProvenanceTag provenance={assessment.provenance} />
          <Button variant="secondary" size="sm" onClick={assess}>
            <RefreshCw className="size-4" aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {risks.map((risk) => <RiskCard key={risk.condition} risk={risk} />)}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk trajectory</CardTitle>
          <CardDescription>
            How each score has moved as your logged behaviour has changed. This measures the
            response to observed behaviour, not a forecast of your biology.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <Suspense fallback={<Skeleton className="h-72" />}>
            <TrajectoryChart
              trajectories={assessment.trajectories}
              historyDays={assessment.inputs?.historyDays}
            />
          </Suspense>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <BiomarkerPanel
          biomarkers={assessment.biomarkers}
          measuredKeys={assessment.inputs?.measuredBiomarkers}
        />
        <InputsPanel inputs={assessment.inputs} />
      </div>

      {/* The disclaimer the API returns, shown verbatim. */}
      <Disclaimer>{assessment.disclaimer}</Disclaimer>
    </div>
  );
}
