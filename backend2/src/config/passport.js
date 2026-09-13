/**
 * Passport local strategy.
 *
 * Delegates credential checking to AuthService rather than reimplementing
 * bcrypt comparison here, so the rule lives with the other authentication
 * rules. Errors are passed to `done()` rather than left to reject, which is
 * what keeps a database failure a 500 instead of an unhandled rejection.
 */
import { Strategy as LocalStrategy } from 'passport-local';

import User from '../models/User.js';
import authService from '../services/authService.js';

export default function configurePassport(passport) {
  passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const user = await authService.verifyCredentials(email, password);
        return user
          ? done(null, user)
          : done(null, false, { message: 'Invalid email or password' });
      } catch (error) {
        return done(error);
      }
    },
  ));

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id, done) => {
    try {
      done(null, await User.findById(id));
    } catch (error) {
      done(error);
    }
  });
}
