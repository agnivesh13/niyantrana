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
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Link as LinkIcon, Upload } from 'lucide-react';

import apiService from '../services/apiService.jsx';
import { readSamsungExport } from '../lib/samsungExport.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  Alert, Button, Card, CardBody, CardDescription, CardHeader,
  Disclaimer, Field, Input, Select, Spinner,
} from '../ui/primitives.jsx';
import ProfileForm from '../components/ProfileForm.jsx';
import Wordmark from '../components/Wordmark.jsx';

const DEMO_DAYS = 90;

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

/** Field names a feature's response carried, from either report shape. */
const observedOf = (detail) => (detail?.observed
  ?? detail?.diagnostics?.flatMap((d) => d.observed ?? [])
  ?? []);

/**
 * Connect Google Health.
 *
 * The live first-party path, and the successor to both Google Fit (closed to
 * new developers on 1 May 2024, deprecated 2026) and the Fitbit Web API (turned
 * down September 2026).
 *
 * The test-user limit is stated on the card rather than discovered at Google's
 * consent screen. Every Health API scope is Restricted, so until this app
 * passes OAuth verification — which includes a third-party security review —
 * only accounts added as test users in the Google Cloud console can connect.
 * Someone clicking a button that cannot work for them deserves to know why
 * before they click it, not after.
 */
