/**
 * Sign in and sign up, one screen.
 *
 * Two things the previous version got wrong are structural here, not fixed in
 * passing:
 *
 * 1. It scaffolded bearer tokens in localStorage against a backend that uses
 *    Passport session cookies, so nothing it did could have authenticated.
 * 2. Its mock accepted any email and password pair, with a comment saying so.
 *
 * Credentials now go to the server and the server decides. A failed sign-in
 * shows the server message rather than a guess at what went wrong.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext.jsx';
import { Alert, Button, Card, Disclaimer, Field, Input } from '../ui/primitives.jsx';
import Wordmark from '../components/Wordmark.jsx';

const MIN_PASSWORD = 8;

export default function SignInPage() {
  const [params] = useSearchParams();
  const [isSignup, setIsSignup] = useState(params.get('mode') === 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const { login, signup, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  // Already signed in: the router decides where to go, not this screen.
  if (!isLoading && isAuthenticated) return <Navigate to="/dashboard" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setFormError(null);

    // Checked here only to avoid a pointless round trip; the server validates
    // independently and its verdict is the one that counts.
    if (isSignup && password.length < MIN_PASSWORD) {
      setFormError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    const result = isSignup
      ? await signup(email.trim(), password)
      : await login(email.trim(), password);
    setBusy(false);

    if (!result.success) {
      setFormError(result.error);
      return;
    }
    // A new account has no profile yet, so it starts at onboarding.
    navigate(isSignup ? '/onboarding' : '/dashboard', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center px-4 sm:px-6">
          <Wordmark to="/" />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <h1 className="text-center text-2xl font-semibold text-primary">
            {isSignup ? 'Create your account' : 'Sign in'}
          </h1>
          <p className="mt-2 text-center text-sm text-secondary">
            {isSignup
              ? 'Your profile and logs stay on your own account.'
              : 'Welcome back.'}
          </p>

          <Card className="mt-6 p-6 sm:p-8">
            <form onSubmit={submit} className="space-y-5" noValidate>
              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </Field>

              <Field
                label="Password"
                htmlFor="password"
                hint={isSignup ? `At least ${MIN_PASSWORD} characters.` : undefined}
              >
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>

              {formError && <Alert tone="error">{formError}</Alert>}

              <Button type="submit" size="lg" loading={busy} className="w-full">
                {isSignup ? 'Create account' : 'Sign in'}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-secondary">
              {isSignup ? 'Already have an account?' : 'New here?'}{' '}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => { setIsSignup((mode) => !mode); setFormError(null); }}
              >
                {isSignup ? 'Sign in' : 'Create one'}
              </button>
            </p>
          </Card>

          <Disclaimer className="mt-6 text-center" />
          <p className="mt-4 text-center text-sm">
            <Link to="/" className="text-secondary hover:text-primary hover:underline">
              Back to the overview
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
