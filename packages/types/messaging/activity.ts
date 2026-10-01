/**
 * messaging.activity — the compact activity label an inbox row's 48px action slot can hold at every
 * type scale and under the dyslexia font overlay: `now` · `5m` · `3h` · `2d` · `3w` · `1y`. The full
 * label (`ConversationSummary.lastActivityLabel`) stays the row's spoken time; this is its glyph.
 *
 * Pre-formatted SERVER-side against the same clock as the full label, so SSR and hydration print the
 * same string.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/** Format the elapsed time since `iso` at `now` as a ≤ 3-character label (`now` for under a minute). */
export function compactActivityLabel(iso: string, now: number): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const elapsed = Math.max(0, now - at);
	if (elapsed < MINUTE) return "now";
	if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
	if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
	if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
	if (elapsed < YEAR) return `${Math.floor(elapsed / WEEK)}w`;
	return `${Math.floor(elapsed / YEAR)}y`;
}
