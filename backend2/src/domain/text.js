/**
 * Text helpers shared by the repositories.
 *
 * One definition, shared. A security-relevant helper with two copies is a
 * helper where only one of them gets fixed.
 */

const BACKSLASH = String.fromCharCode(92);
const REGEX_SPECIALS = new Set([...'.*+?^${}()|[]', BACKSLASH]);

/**
 * Escapes regex metacharacters in untrusted input.
 *
 * Interpolating a raw query parameter into a `$regex` is a regex-injection and
 * ReDoS vector, and it also defeats the index on the field being searched, so
 * every user-supplied search term passes through here first.
 */
export function escapeRegex(value) {
  return [...String(value)]
    .map((character) => (REGEX_SPECIALS.has(character) ? BACKSLASH + character : character))
    .join('');
}

/** Case-insensitive exact-match pattern, anchored at both ends. */
export function exactMatchPattern(value) {
  return new RegExp(`^${escapeRegex(value)}$`, 'i');
}

export default escapeRegex;
