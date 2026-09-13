/**
 * Data access for users.
 *
 * Refactoring applied: Extract Class + Hide Delegate.
 *
 * Route handlers previously called `User.findById`, `user.save()` and built
 * `$regex` queries inline -- Feature Envy on the Mongoose model, and a route
 * layer that could not be tested without a live database. Persistence now sits
 * behind this seam, and swapping the store touches one file.
 */
import mongoose from 'mongoose';

import MealLog from '../models/MealLog.js';
import User from '../models/User.js';
import VitalReading from '../models/VitalReading.js';
import { exactMatchPattern } from '../domain/text.js';

export class UserRepository {
  findById(id) {
    return User.findById(id);
  }

  findByEmail(email) {
    return User.findOne({ email: String(email).toLowerCase().trim() });
  }

  existsByEmail(email) {
    return User.exists({
      email: { $regex: exactMatchPattern(String(email).toLowerCase().trim()) },
    });
  }

  create(attributes) {
    return User.create(attributes);
  }

  updateStaticData(id, staticData) {
    return User.findByIdAndUpdate(
      id,
      { $set: { staticData, status: 'active' } },
      { new: true, runValidators: true },
    );
  }

  /**
   * Replace the whole wearable history.
   *
   * Used by demo seeding and by a full re-import, both of which must be
   * idempotent: clicking "load demo data" twice should not leave 180 days.
   */
  replaceWatchData(id, entries) {
    return User.findByIdAndUpdate(
      id,
      { $set: { watchHistory: Array.isArray(entries) ? entries : [entries] } },
      { new: true, runValidators: true },
    );
  }

  /**
   * Merge days by date: an existing day is updated, a new one appended.
   *
   * Re-importing an overlapping export should refresh those days rather than
   * create duplicates, which would corrupt the 14-day window the model reads.
   */
  async upsertWatchData(id, entries) {
    const incoming = Array.isArray(entries) ? entries : [entries];
    const user = await User.findById(id).select('watchHistory');
    if (!user) return null;

    const dayOf = (value) => new Date(value).toISOString().slice(0, 10);
    const merged = new Map(
      (user.watchHistory || []).map((day) => [dayOf(day.date), day.toObject?.() ?? day]),
    );
    let added = 0;
    let updated = 0;
    for (const entry of incoming) {
      const key = dayOf(entry.date);
      if (merged.has(key)) updated += 1; else added += 1;
      merged.set(key, { ...merged.get(key), ...entry });
    }

    const history = [...merged.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
    await User.findByIdAndUpdate(id, { $set: { watchHistory: history } },
      { runValidators: true });
    return { added, updated, total: history.length };
  }

  appendWatchData(id, entries) {
    const list = Array.isArray(entries) ? entries : [entries];
    return User.findByIdAndUpdate(
      id,
      { $push: { watchHistory: { $each: list } } },
      { new: true, runValidators: true },
    );
  }

  /** Most recent wearable days, oldest first -- the order the model expects. */
  async recentWatchData(id, days = 14) {
    const user = await User.findById(id).select('watchHistory').lean();
    if (!user?.watchHistory?.length) return [];
    return [...user.watchHistory]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-days);
  }

  appendHealthReport(id, report) {
    return User.findByIdAndUpdate(id, { $push: { healthHistory: report } }, { new: true });
  }

  findByGoogleId(googleId) {
    return User.findOne({ googleId: String(googleId) });
  }

  /** Link a Google account to an existing password account. */
  linkGoogleId(id, googleId) {
    return User.findByIdAndUpdate(id, { $set: { googleId: String(googleId) } },
      { new: true, runValidators: true });
  }

  /**
   * Store Google Health tokens.
   *
   * Merged field by field rather than replacing the sub-document, so a token
   * refresh does not wipe `connectedAt` or the granted scope list.
   */
  saveGoogleHealthTokens(id, tokens) {
    const update = Object.fromEntries(
      Object.entries(tokens).map(([field, value]) => [`googleHealth.${field}`, value]),
    );
    return User.findByIdAndUpdate(id, { $set: update }, { new: true });
  }

  /** Read the tokens back. They are `select: false`, so they must be asked for. */
  googleHealthTokens(id) {
    return User.findById(id)
      .select('+googleHealth +googleHealth.accessToken +googleHealth.refreshToken')
      .lean();
  }

  /**
   * Forget the connection.
   *
   * Wearable days already imported are deliberately kept: they are the user's
   * own history, and silently deleting data on disconnect would be a surprise.
   */
  /**
   * Delete an account and everything attached to it.
   *
   * Enumerated here rather than left to the caller, because "everything" has to
   * stay true as collections are added: a deletion that quietly leaves meal
   * logs behind would make the privacy policy a false statement.
   *
   * The profile, wearable history and past assessments are embedded in the user
   * document, so removing it removes them. Meals and vitals are separate
   * collections and are deleted explicitly.
   */
  async deleteAccount(id) {
    const userId = new mongoose.Types.ObjectId(String(id));
    const [meals, vitals] = await Promise.all([
      MealLog.deleteMany({ user: userId }),
      VitalReading.deleteMany({ user: userId }),
    ]);
    const user = await User.findByIdAndDelete(userId);

    return {
      deleted: Boolean(user),
      meals: meals.deletedCount ?? 0,
      vitals: vitals.deletedCount ?? 0,
      // Counted before the document went, so the user is told what was removed
      // rather than just that something was.
      wearableDays: user?.watchHistory?.length ?? 0,
      assessments: user?.healthHistory?.length ?? 0,
    };
  }

  clearGoogleHealth(id) {
    return User.findByIdAndUpdate(id, { $unset: { googleHealth: '' } }, { new: true });
  }
}

export default new UserRepository();
