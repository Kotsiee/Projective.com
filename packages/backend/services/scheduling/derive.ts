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
export function zonedTimeToMs(
	y: number,
	m: number,
	d: number,
	h: number,
	min: number,
	tz: string,
): number {
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

/**
 * The external calendars a derived occurrence can be mirrored onto.
 *
 * `projective` is deliberately NOT in this pool — it is added unconditionally by
 * {@link sourcesFor}, because every event on this platform is on this platform. A pool that could
 * omit it would let a block claim it exists only in Google.
 *
 * ⚠️ Every member must be a provider the CONNECTOR CATALOGUE declares a `calendar` capability for
 * (`integrations.providers`, mirrored by `services/integrations/connections-fixtures.ts`). The pool
 * used to include `outlook` and `apple`, which that catalogue does not carry at all — so the grid
 * drew Outlook and Apple provenance across the page while the Connect Calendar dialog, filtering the
 * very same catalogue on `capabilities.includes("calendar")`, told the reader neither is a calendar
 * this account can connect. Two surfaces on one route answering "is this synced?" differently is
 * worse than a shorter pool. Restore them here the moment the catalogue carries them, not before.
 */
const SYNC_POOL = ["google", "notion", "calendly"] as const;

/**
 * Which calendars an occurrence appears on, deterministically.
 *
 * Always leads with `projective` (see above) and adds between zero and two external mirrors, so the
 * grid shows single, double and triple stacks without any of them being random. Every index is
 * UNSIGNED (`>>>`): a signed shift produced negative indices and `undefined` slots the last three
 * times a fixture in this repo reached for one.
 *
 * The leading `projective` is what makes the reader's Calendars filter a LAYER switch rather than an
 * origin filter: an occurrence is on several calendars at once, so withdrawing one of them leaves
 * the others holding it up. See `visibleEvents`/`sourceIsVisible` in the app's `calendar-state.ts`
 * for the semantics that follow from it — do not "fix" this by dropping the platform's own copy,
 * which would let a block claim it exists only in Google.
 */
export function sourcesFor(key: string): string[] {
	const h = hash(key);
	const extra = h % 3; // 0 · 1 · 2 external mirrors
	const out = ["projective"];
	for (let i = 0; i < extra; i++) out.push(SYNC_POOL[(h >>> (i * 3)) % SYNC_POOL.length]);
	// A vendor can only appear once — two marks for one calendar is a lie about the fan-out.
	return Array.from(new Set(out));
}

/** The single external calendar a privacy-masked busy block was pulled in from. */
export function externalSourceFor(key: string): string[] {
	return [SYNC_POOL[hash(key) % SYNC_POOL.length]];
}
// #endregion
