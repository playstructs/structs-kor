/* Which shortcut a keydown means (pure, so the tests can run it without a DOM). */

/**
 * The key a shortcut means, whatever the input method. With 한글 on, Z arrives as `ㅋ` (macOS) or
 * `Process` (Windows), so those fall back to the physical key (`e.code`). An ASCII key wins, so
 * AZERTY and Dvorak keep their own letters.
 */
export function keyOf(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (e.key.length === 1 && e.key >= '!' && e.key <= '~') return e.key.toLowerCase();
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code ?? '');
  if (m) return (m[1] ?? m[2]).toLowerCase();
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}
