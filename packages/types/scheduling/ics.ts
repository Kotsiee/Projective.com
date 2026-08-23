import type { CalendarEvent, CalendarEventKind } from "./scheduling.ts";

/**
 * scheduling.ics — the iCalendar (RFC 5545) READER.
 *
 * `packages/types/finance/order.ts` already owns the WRITER (`buildIcsCalendar`); this is its exact
 * inverse and lives in the SSOT for the same reason the writer does: parsing a calendar file is a
 * pure text-to-data transformation with no clock, no IO and no DOM, so it belongs where both the fat
 * service and the browser can call the one implementation. A parser inside a component would be
 * untestable and would fork the moment a second surface needed to import a file.
 *
 * Three properties of the format are load-bearing, and each has cost a real importer somewhere:
 *
 *  1. **Content lines are FOLDED** (§3.1). A line longer than 75 octets is split, and every
 *     continuation begins with a single space or tab. Unfolding must therefore happen BEFORE any
 *     field is split, otherwise a long `DESCRIPTION` arrives as one property plus several
 *     unparseable fragments.
 *  2. **Lines are CRLF-terminated.** A file written by a conforming producer has no bare `\n` at
 *     all, and a file written by a lenient one has nothing else; both are accepted here by
 *     normalising first.
 *  3. **TEXT values are escaped** (§3.3.11) — backslash, semicolon, comma and newline. The writer
 *     escapes the backslash FIRST, so the naive inverse is to unescape it LAST — but a chain of
 *     `String.replace` calls is wrong in either order: `\\n` is an escaped backslash followed by a
 *     literal `n`, and any pass that looks at `\n` before consuming the `\\` in front of it turns it
 *     into a newline. {@link icsUnescape} therefore scans ONCE, left to right, consuming each escape
 *     pair whole.
 *
 * Malformed input is REFUSED rather than quietly yielding nothing: a file with no calendar in it, or
 * one whose every entry is unusable, throws {@link IcsParseError}. Silently importing zero events
 * looks identical to importing an empty calendar, and the reader cannot tell which happened.
 */

// #region Limits
/**
 * Hard ceilings on what one file may contain.
 *
 * A calendar export is user-supplied and can legitimately be enormous (a decade of a busy schedule),
 * so the parser bounds its own work rather than trusting the picker to have done it. Exceeding a
 * limit is a WARNING plus truncation, not a refusal — importing the first thousand entries of a
 * subscription feed is a useful outcome, where refusing the whole file is not.
 */
export const ICS_MAX_BYTES = 5 * 1024 * 1024;
export const ICS_MAX_EVENTS = 2000;

/**
 * Whether a string's UTF-8 encoding exceeds `limit` BYTES.
 *
 * `String.length` counts UTF-16 code units, which is not what the ceiling is denominated in and is
 * never larger than the byte count — a calendar written in Japanese is three bytes per unit, so a
 * 12 MB file walked straight past a 5 MB ceiling. The picker's own pre-check measures `File.size`,
 * i.e. real bytes, so the two gates disagreed on exactly the files that matter.
 *
 * Counted rather than encoded, and short-circuited the moment the limit is passed: allocating a
 * second copy of a file we are about to refuse is the work the ceiling exists to avoid.
 */
function exceedsUtf8Bytes(text: string, limit: number): boolean {
	let bytes = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
			const low = text.charCodeAt(i + 1);
			// A real surrogate PAIR is one 4-byte character; a lone high surrogate is not, and stepping
			// over the next unit on its account would undercount the rest of the file.
			if (low >= 0xdc00 && low <= 0xdfff) {
				bytes += 4;
				i++;
			} else bytes += 3;
		} else bytes += 3;
		if (bytes > limit) return true;
	}
	return false;
}
// #endregion

// #region Errors
/** A file that could not be read as a calendar at all. */
export class IcsParseError extends Error {
	/** A machine-readable cause, so a surface can choose its own words without matching on prose. */
	readonly code: IcsRefusalCode;

	constructor(code: IcsRefusalCode, message: string) {
		super(message);
		this.name = "IcsParseError";
		this.code = code;
	}
}

/** Why a file was refused. */
export type IcsRefusalCode =
	| "empty"
	| "not_a_calendar"
	| "unterminated"
	| "no_events"
	| "too_large";

