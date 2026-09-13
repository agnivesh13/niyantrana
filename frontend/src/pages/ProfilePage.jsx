/**
 * Your details, and what they are used for.
 *
 * Exists because a signed-in user had no way to see or correct the profile the
 * model scores them on. Once set, it was permanent — which became visible the
 * first time the demo seeder replaced someone's real measurements with the demo
 * persona's and there was no route back.
 *
 * It also shows what the account actually holds, which is the minimum a health
 * app owes a user: the numbers driving the scores, on one page, editable.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

import apiService from '../services/apiService.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  Alert, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Disclaimer, Skeleton,
} from '../ui/primitives.jsx';
import ProfileForm from '../components/ProfileForm.jsx';

/** Where each wearable day came from, counted. */
function SourceSummary({ days, sources }) {
  if (!days) {
    return (
      <p className="text-sm text-secondary">
        No wearable history yet. Add one from{' '}
        <a href="/onboarding" className="font-medium text-accent hover:underline">onboarding</a>.
      </p>
    );
  }
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-secondary">Wearable days stored</dt>
        <dd className="font-medium text-primary tabular">{days}</dd>
      </div>
      {Object.entries(sources).map(([source, count]) => (
        <div key={source} className="flex justify-between gap-4">
          <dt className="text-secondary">{source.replace(/_/g, ' ')}</dt>
          <dd className="tabular text-primary">{count}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [wearable, setWearable] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [profile, days] = await Promise.all([
        apiService.user.status(),
        // Enough to show where the history came from without pulling a year.
        apiService.user.wearable(365).catch(() => ({ data: [] })),
      ]);
      setStatus(profile);
      setWearable(days.data ?? []);
      setError(null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <Alert tone="error" title="Could not load your profile">{error}</Alert>;
  if (!status) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const sources = (wearable ?? []).reduce((counts, day) => {
    const key = day.source || 'unknown';
    return { ...counts, [key]: (counts[key] ?? 0) + 1 };
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Your details</h1>
        <p className="mt-1.5 text-secondary">
          These eight values are the model's inputs. Changing one changes every score on your
          dashboard.
        </p>
      </div>

      {saved && (
        <Alert tone="info" title="Saved">
          Your next assessment uses these values.
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => navigate('/dashboard')}>
              <RefreshCw className="size-4" aria-hidden />
              Back to the dashboard
            </Button>
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Height and waist are measured, not estimated, so the fatty-liver formula has real
            inputs.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <ProfileForm
            initial={status.staticData}
            submitLabel="Save changes"
            onSaved={() => { setSaved(true); load(); }}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Email</dt>
                <dd className="min-w-0 truncate text-primary">{user?.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Status</dt>
                <dd className="text-primary">{status.status}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              To have your account and all its records deleted, email the address in the{' '}
              <a href="/privacy" className="text-accent hover:underline">privacy policy</a>.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where your history came from</CardTitle>
            <CardDescription>
              Every day is stored with its source, so seeded demo data is never mistaken for a
              real reading.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <SourceSummary days={wearable?.length ?? 0} sources={sources} />
          </CardBody>
        </Card>
      </div>

      <Disclaimer />
    </div>
  );
}
