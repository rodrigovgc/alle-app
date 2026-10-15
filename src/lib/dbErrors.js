/**
 * Database errors in plain words. The database's own text (table and rule names)
 * stays in err.raw for the app's logic and is never shown to people.
 */
export function plainDbError(error) {
  const raw = String(error?.message || error || '');
  const text = /failed to fetch|networkerror|load failed|network request failed/i.test(raw) ? 'Couldn’t reach Alle. Check your connection and try again.'
    : /row-level security|jwt|not authenticated|auth session missing|permission denied/i.test(raw) ? 'Your sign-in expired. Sign in again and try once more.'
    : /check constraint|does not belong|invalid input|too long|violates/i.test(raw) ? 'That couldn’t be saved: something in it is too long or not allowed.'
    : 'Something went wrong. Try again in a moment.';
  const err = new Error(text);
  err.raw = raw;
  err.code = error?.code;
  return err;
}
