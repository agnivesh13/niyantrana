/**
 * Data access for the Indian food composition database.
 *
 * Search terms are escaped before they reach `$regex`, so a user-supplied
 * string cannot become a pattern. See domain/text.js.
 */
import Food from '../models/Food.js';
import { escapeRegex } from '../domain/text.js';

export class FoodRepository {
  search(term, limit = 10) {
    return Food.find({ food_name: { $regex: escapeRegex(term), $options: 'i' } })
      .limit(limit)
      .lean();
  }

  count() {
    return Food.estimatedDocumentCount();
  }
}

export default new FoodRepository();
