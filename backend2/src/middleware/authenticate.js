/**
 * Session guard.
 *
 * One definition of "is this request authenticated", used by every protected
 * route. Two copies of an access check are two chances for one of them to be
 * relaxed without the other.
 */
import config from '../config/env.js';
import { UnauthorizedError } from '../domain/errors.js';

export function authenticate(req, _res, next) {
  if (req.isAuthenticated?.()) return next();
  return next(new UnauthorizedError());
}

/**
 * The same guard, for routes a BROWSER navigates to rather than fetches.
 *
 * The OAuth consent entry point and its callback are reached by a top-level
 * navigation — the user clicks Connect, and later Google sends them back. A 401
 * there renders raw JSON in the address bar, which is not an error message so
 * much as a dead end: no way back into the app, and no indication of what went
 * wrong. This sends them to the sign-in screen with a reason instead.
 */
export function authenticateOrRedirect(req, res, next) {
  if (req.isAuthenticated?.()) return next();

  const app = config.corsOrigins[0];
  if (!app) return next(new UnauthorizedError());
  const params = new URLSearchParams({ google_health: 'signin_required' });
  return res.redirect(`${app}/signin?${params}`);
}

export default authenticate;
