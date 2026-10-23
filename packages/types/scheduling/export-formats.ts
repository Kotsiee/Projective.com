import { icsEscape, icsFold } from "../finance/order.ts";
import { addDays, dateInZone, wallClockInZone } from "./civil.ts";
import type { CalendarEvent, CalendarEventKind, CalendarEventStatus } from "./scheduling.ts";

/**
 * scheduling.export-formats — the calendar WRITER: a set of entries as one iCalendar document
 * (RFC 5545), as the same document in JSON (jCal, RFC 7265), or as a spreadsheet CSV.
 *
 * `.ics` and jCal are two spellings of ONE component tree built by {@link calendarComponentFor}, so
 * the two files cannot disagree about what an entry contains; the JSON is not a second mapping that
 * drifts from the first. CSV is a flat projection with its own columns and is written separately.
 *
 * One document holds every entry. Concatenated single-event `VCALENDAR`s are legal as a stream, but
 * Google Calendar and Outlook import only the first object in a file, so a multi-entry export written
 * that way silently arrives as one meeting.
 *
 * Pure: the stamp and the zone are passed in.
 */

// #region Shapes
/** The value types this writer emits. */
export type IcsValueType = "text" | "date" | "date-time" | "uri" | "cal-address";

/**
 * One property, values DECODED: escaping is the serialiser's job, so the jCal spelling and the `.ics`
 * spelling are read from the same string. A `date` is `YYYY-MM-DD`; a `date-time` is
 * `YYYY-MM-DDTHH:MM:SSZ` (jCal's own form; `.ics` drops the separators).
 */
export interface IcsProperty {
	name: string;
	params: Record<string, string>;
	type: IcsValueType;
	values: string[];
}

/** One component and everything nested in it. */
export interface IcsComponent {
	name: string;
	properties: IcsProperty[];
	components: IcsComponent[];
}

/** A jCal property: `[name, params, type, ...values]`. */
export type JCalProperty = [string, Record<string, string>, string, ...string[]];

/** A jCal component: `[name, properties, components]`. */
export type JCalComponent = [string, JCalProperty[], JCalComponent[]];

/** How a set of entries is written. */
export interface CalendarExportOptions {
	/** The calendar's display zone: all-day dates and the CSV wall clock are read in it. */
	timezone: string;
	/** `DTSTAMP` — the moment the document is written, ISO. */
	stampIso: string;
	/** `X-WR-CALNAME`, the name most clients give the imported calendar. */
	calendarName?: string;
	/** The site origin, so a same-origin `href` and an organiser's profile become absolute links. */
	origin?: string;
}

/** The `CATEGORIES` value each kind is written with. */
export const CALENDAR_EXPORT_CATEGORY: Record<CalendarEventKind, string> = {
	deadline: "Deadline",
	milestone: "Milestone",
	sync: "Meeting",
	session: "Session",
	booking: "Booking",
	availability: "Open slot",
	busy: "Busy",
	holiday: "Time off",
	general: "Other",
};

const STATUS_OF: Partial<Record<CalendarEventStatus, string>> = {
	confirmed: "CONFIRMED",
	tentative: "TENTATIVE",
	cancelled: "CANCELLED",
};
// #endregion

