/**
 * Registration and credential verification.
 *
 * Registration, credential checking and Google sign-in, kept out of the route
 * handlers so the rules can be exercised without an HTTP request.
 */
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';

import config from '../config/env.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../domain/errors.js';
import userRepository from '../repositories/userRepository.js';

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthService {
  constructor(users = userRepository, {
    googleClientId = config.google.clientId,
    googleVerifier = new OAuth2Client(config.google.clientId),
  } = {}) {
    this.users = users;
    this.googleClientId = googleClientId;
    this.googleVerifier = googleVerifier;
  }

  async register({ email, password }) {
    if (!email || !password) throw new ValidationError('Email and password are required');
    if (!EMAIL_PATTERN.test(email)) throw new ValidationError('Enter a valid email address');
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    if (await this.users.existsByEmail(email)) {
      throw new ConflictError('An account with that email already exists');
    }

    const user = await this.users.create({
      email: email.toLowerCase().trim(),
      password: await bcrypt.hash(password, SALT_ROUNDS),
    });
    return { id: user.id, email: user.email };
  }

  /** Used by the Passport local strategy. Returns the user, or null. */
  async verifyCredentials(email, password) {
    const user = await this.users.findByEmail(email).select('+password');
    // A Google-only account has no password, so there is nothing to compare.
    // bcrypt.compare(password, undefined) rejects, so this guard is what keeps
    // a sign-in attempt against such an account a clean "invalid credentials".
    if (!user?.password) return null;
    return (await bcrypt.compare(password, user.password)) ? user : null;
  }

  /**
   * Sign in with a Google ID token.
   *
   * The token is verified against Google's public keys with Google's own
   * library -- signature, issuer, audience and expiry. Decoding the JWT and
   * trusting its claims would let anyone sign in as anyone by pasting a
   * hand-made token, which is the standard way this integration is got wrong.
   *
   * Three cases, in order:
   *   1. A known googleId          -> that user.
   *   2. A verified email we hold  -> link the Google account to it, so someone
   *                                   who registered with a password can switch
   *                                   to the button without losing their data.
   *   3. Neither                   -> create an account with no password.
   *
   * An unverified Google email is refused outright. Linking on an unverified
   * address would let someone claim an account by signing up to Google with
   * that address.
   */
  async signInWithGoogle(idToken) {
    if (!idToken) throw new ValidationError('A Google credential is required');
    if (!this.googleClientId) {
      throw new ValidationError('Google sign-in is not configured on this server');
    }

    let payload;
    try {
      const ticket = await this.googleVerifier.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      // Deliberately not echoed to the client: a verification failure is either
      // an expired token or an attack, and neither benefits from detail.
      console.warn('[auth] Google ID token rejected:', error.message);
      throw new UnauthorizedError('That Google sign-in could not be verified');
    }

    if (!payload?.email) throw new UnauthorizedError('That Google account has no email address');
    if (payload.email_verified === false) {
      throw new UnauthorizedError('Verify your email address with Google first');
    }

    const email = payload.email.toLowerCase().trim();
    const googleId = payload.sub;

    const byGoogleId = await this.users.findByGoogleId(googleId);
    if (byGoogleId) return byGoogleId;

    const byEmail = await this.users.findByEmail(email);
    if (byEmail) return this.users.linkGoogleId(byEmail.id, googleId);

    return this.users.create({ email, googleId });
  }
}

export default new AuthService();