/** The refusal copy, written once so the parser and every surface say the same thing. */
export const ICS_REFUSAL_COPY: Record<IcsRefusalCode, string> = {
	empty: "That file is empty.",
	not_a_calendar: "That is not an iCalendar file — it has no BEGIN:VCALENDAR line.",
	unterminated: "That calendar file is truncated: an event begins but never ends.",
	no_events: "That calendar file contains no events that could be read.",
	too_large: "That calendar file is too large to read.",
};
// #endregion

// #region Parsed shapes
/** One `VEVENT`, decoded but not yet projected onto a surface. */
export interface IcsEvent {
	/** The `UID` — stable across re-exports, so re-importing a file updates rather than duplicates. */
	uid: string;
	summary: string;
	description: string | null;
	location: string | null;
	/** Epoch ms (UTC) of the start. */
	start: number;
	/** Epoch ms (UTC) of the end. Always > {@link start}. */
	end: number;
	/** `DTSTART;VALUE=DATE` — a whole-day entry with no wall-clock time of its own. */
	allDay: boolean;
	/** The raw `STATUS` value (`TENTATIVE` · `CONFIRMED` · `CANCELLED`), or `null` when absent. */
	status: string | null;
}

/** What one file yielded. */
export interface IcsImport {
	/** The `X-WR-CALNAME` a producer usually writes, or `null`. */
	calendarName: string | null;
	events: IcsEvent[];
	/**
	 * Everything that was skipped or assumed, in reading order.
	 *
	 * Warnings are not failures — an entry with no start is dropped and the rest of the file is still
	 * worth having — but they must be SHOWN, because "23 of 25 events imported" is the difference
	 * between a successful import and one that quietly lost two meetings.
	 */
	warnings: string[];
}

/** How the parsed entries are projected onto the calendar's own event shape. */
export interface IcsProjection {
	/**
	 * The zone a FLOATING time (no `Z`, no `TZID`) is resolved in. RFC 5545 says such a value is
	 * local to wherever it is read, so the only honest answer is the schedule's own zone; defaults to
	 * UTC, which is the one choice that never silently shifts an instant by a hidden amount.
	 */
	timezone?: string;
	/** The kind imported entries take on the grid. Defaults to `general`. */
	kind?: CalendarEventKind;
	/** The source slug stamped on every imported entry (drives the provider mark). Defaults to `ics`. */
	source?: string;
	/** Prefix for the generated event ids, so two imports cannot collide. Defaults to `ics`. */
	idPrefix?: string;
}
// #endregion

// #region Line handling
/**
 * Normalise line endings and UNFOLD (§3.1).
 *
 * Order matters: the fold marker is `CRLF` followed by a single space or tab, so the endings are
 * normalised to `\n` first and the continuation is then removed as `\n[ \t]`. Splitting into fields
 * before this runs is the single most common way an importer mangles a long description.
 */
export function unfoldIcsLines(text: string): string[] {
	const normalised = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
	return normalised.split("\n").filter((line) => line.length > 0);
}

/**
 * Unescape one iCalendar TEXT value (§3.3.11) in a SINGLE left-to-right pass.
 *
 * A chain of `String.replace` calls cannot do this correctly in either order — see the module note.
 * An unknown escape (`\q`) yields the escaped character itself, which is what every tolerant reader
 * does and is strictly better than dropping it.
 */
export function icsUnescape(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch !== "\\") {
			out += ch;
			continue;
		}
		const next = value[i + 1];
		if (next === undefined) {
			// A trailing lone backslash is not an escape; emit it rather than losing the character.
			out += "\\";
			break;
		}
		i++;
		if (next === "n" || next === "N") out += "\n";
		else out += next;
	}
	return out;
}

/** One decoded content line: its property name, its parameters, and its raw (still escaped) value. */
interface IcsLine {
	name: string;
	params: Record<string, string>;
	value: string;
}

/**
 * Split `NAME;PARAM=VALUE;OTHER="a;b":the value` into its three parts.
 *
 * The scan is character-by-character because a parameter value may be QUOTED and a quoted value may
 * contain both `;` and `:` — a `line.indexOf(":")` therefore cuts some real-world Outlook exports in
 * the middle of a `CN="Surname, Given: Team"` parameter.
 */
