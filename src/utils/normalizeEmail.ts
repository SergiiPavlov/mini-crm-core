/**
 * Normalize email consistently across the app.
 *
 * We intentionally keep it simple: trim + lowercase.
 * If you expect non-ASCII emails, consider adding Unicode normalization later.
 */

export function normalizeEmail(input: unknown): string {
  return String(input ?? '').trim().toLowerCase();
}

/**
 * Returns `undefined` for empty/whitespace-only input.
 */
export function normalizeEmailOptional(input: unknown): string | undefined {
  const v = normalizeEmail(input);
  return v ? v : undefined;
}
