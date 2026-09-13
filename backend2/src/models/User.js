/**
 * User persistence schema.
 *
 * Fixes carried over from v1:
 * - `watchDataSchema` declared `calories_burned` / `resting_heart_rate` while the
 *   ingest route wrote `active_calories` / `heart_rate`. Mongoose strict mode
 *   silently discarded both, so two of six model features were always absent.
 *   Aliases now accept either spelling.
 * - `password` was returned by default on every query. It is now `select: false`.
 * - `healthReportSchema` existed but nothing ever wrote to it (Dead Code); it is
 *   now actually populated by the risk service.
 */
import mongoose from 'mongoose';

const watchDataSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now, index: true },
  daily_steps: { type: Number, min: 0 },
  active_minutes: { type: Number, min: 0 },
  calories_burned: { type: Number, min: 0, alias: 'active_calories' },
  sleep_hours: { type: Number, min: 0, max: 24 },
  sleep_quality_score: { type: Number, min: 0, max: 100 },
  resting_heart_rate: { type: Number, min: 20, max: 220, alias: 'heart_rate' },
  heart_rate_variability: { type: Number, min: 0 },
  // Naming the provider matters for trust: a reviewer looking at a populated
  // demo account must be able to tell seeded data from a real device export.
  source: {
    type: String,
    enum: ['google_health', 'fitbit', 'apple_health', 'oura', 'withings',
      'google_takeout', 'import', 'manual', 'demo'],
    default: 'manual',
  },
}, { _id: false });

const riskScoreSchema = new mongoose.Schema({
  condition: String,
  score: Number,
  band: { type: String, enum: ['low', 'moderate', 'high'] },
  rationale: String,
}, { _id: false });

const healthReportSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  biomarkers: {
    triglycerides: Number,
    ggt: Number,
    hba1c: Number,
    systolic_bp: Number,
    diastolic_bp: Number,
  },
  risks: [riskScoreSchema],
  // Never store a score without recording where it came from.
  provenance: { type: String, enum: ['model', 'simulation', 'heuristic'], required: true },
}, { _id: false });

const staticDataSchema = new mongoose.Schema({
  age: { type: Number, min: 18, max: 120 },
  height: { type: Number, min: 50, max: 260 },
  weight: { type: Number, min: 20, max: 400 },
  gender: { type: String, enum: ['M', 'F'] },
  waist: { type: Number, min: 30, max: 250 },
  has_hereditary_risk: { type: Boolean, default: false },
  alcohol_drinks_week: { type: Number, min: 0, default: 0 },
  smoking_status: { type: Number, enum: [0, 1, 2], default: 0 },
  bmr: Number,
}, { _id: false });

/**
 * Google Health API tokens.
 *
 * Replaces the Fitbit block, which was schema for an API that closed to new
 * registrations before it could be used and is turned down in September 2026.
 *
 * Tokens are `select: false` for the same reason `password` is: a query that
 * forgets to exclude them should not be able to leak them. Only the client that
 * refreshes them asks for them explicitly.
 */
const googleHealthSchema = new mongoose.Schema({
  // Google's own account identifier, from the identity endpoint. Stored so a
  // reconnection can be recognised as the same account.
  googleUserId: String,
  accessToken: { type: String, select: false },
  refreshToken: { type: String, select: false },
  expiresAt: Date,
  // Recorded because the granted scopes can be narrower than the requested
  // ones: a user may allow activity and refuse sleep, and a sync that assumes
  // otherwise would report a failure rather than a partial result.
  scopes: { type: [String], default: [] },
  connectedAt: Date,
  lastSyncedAt: Date,
  // Set when Google rejects the refresh token outright. While the app is in
  // Testing mode Google expires these after 7 days, so this is a normal weekly
  // state rather than an exceptional one.
  needsReconnect: { type: Boolean, default: false },
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String, required: true, unique: true, lowercase: true, trim: true, index: true,
  },
  /**
   * Google account subject claim, when the user signed in with Google.
   *
   * `sparse` so the unique index ignores password-only accounts rather than
   * treating their missing googleId as a duplicate null.
   */
  googleId: { type: String, index: true, unique: true, sparse: true },
  /**
   * Required only for password accounts.
   *
   * A Google-only account has no password to store, and inventing a random one
   * would leave an unusable credential in the database that looks usable.
   */
  password: {
    type: String,
    select: false,
    required: function passwordRequired() { return !this.googleId; },
  },
  status: { type: String, enum: ['calibrating', 'active'], default: 'calibrating' },
  staticData: { type: staticDataSchema, default: () => ({}) },
  watchHistory: { type: [watchDataSchema], default: [] },
  healthHistory: { type: [healthReportSchema], default: [] },
  googleHealth: { type: googleHealthSchema, select: false },
}, { timestamps: true });

/** Whether enough profile data exists to run an assessment. */
userSchema.methods.canBeAssessed = function canBeAssessed() {
  const d = this.staticData || {};
  return Boolean(d.age && d.height && d.weight && d.gender && d.waist);
};

export default mongoose.models.User || mongoose.model('User', userSchema);
