/**
 * Render smoke check: `npm run smoke`.
 *
 * Mounts every screen and the two data components through react-dom/server, so
 * a broken prop contract, a bad import or a crash on first render fails in one
 * command rather than in a browser. `vite build` already proves the imports
 * resolve; this proves the trees mount.
 *
 * What it cannot check: the trajectory chart's plot. ResponsiveContainer
 * measures its parent on mount, so under renderToString it emits an empty SVG.
 * The chart has to be looked at in a real browser.
 */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AuthProvider } from './src/contexts/AuthContext.jsx';
import { ChatProvider } from './src/contexts/ChatContext.jsx';
import AssistantPage from './src/pages/AssistantPage.jsx';
import DashboardPage from './src/pages/DashboardPage.jsx';
import LandingPage from './src/pages/LandingPage.jsx';
import LogPage from './src/pages/LogPage.jsx';
import OnboardingPage from './src/pages/OnboardingPage.jsx';
import ProfilePage from './src/pages/ProfilePage.jsx';
import SignInPage from './src/pages/SignInPage.jsx';
import RiskCard from './src/components/RiskCard.jsx';
import TrajectoryChart from './src/components/TrajectoryChart.jsx';

// Browser globals the app touches while rendering. No module reads these at
// import time, so assigning them here -- before anything is rendered -- is
// enough. ChatProvider reads localStorage in a useState initialiser, and the
// chart asks matchMedia whether there is room for its label rail.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.window = globalThis.window ?? { location: { origin: 'http://localhost:5173' } };

const RISK = {
  condition: 'fatty_liver',
  score: 56.9,
  band: 'moderate',
  provenance: 'model',
  basis: 'calibrated_classifier',
  rationale: 'Intermediate likelihood of fatty liver. Waist reduction has the largest effect.',
  contributors: ['waist circumference', 'BMI', 'triglycerides', 'alcohol intake'],
};

// Final values close together on purpose: it exercises label separation.
const TRAJECTORIES = ['fatty_liver', 'hypertension', 'dysglycaemia', 'diabetes']
  .map((condition, series) => ({
    condition,
    direction: ['improving', 'worsening', 'stable', 'unknown'][series],
    slope_per_week: series === 3 ? null : 0.4 * (series - 1),
    provenance: 'model',
    points: [13, 20, 27, 34, 41, 48, 55, 62, 69, 76, 83, 89].map((day, index) => ({
      day_index: day,
      score: 46 + series * 1.6 + index * (series === 1 ? 0.9 : -0.5),
    })),
  }));

const screens = {
  LandingPage: <LandingPage />,
  SignInPage: <SignInPage />,
  OnboardingPage: <OnboardingPage />,
  DashboardPage: <DashboardPage />,
  LogPage: <LogPage />,
  ProfilePage: <ProfilePage />,
  AssistantPage: <AssistantPage />,
  RiskCard: <RiskCard risk={RISK} />,
  TrajectoryChart: <TrajectoryChart trajectories={TRAJECTORIES} historyDays={90} />,
  'TrajectoryChart (too little history)': <TrajectoryChart trajectories={[]} historyDays={6} />,
};

let failed = 0;
for (const [name, element] of Object.entries(screens)) {
  try {
    const html = renderToString(
      <MemoryRouter>
        <AuthProvider>
          <ChatProvider>{element}</ChatProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    if (!html.length) throw new Error('rendered nothing');
    console.log(`  ok   ${name.padEnd(36)} ${String(html.length).padStart(6)} chars`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}: ${error.message}`);
  }
}

console.log(failed ? `\n${failed} screen(s) failed to render` : `\n${Object.keys(screens).length} screens rendered`);
process.exit(failed ? 1 : 0);