function GoogleHealthCard({ onSynced }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      setStatus(await apiService.wearable.googleHealthStatus());
    } catch {
      // Not fatal: the other two paths still work, so a status failure hides
      // this card rather than blocking onboarding.
      setStatus({ configured: false, connected: false });
    }
  }, []);

  const sync = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await apiService.wearable.googleHealthSync(DEMO_DAYS);
      setReport(response);
      if (response.imported > 0) onSynced(`Synced ${response.imported} days from Google Health.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
      load();
    }
  }, [onSynced, load]);

  useEffect(() => { load(); }, [load]);

  // Returning from Google's consent screen. The backend puts the outcome in the
  // query string because it redirects a browser, not an XHR — and every failure
  // path comes back here rather than rendering JSON at the API's address.
  useEffect(() => {
    const outcome = params.get('google_health');
    if (!outcome) return;

    const reason = params.get('reason');
    params.delete('google_health');
    params.delete('reason');
    params.delete('scopes');
    setParams(params, { replace: true });

    if (outcome === 'connected') {
      sync();
      return;
    }
    setError(OUTCOME_MESSAGE[outcome]?.(reason) ?? `Google Health returned "${outcome}".`);
  }, [params, setParams, sync]);

  if (!status?.configured) return null;

  return (
    <div className="rounded border border-accent/30 bg-accent-soft/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-primary">Connect Google Health</h3>
          <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-secondary">
            Reads steps, active minutes, sleep, resting heart rate and HRV straight from
            your Google account — the successor to Google Fit and the Fitbit Web API, both
            of which shut down in 2026.
          </p>
        </div>
        {status.connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-status-good-soft px-2.5 py-1 text-xs font-medium text-status-good">
            <Check className="size-3.5" aria-hidden />
            Connected
          </span>
        )}
        {status.needsReconnect && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-status-warning-soft px-2.5 py-1 text-xs font-medium text-[#8a6100]">
            Reconnect needed
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {status.connected ? (
          <>
            <Button size="sm" loading={busy} onClick={sync}>Sync {DEMO_DAYS} days</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await apiService.wearable.googleHealthDisconnect();
                load();
              }}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => window.location.assign(apiService.wearable.googleHealthConnectUrl())}
          >
            <LinkIcon className="size-4" aria-hidden />
            Connect
          </Button>
        )}
      </div>

      {status.needsReconnect && (
        <p className="mt-3 text-xs leading-relaxed text-[#8a6100]">
          Google has expired this connection. While the app is in testing it does that
          every 7 days — connect again to resume syncing. Days already imported are kept.
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Google classifies every Health API scope as Restricted, so this works for accounts
        added as test users in the project console until the app passes OAuth verification.
        If that is not you, use a file export below.
      </p>

      {error && <Alert tone="error" className="mt-3">{error}</Alert>}

      {/* What actually arrived, per feature. A sync that finds nothing is a
          common and legitimate outcome — an account with no paired device — and
          saying which fields came back is the difference between diagnosing
          that and assuming the integration is broken. */}
      {report && (
        <div className="mt-3 rounded border border-line bg-surface p-3">
          <p className="text-xs font-medium text-primary">
            {report.imported > 0
              ? `${report.imported} days merged (${report.range?.from} to ${report.range?.to})`
              : report.accountNotLinked
                ? 'This account has no Fitbit link'
                : 'No days returned'}
          </p>
          {report.notice && <p className="mt-1 text-xs text-secondary">{report.notice}</p>}
          {!report.accountNotLinked && (
            <ul className="mt-2 space-y-0.5">
              {Object.entries(report.report ?? {}).map(([feature, detail]) => (
                <li key={feature} className="text-[11px]">
                  <span className="flex justify-between gap-3">
                    <span className="text-secondary">{feature.replace(/_/g, ' ')}</span>
                    <span className={detail.days > 0 ? 'text-status-good' : 'text-muted'}>
                      {detail.days > 0 ? `${detail.days} days` : (detail.error ?? 'none')}
                    </span>
                  </span>
                  {/* Say when a value was derived here rather than read from a
                      platform daily record -- the two are not the same number. */}
                  {detail.derived && (
                    <span className="block text-[10px] text-muted">{detail.derived}</span>
                  )}
                  {/* The field names the response actually carried. "No value
                      found" says the mapping missed without saying what to map
                      to, and the real response is the only authority on that. */}
                  {observedOf(detail).length > 0 && (
                    <span className="mt-0.5 block break-all font-mono text-[10px] text-muted">
                      sent: {observedOf(detail).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function WearableStep({ onDone }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(null);

  /**
   * Load the demo history.
   *
   * The server refuses if the account holds real wearable days, so this asks
   * before overwriting rather than discovering the loss afterwards. Demo data
   * is deterministic and the demo profile is fixed, which is why every
   * demo-seeded account shows the same scores -- said explicitly, because
   * seeing someone else's numbers on your own dashboard looks like a bug.
   */
  const loadDemo = async ({ force = false } = {}) => {
    setError(null);
    setBusy('demo');
    try {
      const response = await apiService.wearable.loadDemo(DEMO_DAYS, { force });
      setResult(`${response.wearableDays ?? DEMO_DAYS} days of demo history loaded. `
        + (response.profileReplaced
          ? 'Your profile was set to the demo persona, so these scores are the demo '
            + 'scores and are identical on every demo account.'
          : 'Your own profile was kept.'));
    } catch (requestError) {
      if (requestError.details?.requiresForce) {
        setConfirmOverwrite(requestError.message);
        return;
      }
      setError(requestError.message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Samsung Health hands you a zip, so the app takes a zip.
   *
   * Unzipped in the browser because the archive is ~23 MB of which this reads
   * four CSVs; uploading the rest would cost the user their mobile data to send
   * raw JSON nothing parses.
   */
  const importSamsung = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setBusy('samsung');
    try {
      const { files } = await readSamsungExport(file);
      const response = await apiService.wearable.importSamsung(files);
      const covered = Object.entries(response.counts ?? {})
        .filter(([, days]) => days > 0)
        .map(([feature, days]) => `${feature.replace(/_/g, ' ')} ${days}`)
        .join(', ');
      setResult(
        `Imported ${response.imported} days from Samsung Health `
        + `(${response.range?.from} to ${response.range?.to}). ${covered}.`
        + (response.missing?.length
          ? ` Not in the export: ${response.missing.join(', ').replace(/_/g, ' ')}.`
          : ''),
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(null);
      event.target.value = '';
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
        An assessment scores a 14-day window, and a trend needs at least 28 days. Connect
        Google Health, import an export from your device, or load a demo history to see the
        app working now.
      </p>

      <GoogleHealthCard onSynced={setResult} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded border border-line p-4">
          <h3 className="text-sm font-medium text-primary">Samsung Health</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-secondary">
            Samsung Health &rarr; Settings &rarr; Download personal data, then drop the
            <strong className="font-medium text-primary"> .zip</strong> in here as it came.
            Reads steps, active minutes, sleep and resting heart rate.
          </p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3.5 py-2 text-sm text-primary hover:bg-surface-sunken">
            <Upload className="size-4" aria-hidden />
            {busy === 'samsung' ? 'Reading the archive...' : 'Choose the .zip'}
            <input
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              onChange={importSamsung}
              disabled={busy !== null}
            />
          </label>
        </div>

        <div className="rounded border border-line p-4">
          <h3 className="text-sm font-medium text-primary">Another device export</h3>
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
            onClick={() => loadDemo()}
          >
            Load {DEMO_DAYS} days
          </Button>
        </div>
      </div>

      {confirmOverwrite && (
        <Alert tone="warning" title="This would replace your real data">
          {confirmOverwrite}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => { setConfirmOverwrite(null); loadDemo({ force: true }); }}
            >
              Replace it with demo data
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmOverwrite(null)}>
              Keep my data
            </Button>
          </div>
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {result && <Alert tone="info">{result}</Alert>}

      <Button onClick={onDone} disabled={!result}>Go to my dashboard</Button>
    </div>
  );
}

export default function OnboardingPage() {
  // null while deciding which step to open on. Rendering step 1 first and then
  // jumping would flash a form the user has already filled in.
  const [step, setStep] = useState(null);
  const [profile, setProfile] = useState(null);
  const navigate = useNavigate();
  const [search] = useSearchParams();

  /**
   * Open on the step the user actually needs.
   *
   * Two reasons this cannot just default to 1:
   *
   * 1. **Returning from Google.** The consent flow redirects to
   *    `/onboarding?google_health=connected`, and the card that reads that
   *    parameter and starts the sync lives inside step 2. Mounting on step 1
   *    meant the redirect landed on the profile form, the parameter was never
   *    read, and a *successful* connection looked like nothing had happened.
   * 2. **Someone who already has a profile.** Making them retype their height
   *    and waist to reach the connect button is a toll for no reason.
   */
  useEffect(() => {
    let cancelled = false;
    const returningFromGoogle = search.has('google_health');

    apiService.user.status()
      .then((status) => {
        if (cancelled) return;
        setProfile(status.staticData ?? null);
        setStep(status.canBeAssessed || returningFromGoogle ? 2 : 1);
      })
      // A failed status check should not block onboarding; the first step is
      // the safe assumption, unless Google is sending the user back.
      .catch(() => { if (!cancelled) setStep(returningFromGoogle ? 2 : 1); });

    return () => { cancelled = true; };
  }, [search]);

  if (step === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-ground">
        <Spinner label="Loading your profile" />
      </div>
    );
  }

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
                <ProfileForm initial={profile} submitLabel="Save and continue"
                  onSaved={() => setStep(2)} />
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StepHeader step={2} current={step} title="Wearable history" />
                {step === 2 && (
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                    Edit my profile
                  </Button>
                )}
              </div>
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