// #region Component tree
function cleanText(value: string): string {
	// deno-lint-ignore no-control-regex
	return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

function prop(
	name: string,
	type: IcsValueType,
	value: string | string[],
	params: Record<string, string> = {},
): IcsProperty {
	const values = Array.isArray(value) ? value : [value];
	return { name, params, type, values: type === "text" ? values.map(cleanText) : values };
}

function utcDateTime(ms: number): string {
	return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function absoluteHref(href: string, origin: string | undefined): string | null {
	if (!origin || !href.startsWith("/") || href.startsWith("//")) return null;
	return `${origin.replace(/\/$/, "")}${href}`;
}

function veventFor(event: CalendarEvent, options: CalendarExportOptions): IcsComponent {
	const properties: IcsProperty[] = [
		prop("UID", "text", `${event.id}@projective`),
		prop("DTSTAMP", "date-time", utcDateTime(Date.parse(options.stampIso))),
	];
	if (event.allDay) {
		const first = dateInZone(event.start, options.timezone);
		const last = event.end > event.start ? dateInZone(event.end - 1, options.timezone) : first;
		properties.push(prop("DTSTART", "date", first), prop("DTEND", "date", addDays(last, 1)));
	} else {
		properties.push(
			prop("DTSTART", "date-time", utcDateTime(event.start)),
			prop("DTEND", "date-time", utcDateTime(Math.max(event.end, event.start + 60_000))),
		);
	}
	properties.push(prop("SUMMARY", "text", event.title));
	if (event.meta) properties.push(prop("DESCRIPTION", "text", event.meta));
	if (event.location) properties.push(prop("LOCATION", "text", event.location));
	const status = event.status ? STATUS_OF[event.status] : undefined;
	if (status) properties.push(prop("STATUS", "text", status));
	if (event.status === "available") properties.push(prop("TRANSP", "text", "TRANSPARENT"));
	properties.push(prop("CATEGORIES", "text", CALENDAR_EXPORT_CATEGORY[event.kind]));
	const url = event.href ? absoluteHref(event.href, options.origin) : null;
	if (url) properties.push(prop("URL", "uri", url));
	const organiser = event.organiser;
	const profile = organiser?.handle ? absoluteHref(`/${organiser.handle}`, options.origin) : null;
	if (organiser && profile) {
		properties.push(prop("ORGANIZER", "cal-address", profile, { CN: organiser.name }));
	}
	return { name: "VEVENT", properties, components: [] };
}

/**
 * Every entry in one `VCALENDAR`, in the order given.
 *
 * Timed entries are written in UTC, which every reader resolves identically; all-day entries as
 * `VALUE=DATE` days in the calendar's zone, `DTEND` exclusive. A deadline is an INSTANT (`end ===
 * start`) and gets a one-minute `DTEND` — RFC 5545 §3.8.2.2 requires DTEND to be later than DTSTART
 * and several desktop clients refuse the whole file otherwise; the minute exists only in the file.
 *
 * `DESCRIPTION` is the strapline (`meta`), never the rich agenda body, whose markup TEXT escaping
 * would carry into the file verbatim — the same rule the per-entry download applies. `URL` and
 * `ORGANIZER` are written only as absolute same-origin links, and only when an origin is given.
 */
export function calendarComponentFor(
	events: readonly CalendarEvent[],
	options: CalendarExportOptions,
): IcsComponent {
	const properties = [
		prop("VERSION", "text", "2.0"),
		prop("PRODID", "text", "-//Projective//Calendar//EN"),
		prop("CALSCALE", "text", "GREGORIAN"),
		prop("METHOD", "text", "PUBLISH"),
	];
	if (options.calendarName) properties.push(prop("X-WR-CALNAME", "text", options.calendarName));
	properties.push(prop("X-WR-TIMEZONE", "text", options.timezone));
	return {
		name: "VCALENDAR",
		properties,
		components: events.map((event) => veventFor(event, options)),
	};
}
// #endregion

// #region Serialisers
function paramValue(value: string): string {
	const clean = value.replace(/["\r\n]/g, "");
	return /[;:,]/.test(clean) ? `"${clean}"` : clean;
}

function valueText(type: IcsValueType, value: string): string {
	if (type === "text") return icsEscape(value);
	if (type === "date") return value.replaceAll("-", "");
	if (type === "date-time") return value.replace(/[-:]/g, "");
	return value;
}

function propertyLine(p: IcsProperty): string {
	const params = p.type === "date" ? { ...p.params, VALUE: "DATE" } : p.params;
	const head = [p.name, ...Object.entries(params).map(([k, v]) => `${k}=${paramValue(v)}`)];
	return `${head.join(";")}:${p.values.map((v) => valueText(p.type, v)).join(",")}`;
}

function contentLines(c: IcsComponent): string[] {
	return [
		`BEGIN:${c.name}`,
		...c.properties.map(propertyLine),
		...c.components.flatMap(contentLines),
		`END:${c.name}`,
	];
}

/** The component as an RFC 5545 document: escaped, folded at 75 octets, CRLF-terminated. */
export function serialiseIcsComponent(component: IcsComponent): string {
	return contentLines(component).map(icsFold).join("\r\n") + "\r\n";
}

/** The component as jCal (RFC 7265): lower-case names and parameter keys, values unescaped. */
export function toJCal(component: IcsComponent): JCalComponent {
	return [
		component.name.toLowerCase(),
		component.properties.map((p): JCalProperty => [
			p.name.toLowerCase(),
			Object.fromEntries(Object.entries(p.params).map(([k, v]) => [k.toLowerCase(), v])),
			p.type,
			...p.values,
		]),
		component.components.map(toJCal),
	];
}
// #endregion

// #region CSV
/**
 * The CSV header — the columns Google Calendar and Outlook both import, in their order. `All Day Event`
 * is the one column beyond the date and text fields, because without it an all-day entry imports as
 * a midnight-to-midnight meeting.
 */
export const CALENDAR_CSV_COLUMNS = [
	"Subject",
	"Start Date",
	"Start Time",
	"End Date",
	"End Time",
	"All Day Event",
	"Description",
	"Location",
] as const;

function csvCell(value: string): string {
	const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function clock(minute: number): string {
	return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/**
 * Entries as CSV: ISO dates and 24-hour times on the wall clock of `timezone`, one row each, CRLF.
 *
 * ISO dates rather than `MM/DD/YYYY` because a spreadsheet reads them the same in every locale and
 * they sort as text. An all-day entry leaves both times empty and gives its LAST day as the end, the
 * inclusive convention both importers expect; an instant ends when it starts.
 *
 * Cells are RFC 4180 quoted, and spreadsheet formula injection is neutralised: a title is written by
 * whoever made the entry — a collaborator, or a file somebody imported — and a cell opening with `=`,
 * `+`, `-`, `@`, tab or CR is EXECUTED by Excel and Sheets on open. The OWASP remedy is a leading
 * apostrophe, which spreadsheets hide and treat as "this is text".
 */
export function toCalendarCsv(
	events: readonly CalendarEvent[],
	options: { timezone: string },
): string {
	const rows: string[][] = [[...CALENDAR_CSV_COLUMNS]];
	for (const e of events) {
		const start = wallClockInZone(e.start, options.timezone);
		const description = e.meta ?? "";
		const location = e.location ?? "";
		if (e.allDay) {
			const last = e.end > e.start ? dateInZone(e.end - 1, options.timezone) : start.date;
			rows.push([e.title, start.date, "", last, "", "True", description, location]);
			continue;
		}
		const end = wallClockInZone(Math.max(e.end, e.start), options.timezone);
		rows.push([
			e.title,
			start.date,
			clock(start.minute),
			end.date,
			clock(end.minute),
			"False",
			description,
			location,
		]);
	}
	return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
// #endregion
