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
import { AlertTriangle, RefreshCw } from 'lucide-react';

import apiService from '../services/apiService.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  Alert, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Disclaimer,
  Field, Input, Skeleton,
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


/**
 * Deleting the account.
 *
 * Irreversible and unrecoverable, so it asks the user to type their own email
 * address rather than accepting a click. The server checks the same thing, so
 * the guard is not something a modified client can skip -- and the button is
 * inert until the address matches, which is what keeps a misplaced tap on a
 * phone from being the end of someone's history.
 *
 * This is also what makes the privacy policy true in the app rather than only
 * by email: it says an account and all its records can be deleted, and here
 * they are.
 */
function DangerZone({ email }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const matches = confirm.trim().toLowerCase() === String(email ?? '').toLowerCase();

  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiService.user.deleteAccount(confirm.trim());
      // The server has already ended the session; a full navigation clears
      // every trace of in-memory state rather than leaving a signed-out app
      // holding the deleted user's data.
      window.location.assign('/');
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };

  return (
    <Card className="border-[#f3c0bb]">
      <CardHeader>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-status-critical" aria-hidden />
          <div>
            <CardTitle>Delete my data</CardTitle>
            <CardDescription>
              Removes your account and everything in it — profile, meals, measurements,
              wearable days, assessments and any connected Google tokens. This cannot be
              undone.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {!open ? (
          <Button variant="danger" onClick={() => setOpen(true)}>Delete my data</Button>
        ) : (
          <div className="space-y-4">
            <Field
              label={`Type ${email} to confirm`}
              htmlFor="confirm-delete"
              hint="Asked for deliberately: there is no undo and no backup to restore from."
            >
              <Input
                id="confirm-delete"
                autoComplete="off"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder={email}
              />
            </Field>

            {error && <Alert tone="error">{error}</Alert>}

            <div className="flex flex-wrap gap-3">
              <Button variant="danger" disabled={!matches} loading={busy} onClick={remove}>
                Delete everything permanently
              </Button>
              <Button
                variant="ghost"
                onClick={() => { setOpen(false); setConfirm(''); setError(null); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
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
              To delete your account and everything in it, use the panel at the bottom of
              this page. What is stored and why is set out in the{' '}
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

      <DangerZone email={user?.email} />

      <Disclaimer />
    </div>
  );
}
