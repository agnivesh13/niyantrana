/**
 * The landing page.
 *
 * Written to survive a reviewer reading it carefully. Every number on this page
 * is one that `ml/RESULTS.md` can defend, each is shown with the split it was
 * measured on, and the one figure that looks best is the one carrying a caveat
 * -- because an AUROC of 0.958 for fatty liver is close to a tautology when
 * BMI and waist alone reach 0.9548.
 *
 * A portfolio landing page that overclaims is worse than a plain one: the first
 * question in an interview is always "how did you validate this?".
 */
import { Link } from 'react-router-dom';
import { ArrowRight, Database, LineChart, ShieldCheck, Workflow } from 'lucide-react';

import { Button, Card, Disclaimer } from '../ui/primitives.jsx';
import Wordmark from '../components/Wordmark.jsx';

const METRICS = [
  { label: 'Hypertension', value: '0.802', note: 'AUROC / 91% sensitivity' },
  { label: 'Blood sugar', value: '0.799', note: 'AUROC / 93% sensitivity' },
  { label: 'Type-2 diabetes', value: '0.799', note: 'AUROC / 90% sensitivity' },
  { label: 'Fatty liver', value: '0.958', note: 'AUROC / see the caveat' },
];

const PILLARS = [
  {
    icon: Database,
    title: 'Trained on real data',
    body: 'NHANES 2013-2018, 17,961 adults. Reported on a cycle holdout — trained on '
      + '2013-2016, tested on 2017-2018 — so no participant appears on both sides.',
  },
  {
    icon: LineChart,
    title: 'Risk over your own history',
    body: 'The model scores successive 14-day windows of your wearable history, which '
      + 'produces a genuine trend line rather than a forecast dressed up as one.',
  },
  {
    icon: ShieldCheck,
    title: 'Every number says where it came from',
    body: 'Each score carries its provenance and basis. If the model is unreachable you '
      + 'get an error, never a plausible substitute.',
  },
  {
    icon: Workflow,
    title: 'Indian food database',
    body: 'Macros resolve server-side against Anuvaad INDB 2024.11 — 1,014 Indian foods '
      + 'so meal logging does not require translating a thali into a US database.',
  },
];

function Metric({ label, value, note }) {
  return (
    <div className="px-5 py-4">
      <p className="text-2xl font-semibold text-primary tabular">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-primary">{label}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between px-4 sm:px-6">
          <Wordmark to={null} />
          <div className="flex items-center gap-2">
            <Link to="/signin" className="hidden sm:inline-flex">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/signin?mode=signup">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero: one sentence of what it does, one of how it is checked. */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-content px-4 py-20 text-center sm:px-6 sm:py-28">
          <p className="text-sm font-medium text-accent">Metabolic screening, honestly built</p>
          <h1 className="mx-auto mt-4 max-w-3xl text-hero font-semibold text-primary sm:text-display">
            See your metabolic risk before the blood test does
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-secondary">
            Niyantrana turns fourteen days of wearable and diet data into calibrated risk
            estimates for fatty liver, blood pressure, blood sugar and type-2 diabetes —
            and tells you exactly how confident it is and why.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/signin?mode=signup">
              <Button size="lg">
                Create an account
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </Link>
            <Link to="/signin">
              <Button size="lg" variant="secondary">Sign in</Button>
            </Link>
          </div>
          <p className="mt-5 text-sm text-muted">
            Free. No device required — a demo history can be loaded in one click.
          </p>
        </div>
      </section>

      {/* Metrics, with the split they were measured on stated beside them. */}
      <section className="mx-auto w-full max-w-content px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-semibold text-primary">
          Held-out performance
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-secondary">
          Four calibrated classifiers, trained on NHANES 2013-2018 and reported on a
          cycle holdout. Sensitivity is quoted at the operating threshold each head
          actually uses, because a screening tool that misses cases is the failure
          that matters.
        </p>

        <Card className="mt-8 grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
          {METRICS.map((metric) => <Metric key={metric.label} {...metric} />)}
        </Card>

        <p className="mt-4 text-center text-sm text-muted">
          Caveat on fatty liver: BMI and waist circumference alone reach 0.9548, so the
          remaining fourteen features add about 0.003. The headline number is close to a
          tautology and is reported that way in the results write-up.
        </p>
      </section>

      {/* What it is built on. */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-content px-4 py-16 sm:px-6">
          <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft">
                  <Icon className="size-5 text-accent" aria-hidden />
                </div>
                <div>
                  <h3 className="font-medium text-primary">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-secondary">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The limitation section, on the landing page rather than buried. */}
      <section className="mx-auto w-full max-w-content px-4 py-16 sm:px-6">
        <Card className="p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-primary">What this does not do</h2>
          <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-secondary">
            <li>
              <strong className="font-medium text-primary">It is not a diagnosis.</strong>{' '}
              These are screening estimates. Confirm anything that concerns you with a
              clinical test.
            </li>
            <li>
              <strong className="font-medium text-primary">It is calibrated on a US
              population.</strong>{' '}
              South Asians develop metabolic disease at lower BMI and waist thresholds, so
              scores are systematically off for the population this was built for. Fixing
              that needs NFHS-5 or LASI data.
            </li>
            <li>
              <strong className="font-medium text-primary">High probabilities are
              overconfident.</strong>{' '}
              The blood-sugar head predicts 0.88 where 0.64 is observed in the top bin.
            </li>
            <li>
              <strong className="font-medium text-primary">The trend reflects behaviour,
              not biology.</strong>{' '}
              Your profile is held constant as the window walks, so it understates
              improvement for someone who is also losing weight.
            </li>
          </ul>
        </Card>
      </section>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-content flex-col gap-4 px-4 py-8 sm:px-6">
          <Wordmark to={null} subdued />
          <Disclaimer className="max-w-3xl" />
        </div>
      </footer>
    </div>
  );
}
