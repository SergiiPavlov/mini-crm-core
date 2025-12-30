/**
 * Normalize phone consistently across the app.
 *
 * Strategy: keep digits and a leading plus.
 * Examples:
 *  - "+38 (050) 123-45-67" -> "+380501234567"
 *  - "050-123-45-67"       -> "0501234567"
 */
export function normalizePhone(input: unknown): string {
  const v = String(input ?? '').trim();
  if (!v) return '';

  const hasPlus = v.startsWith('+');
  const digits = v.replace(/\D+/g, '');
  if (!digits) return '';

  return hasPlus ? `+${digits}` : digits;
}

/** Returns `undefined` for empty/whitespace-only input. */
export function normalizePhoneOptional(input: unknown): string | undefined {
  const v = normalizePhone(input);
  return v ? v : undefined;
}
