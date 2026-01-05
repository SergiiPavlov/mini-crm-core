/**
 * Small helper to sanitize free-text inputs.
 *
 * - Trims whitespace
 * - Converts non-nullish values to string
 * - Optionally enforces max length
 * - Returns undefined for empty result
 */
export function sanitizeText(input: unknown, maxLen?: number): string | undefined {
  if (input == null) return undefined;

  let v = String(input).trim();
  if (!v) return undefined;

  if (typeof maxLen === 'number' && maxLen > 0 && v.length > maxLen) {
    v = v.slice(0, maxLen);
  }

  return v;
}