function parseIcsLine(line: string): IcsLine | null {
	let quoted = false;
	let colon = -1;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') quoted = !quoted;
		else if (ch === ":" && !quoted) {
			colon = i;
			break;
		}
	}
	if (colon < 0) return null;

	const head = line.slice(0, colon);
	const value = line.slice(colon + 1);

	const segments: string[] = [];
	let buf = "";
	quoted = false;
	for (let i = 0; i < head.length; i++) {
		const ch = head[i];
		if (ch === '"') {
			quoted = !quoted;
			continue;
		}
		if (ch === ";" && !quoted) {
			segments.push(buf);
			buf = "";
			continue;
		}
		buf += ch;
	}
	segments.push(buf);

	const name = (segments.shift() ?? "").trim().toUpperCase();
	if (!name) return null;

	const params: Record<string, string> = {};
	for (const segment of segments) {
		const eq = segment.indexOf("=");
		if (eq <= 0) continue;
		params[segment.slice(0, eq).trim().toUpperCase()] = segment.slice(eq + 1).trim();
	}
	return { name, params, value };
}
// #endregion

// #region Time
const DAY_MS = 86_400_000;

const zoneFormatterCache = new Map<string, Intl.DateTimeFormat | null>();

/**
 * An `Intl.DateTimeFormat` pinned to `tz`, or `null` when the runtime does not know that zone.
 *
 * Cached because a calendar file repeats the same `TZID` on every entry and constructing a formatter
 * is the expensive part of this whole parser.
 */
function zoneFormatter(tz: string): Intl.DateTimeFormat | null {
	if (zoneFormatterCache.has(tz)) return zoneFormatterCache.get(tz) ?? null;
	let fmt: Intl.DateTimeFormat | null = null;
	try {
		fmt = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
	} catch {
		// An unknown or malformed TZID is a fact about the file, not a reason to fail: the caller
		// falls back to UTC and warns.
		fmt = null;
	}
	zoneFormatterCache.set(tz, fmt);
	return fmt;
}

/** The offset (ms) `tz` is ahead of UTC at the instant `ms`. */
function zoneOffsetAt(ms: number, fmt: Intl.DateTimeFormat): number {
	const map: Record<string, string> = {};
	for (const part of fmt.formatToParts(new Date(ms))) {
		if (part.type !== "literal") map[part.type] = part.value;
	}
	const hour = map.hour === "24" ? "0" : map.hour;
	return Date.UTC(
		Number(map.year),
		Number(map.month) - 1,
		Number(map.day),
		Number(hour),
		Number(map.minute),
		Number(map.second),
	) - ms;
}

/**
 * Resolve a WALL-CLOCK time in `tz` to an epoch instant, DST-corrected.
 *
 * Two passes, because the offset depends on the instant we are trying to find: the first guess uses
 * the offset at the naive UTC reading, and the second re-reads the offset at that corrected instant
 * and applies it if it differs — which is exactly what happens on the two days a year the zone
 * changes. The same two-pass correction the calendar engine's own `core/time.ts` uses; it is
 * restated here rather than imported because `packages/types` may not depend on `packages/ui`.
 */
function wallClockToEpoch(
	y: number,
	mo: number,
	d: number,
	h: number,
	mi: number,
	s: number,
	tz: string,
): number | null {
	const fmt = zoneFormatter(tz);
	if (!fmt) return null;
	const guess = Date.UTC(y, mo - 1, d, h, mi, s);
	const first = zoneOffsetAt(guess, fmt);
	let epoch = guess - first;
	const second = zoneOffsetAt(epoch, fmt);
	if (second !== first) epoch = guess - second;
	return epoch;
}

