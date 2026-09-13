/**
 * The signed-in frame: a thin top bar, a content column, a footer.
 *
 * Deliberately plain. A screening tool earns trust by looking like a utility,
 * so there is one accent colour, one elevation step, and no decoration that
 * does not carry information. The previous shell had a gradient header, a
 * glassmorphic blur, a bottom tab bar and a floating launcher all at once.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, LogOut, MessageCircle, NotebookPen, User } from 'lucide-react';

import { cn } from '../lib/utils.js';
import { Button, Disclaimer } from '../ui/primitives.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import Wordmark from './Wordmark.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: Activity },
  { to: '/log', label: 'Log', icon: NotebookPen },
  { to: '/assistant', label: 'Assistant', icon: MessageCircle },
  // Fourth item, because the profile had no route at all: once set, the
  // values the model scores you on could not be seen or corrected.
  { to: '/profile', label: 'Profile', icon: User },
];

/**
 * Icon-only below `sm`.
 *
 * Three labelled items plus the wordmark do not fit across a 390px phone: the
 * bar overflowed and clipped the last item. The label stays in `aria-label`, so
 * nothing is lost to a screen reader.
 */
function NavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) => cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors sm:px-3.5',
        isActive
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-secondary hover:bg-surface-sunken hover:text-primary',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const signOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-content items-center gap-4 px-4 sm:px-6">
          <Wordmark to="/dashboard" />

          <nav className="ml-auto flex items-center gap-1" aria-label="Main">
            {NAV.map((item) => <NavItem key={item.to} {...item} />)}
          </nav>

          <div className="hidden items-center gap-3 border-l border-line pl-4 sm:flex">
            <span className="max-w-[14rem] truncate text-sm text-secondary">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
              <LogOut className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-content flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-content flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {/* Deliberately NOT the standing disclaimer: the dashboard already
              shows the one the API returns with every assessment, and two
              differently-worded warnings stacked on one screen reads as
              boilerplate rather than as a caution. This says the thing the
              disclaimer does not -- who the model was fitted on. */}
          <Disclaimer className="max-w-2xl">
            Risk models trained on NHANES 2013-2018 and calibrated on a US population;
            scores are systematically off for South Asian thresholds. Screening estimates
            only.
          </Disclaimer>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="/privacy" className="text-xs text-secondary hover:text-primary hover:underline">
              Privacy
            </a>
            <a href="/terms" className="text-xs text-secondary hover:text-primary hover:underline">
              Terms
            </a>
            <Button variant="ghost" size="sm" onClick={signOut} className="sm:hidden">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
