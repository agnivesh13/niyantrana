/**
 * Routes.
 *
 * Wiring only: no layout, no state, no fallbacks. The previous App.jsx declared
 * ten routes, six of them to pages built entirely on mock data (a community
 * feed, a gamified wellness journey, a reports page that rendered a hardcoded
 * stranger lab results), and had no 404 and no error element.
 *
 * Four screens survive, because four screens is what the backend can honestly
 * serve: an overview, auth, onboarding, and the dashboard -- plus logging and
 * the assistant, both of which are real endpoints.
 */
import { Navigate, RouterProvider, createBrowserRouter, useRouteError } from 'react-router-dom';

import AppShell from './components/AppShell.jsx';
import AssistantPage from './pages/AssistantPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import LogPage from './pages/LogPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import SignInPage from './pages/SignInPage.jsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ChatProvider } from './contexts/ChatContext.jsx';
import { Alert, Button, Spinner } from './ui/primitives.jsx';

/** Full-page wait while the session is resolved against the server. */
function Resolving() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Spinner label="Checking your session" />
    </div>
  );
}

/**
 * Gate on real session state.
 *
 * The session cookie is HttpOnly, so the only way to know whether one is valid
 * is to ask the server -- which is why this waits rather than guessing from
 * localStorage, as the version it replaces did.
 */
function RequireAuth({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <Resolving />;
  if (!isAuthenticated) return <Navigate to="/signin" replace />;
  return children;
}

function RouteError() {
  const error = useRouteError();
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Alert tone="error" title="Something broke on this page">
        {error?.message ?? 'An unexpected error occurred.'}
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => window.location.assign('/')}>
            Back to the start
          </Button>
        </div>
      </Alert>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-hero font-semibold text-primary">404</p>
      <p className="mt-2 text-secondary">That page does not exist.</p>
      <div className="mt-6 flex justify-center">
        <Button onClick={() => window.location.assign('/')}>Back to the start</Button>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <LandingPage />, errorElement: <RouteError /> },
  { path: '/signin', element: <SignInPage />, errorElement: <RouteError /> },
  {
    path: '/onboarding',
    element: <RequireAuth><OnboardingPage /></RequireAuth>,
    errorElement: <RouteError />,
  },
  {
    element: <RequireAuth><AppShell /></RequireAuth>,
    errorElement: <RouteError />,
    children: [
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/log', element: <LogPage /> },
      { path: '/assistant', element: <AssistantPage /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export default function App() {
  return (
    <AuthProvider>
      <ChatProvider>
        <RouterProvider router={router} />
      </ChatProvider>
    </AuthProvider>
  );
}
