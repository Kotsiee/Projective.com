import type { CalendarIntegration } from "@projective/types/scheduling";

/**
 * scheduling fixtures — shared deterministic core. Like the sibling read fixtures (projects/board,
 * messages) every value derives from a small unsigned hash + a FIXED reference clock (no `Date.now()`,
 * no RNG), so SSR == the island refetch and a resume replays byte-identically. Zoned-time helpers place
 * recurring slots at a real LOCAL wall time in a schedule's timezone (`Intl`, available on Deno), so a
 * "Tue 2pm" session lands inside "Tue 9–17" working hours regardless of the server's own zone.
 */

// #region Reference clock + hashing
/** Fixed reference "now" — the identical constant used across the projects/board/message fixtures. */
export const NOW = Date.parse("2026-07-17T16:20:00Z");
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** A tiny stable hash → non-negative int (no RNG; SSR/resume stable — keep every index UNSIGNED). */
export function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/** Pick `n` entries from `pool`, offset by the seed (stable, wraps). */
export function pick<T>(pool: readonly T[], n: number, seed: number): T[] {
	const out: T[] = [];
	for (let i = 0; i < Math.min(n, pool.length); i++) out.push(pool[(seed + i) % pool.length]);
	return out;
}
// #endregion

// #region Timezone-aware placement (Intl; identical on server + client)
const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string): Intl.DateTimeFormat {
	let f = partsFmtCache.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		partsFmtCache.set(tz, f);
	}
	return f;
}

interface Parts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}
function zonedParts(ms: number, tz: string): Parts {
	const map: Record<string, string> = {};
	for (const p of partsFmt(tz).formatToParts(new Date(ms))) {
		if (p.type !== "literal") map[p.type] = p.value;
	}
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
		hour: Number(map.hour === "24" ? "0" : map.hour),
		minute: Number(map.minute),
		second: Number(map.second),
	};
}
function offsetAt(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}
/** Epoch ms of a wall-clock time (`y`/`m`(1-based)/`d` `h`:`min`) in `tz` (DST-corrected). */
export function zonedTimeToMs(y: number, m: number, d: number, h: number, min: number, tz: string): number {
	const guess = Date.UTC(y, m - 1, d, h, min, 0);
	const off1 = offsetAt(guess, tz);
	let epoch = guess - off1;
	const off2 = offsetAt(epoch, tz);
	if (off2 !== off1) epoch = guess - off2;
	return epoch;
}
/** Epoch ms of local midnight of the day containing `ms`. */
export function startOfDayLocal(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return zonedTimeToMs(p.year, p.month, p.day, 0, 0, tz);
}
/** Add `n` calendar days preserving the wall-clock time. */
export function addDaysLocal(ms: number, n: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return zonedTimeToMs(p.year, p.month, p.day + n, p.hour, p.minute, tz);
}
/** 0 = Sunday … 6 = Saturday for the zoned date of `ms`. */
export function weekdayLocal(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}
/** Epoch ms of Monday-midnight of the week containing `ms`. */
export function startOfWeekLocal(ms: number, tz: string): number {
	const dow = weekdayLocal(ms, tz);
	const diff = (dow - 1 + 7) % 7;
	return addDaysLocal(startOfDayLocal(ms, tz), -diff, tz);
}

/** A timed slot at a day's local `startMinute` for `durationMin`, as epoch-ms `{ start, end }`. */
export function localSlot(
	dayMidnightLocal: number,
	startMinute: number,
	durationMin: number,
	tz: string,
): { start: number; end: number } {
	const p = zonedParts(dayMidnightLocal, tz);
	const start = zonedTimeToMs(
		p.year,
		p.month,
		p.day,
		Math.floor(startMinute / 60),
		startMinute % 60,
		tz,
	);
	return { start, end: start + durationMin * MIN };
}
// #endregion

// #region Pools
/** The IANA display zones a project/entity is deterministically assigned when it carries no zone. */
export const TZ_POOL = [
	"Europe/London",
	"Europe/Lisbon",
	"Europe/Berlin",
	"America/New_York",
	"Asia/Tokyo",
	"America/Toronto",
	"Australia/Sydney",
] as const;

/** A deterministic display timezone for a seed. */
export function tzFor(seed: number): string {
	return TZ_POOL[seed % TZ_POOL.length];
}

const INTEGRATIONS: { id: string; label: string; accent: string }[] = [
	{ id: "google", label: "Google", accent: "--primary" },
	{ id: "outlook", label: "Outlook", accent: "--secondary" },
	{ id: "apple", label: "Apple", accent: "--on-surface-variant" },
	{ id: "samsung", label: "Samsung", accent: "--tertiary" },
	{ id: "notion", label: "Notion", accent: "--on-surface" },
];

/** A deterministic set of external-calendar chips — a couple connected per seed. */
export function integrationsFor(seed: number): CalendarIntegration[] {
	return INTEGRATIONS.map((it, i) => ({
		id: it.id,
		label: it.label,
		accent: it.accent,
		connected: ((seed >>> i) & 1) === 1 && i < 3,
	}));
}
// #endregion
