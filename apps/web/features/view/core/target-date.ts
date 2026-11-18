/** What the "?" beside the optional target date explains (Decision #457). */
export const TARGET_DATE_HINT =
	"When you'd like the final delivery by. It becomes the soft deadline on the last milestone and the provider sees it. No deadline bonus applies yet.";

/**
 * The earliest target date a buyer may pick: tomorrow, in their own calendar. Never behind the date
 * checkout judges "passed" by (UTC), whatever the buyer's zone, and a same-day delivery is not a
 * scoped engagement.
 */
export function earliestTargetDate(now: Date = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

/** The `YYYY-MM-DD` the configure payload carries, from what the date picker holds; `null` for none. */
export function targetDateOf(value: Date | readonly Date[] | null): string | null {
	const date = Array.isArray(value) ? value[0] ?? null : value;
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