/** A decoded `DTSTART`/`DTEND`/`RECURRENCE-ID` value. */
interface IcsInstant {
	ms: number;
	allDay: boolean;
	/** True when the value carried neither `Z` nor a usable `TZID` and had to be resolved somewhere. */
	floating: boolean;
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

/**
 * Decode one date or date-time property value.
 *
 * Three forms exist and they mean genuinely different things: a `VALUE=DATE` is a whole day with no
 * time in it, a trailing `Z` is an absolute instant, and everything else is a wall-clock reading that
 * only becomes an instant once a zone is chosen.
 */
function parseIcsInstant(line: IcsLine, fallbackTz: string): IcsInstant | null {
	const raw = line.value.trim();

	if (line.params.VALUE === "DATE" || DATE_RE.test(raw)) {
		const m = DATE_RE.exec(raw);
		if (!m) return null;
		const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		// Anchored at LOCAL midnight in the display zone, like every timed value on this path — a
		// `Date.UTC` anchor is midnight somewhere else, and `MonthGrid` tests a cell with
		// `start < dayMidnight + DAY && end > dayMidnight` against ZONED midnights, so an all-day
		// entry imported in any zone behind UTC matched two cells and drew itself on two days.
		return {
			ms: wallClockToEpoch(y, mo, d, 0, 0, 0, fallbackTz) ?? Date.UTC(y, mo - 1, d),
			allDay: true,
			floating: false,
		};
	}

	const m = DATE_TIME_RE.exec(raw);
	if (!m) return null;
	const [, y, mo, d, h, mi, s, zulu] = m;
	const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;

	if (zulu) return { ms: Date.UTC(...parts), allDay: false, floating: false };

	const tzid = line.params.TZID;
	if (tzid) {
		const resolved = wallClockToEpoch(
			Number(y),
			Number(mo),
			Number(d),
			Number(h),
			Number(mi),
			Number(s),
			tzid,
		);
		if (resolved !== null) return { ms: resolved, allDay: false, floating: false };
	}

	const resolved = wallClockToEpoch(
		Number(y),
		Number(mo),
		Number(d),
		Number(h),
		Number(mi),
		Number(s),
		fallbackTz,
	);
	return {
		ms: resolved ?? Date.UTC(...parts),
		allDay: false,
		floating: true,
	};
}

const DURATION_RE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** Decode an RFC 5545 `DURATION` into milliseconds, or `null` when it is not one. */
export function parseIcsDuration(value: string): number | null {
	const m = DURATION_RE.exec(value.trim().toUpperCase());
	if (!m) return null;
	const [, sign, w, d, h, mi, s] = m;
	const ms = (Number(w ?? 0) * 7 + Number(d ?? 0)) * DAY_MS +
		Number(h ?? 0) * 3_600_000 +
		Number(mi ?? 0) * 60_000 +
		Number(s ?? 0) * 1000;
	if (ms === 0 && !w && !d && !h && !mi && !s) return null;
	return sign === "-" ? -ms : ms;
}
// #endregion

// #region Parse
/**
 * Read one `.ics` document.
 *
 * Throws {@link IcsParseError} when the file is not a calendar or yields nothing usable; an
 * individual entry that cannot be read is skipped with a warning, because one broken `VEVENT` in a
 * year's export is not a reason to refuse the other three hundred.
 *
 * `VTIMEZONE`, `VTODO`, `VJOURNAL`, `VALARM` and `VFREEBUSY` components are stepped over rather than
 * parsed — a `VALARM` in particular nests INSIDE a `VEVENT` and carries its own `DESCRIPTION`, which
 * a flat scanner would happily overwrite the event's with.
 */
export function parseIcsCalendar(text: string, options: { timezone?: string } = {}): IcsImport {
	if (exceedsUtf8Bytes(text, ICS_MAX_BYTES)) {
		throw new IcsParseError("too_large", ICS_REFUSAL_COPY.too_large);
	}
	if (!text.trim()) throw new IcsParseError("empty", ICS_REFUSAL_COPY.empty);

	const fallbackTz = options.timezone ?? "UTC";
	const lines = unfoldIcsLines(text);
	const warnings: string[] = [];
	const events: IcsEvent[] = [];
	let calendarName: string | null = null;
	let sawCalendar = false;
	let truncated = false;

	/** The component nesting, so a nested `VALARM` never writes into the event around it. */
	const stack: string[] = [];
	let current: Partial<Record<string, IcsLine>> | null = null;

	for (const raw of lines) {
		const line = parseIcsLine(raw);
		if (!line) continue;

		if (line.name === "BEGIN") {
			const component = line.value.trim().toUpperCase();
			stack.push(component);
			if (component === "VCALENDAR") sawCalendar = true;
			if (component === "VEVENT" && stack.length === 2) current = {};
			continue;
		}

		if (line.name === "END") {
			const component = line.value.trim().toUpperCase();
			const open = stack.pop();
			if (open !== component) {
				throw new IcsParseError("unterminated", ICS_REFUSAL_COPY.unterminated);
			}
			if (component === "VEVENT" && current) {
				if (events.length >= ICS_MAX_EVENTS) truncated = true;
				else {
					const built = buildEvent(current, fallbackTz, warnings, events.length);
					if (built) events.push(built);
				}
				current = null;
			}
			continue;
		}

		// Only properties DIRECTLY on the VEVENT are collected — `stack` is [VCALENDAR, VEVENT] there,
		// and anything deeper belongs to a nested component.
		if (current && stack.length === 2) {
			// First occurrence wins: a repeated property is invalid, and taking the first keeps the
			// result stable rather than dependent on file order.
			if (!current[line.name]) current[line.name] = line;
			continue;
		}
		if (!current && line.name === "X-WR-CALNAME") calendarName = icsUnescape(line.value).trim();
	}

	if (!sawCalendar) throw new IcsParseError("not_a_calendar", ICS_REFUSAL_COPY.not_a_calendar);
	if (stack.length > 0) throw new IcsParseError("unterminated", ICS_REFUSAL_COPY.unterminated);
	if (truncated) {
		warnings.push(
			`Only the first ${ICS_MAX_EVENTS} events were read — the file contains more.`,
		);
	}
	if (events.length === 0) throw new IcsParseError("no_events", ICS_REFUSAL_COPY.no_events);

	return { calendarName: calendarName || null, events, warnings };
}

/** Turn one collected `VEVENT`'s properties into an {@link IcsEvent}, or `null` when unusable. */
function buildEvent(
	props: Partial<Record<string, IcsLine>>,
	fallbackTz: string,
	warnings: string[],
	index: number,
): IcsEvent | null {
	const summaryLine = props.SUMMARY;
	const label = summaryLine ? icsUnescape(summaryLine.value).trim() : "";
	const named = label || `Event ${index + 1}`;

	const startLine = props.DTSTART;
	if (!startLine) {
		warnings.push(`“${named}” was skipped: it has no start time.`);
		return null;
	}
	const start = parseIcsInstant(startLine, fallbackTz);
	if (!start) {
		warnings.push(`“${named}” was skipped: its start time could not be read.`);
		return null;
	}
	if (start.floating) {
		warnings.push(`“${named}” had no timezone; it was read in ${fallbackTz}.`);
	}

	let endMs: number | null = null;
	const endLine = props.DTEND;
	if (endLine) {
		const end = parseIcsInstant(endLine, fallbackTz);
		if (end) endMs = end.ms;
	} else if (props.DURATION) {
		const ms = parseIcsDuration(props.DURATION.value);
		if (ms !== null && ms > 0) endMs = start.ms + ms;
	}
	if (endMs === null) {
		// §3.6.1: an entry with neither DTEND nor DURATION lasts one day when it is a DATE, and is
		// instantaneous otherwise. A zero-width block cannot be drawn, so a timed one takes an hour —
		// the same assumption every calendar client makes, stated rather than hidden.
		endMs = start.allDay ? start.ms + DAY_MS : start.ms + 3_600_000;
	}
	if (endMs <= start.ms) endMs = start.ms + (start.allDay ? DAY_MS : 3_600_000);

	const uidLine = props.UID;
	const uid = uidLine ? icsUnescape(uidLine.value).trim() : "";

	return {
		uid: uid || `${start.ms}-${index}@imported`,
		summary: named,
		description: props.DESCRIPTION ? icsUnescape(props.DESCRIPTION.value) : null,
		location: props.LOCATION ? icsUnescape(props.LOCATION.value) : null,
		start: start.ms,
		end: endMs,
		allDay: start.allDay,
		status: props.STATUS ? props.STATUS.value.trim().toUpperCase() : null,
	};
}
// #endregion

// #region Projection
/**
 * Project decoded entries onto the calendar's own {@link CalendarEvent} shape.
 *
 * Deliberately separate from {@link parseIcsCalendar}: reading the file is a fact about the file,
 * and deciding what KIND the entries are on this grid is a decision about the surface. Keeping them
 * apart is what lets the parser be tested against the format alone.
 *
 * `CANCELLED` is carried through as a status rather than dropped — an imported cancellation is
 * information, and a cancelled block renders struck through rather than absent.
 */
export function icsEventsToCalendarEvents(
	events: readonly IcsEvent[],
	projection: IcsProjection = {},
): CalendarEvent[] {
	const kind = projection.kind ?? "general";
	const source = projection.source ?? "ics";
	const prefix = projection.idPrefix ?? "ics";

	return events.map((event, i) => {
		const status = event.status === "CANCELLED"
			? "cancelled" as const
			: event.status === "TENTATIVE"
			? "tentative" as const
			: "confirmed" as const;
		const item: CalendarEvent = {
			// The UID is the stable identity, but it is user-supplied and may be long or repeated, so
			// the index keeps two entries sharing one UID (a recurrence expansion) addressable.
			id: `${prefix}-${i}-${event.uid}`.slice(0, 120),
			title: event.summary.slice(0, 200),
			kind,
			status,
			start: event.start,
			end: event.end,
			sources: [source],
		};
		if (event.allDay) item.allDay = true;
		if (event.location) item.location = event.location.slice(0, 160);
		if (event.description) item.description = event.description.slice(0, 8000);
		return item;
	});
}
// #endregion
