import {
	ICS_MAX_BYTES,
	ICS_REFUSAL_COPY,
	IcsParseError,
	parseIcsCalendar,
} from "@projective/types/scheduling";
import { type ImportItem, importItemsOf } from "./import-plan.ts";

/**
 * calendar-import — what `/calendar` does with a calendar file, kept out of the popover and the drop
 * zone so it can be tested: refuse the wrong file before reading a byte of it, read the right one
 * through the SSOT parser, and hand back its occurrences for `import-plan.ts` to lay down as native
 * entries (Decision #442).
 *
 * The parsing itself is `@projective/types/scheduling` `ics.ts` — the one reader the fat service also
 * calls — so this module decides only what the SURFACE decides: which files it offers to read, how far
 * a repeating entry is expanded around today, and that a midnight-to-midnight block is a whole day.
 *
 * DOM-free: `deno test` type-checks without the DOM lib. The `File` it reads is Deno's as well as the
 * browser's.
 */

// #region Files
/** The extensions the picker offers. `.ical` is a common alias of `.ics`; `.vcs` is vCalendar 1.0. */
export const CALENDAR_IMPORT_EXTENSIONS = [".ics", ".ical", ".vcs"] as const;

/** The picker's `accept`: the extensions, plus the media types browsers report for them. */
export const CALENDAR_IMPORT_ACCEPT = [
	...CALENDAR_IMPORT_EXTENSIONS,
	"text/calendar",
	"text/x-vcalendar",
].join(",");

const CALENDAR_MEDIA_TYPES = new Set([
	"",
	"application/octet-stream",
	"text/plain",
	"text/calendar",
	"text/x-vcalendar",
	"text/vcalendar",
	"application/ics",
]);

/** The three facts about a file this module reads before opening it. */
export interface CalendarFileFacts {
	name: string;
	type: string;
	size: number;
}

/** A refusal the popover shows as-is, or permission to read. */
export type CalendarFileCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether `file` may be read at all: its extension, its media type and its size.
 *
 * An empty type, `application/octet-stream` and `text/plain` are accepted because they are what most
 * operating systems report for `.ical` and `.vcs`: a check that insisted on `text/calendar` would
 * refuse files the extension check had just accepted. What the media check exists to stop is a file
 * whose type positively says it is something else — an image or a PDF renamed `.ics`. Whether the
 * bytes are a calendar is the parser's question, and it refuses anything without `BEGIN:VCALENDAR`.
 */
export function checkCalendarFile(file: CalendarFileFacts): CalendarFileCheck {
	const name = file.name.toLowerCase();
	if (!CALENDAR_IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
		return { ok: false, message: "Choose a .ics, .ical or .vcs calendar file." };
	}
	const type = file.type.split(";")[0].trim().toLowerCase();
	if (!CALENDAR_MEDIA_TYPES.has(type)) {
		return { ok: false, message: `That file is marked as ${type}, not as a calendar.` };
	}
	if (file.size === 0) return { ok: false, message: ICS_REFUSAL_COPY.empty };
	if (file.size > ICS_MAX_BYTES) return { ok: false, message: ICS_REFUSAL_COPY.too_large };
	return { ok: true };
}

/**
 * What a drag that is still in the air says about its files, for the drop zone's highlight.
 *
 * A browser shows a dragged file's media TYPE before the drop but never its name, so this can only
 * refuse what positively names something else (an image, a PDF): `ok` for one file whose type is a
 * calendar's or is blank — {@link checkCalendarFile} decides on the drop — `wrong` for anything else,
 * and `none` when the drag carries no files at all (text, a link, a lane row), which the zone ignores.
 */
export function dragVerdict(
	items: readonly { kind: string; type: string }[],
): "ok" | "wrong" | "none" {
	const files = items.filter((i) => i.kind === "file");
	if (files.length === 0) return "none";
	if (files.length > 1) return "wrong";
	const type = files[0].type.split(";")[0].trim().toLowerCase();
	return CALENDAR_MEDIA_TYPES.has(type) ? "ok" : "wrong";
}
// #endregion

// #region Reading
/**
 * How far either side of now a REPEATING entry is expanded, in days.
 *
 * A series with no end is unbounded, so something has to stop it. A year each way covers the agenda's
 * own window with room to spare, and the parser says when it clipped a series rather than letting a
 * weekly meeting quietly stop on the grid.
 */
export const IMPORT_RECURRENCE_DAYS = 365;

const DAY_MS = 86_400_000;

/** One file, read, waiting to be planned and imported. */
export interface CalendarImportPreview {
	fileName: string;
	/** The calendar's own name (`X-WR-CALNAME`), else the file's. */
	calendarName: string;
	format: "icalendar" | "vcalendar";
	/** Every occurrence the file holds, earliest first, cancelled entries left out. */
	items: ImportItem[];
	/** Cancelled entries the file held, which are not imported. */
	cancelled: number;
	warnings: string[];
}

/** The outcome of reading a file: a preview, or the sentence that says why there is none. */
export type CalendarImportRead =
	| { ok: true; preview: CalendarImportPreview }
	| { ok: false; message: string };

/** What reading depends on that the file does not say. */
export interface CalendarImportContext {
	/** The surface's zone — floating times and all-day dates are read in it. */
	timezone: string;
	/** The moment of the import; the recurrence window is centred on it. */
	now: number;
}

/**
 * Read calendar TEXT into a preview. Pure; {@link readCalendarFile} is the same with the file I/O.
 * A timed block from midnight to a later midnight is read as the whole days it covers.
 */
export function previewCalendarText(
	text: string,
	fileName: string,
	context: CalendarImportContext,
): CalendarImportRead {
	try {
		const result = parseIcsCalendar(text, {
			timezone: context.timezone,
			recurrenceWindow: {
				from: context.now - IMPORT_RECURRENCE_DAYS * DAY_MS,
				to: context.now + IMPORT_RECURRENCE_DAYS * DAY_MS,
			},
			midnightSpansAllDay: true,
		});
		const { items, cancelled } = importItemsOf(result.events);
		if (items.length === 0) return { ok: false, message: "Every event in that file is cancelled." };
		return {
			ok: true,
			preview: {
				fileName,
				calendarName: result.calendarName ?? fileName,
				format: result.format,
				items,
				cancelled,
				warnings: result.warnings,
			},
		};
	} catch (error) {
		if (error instanceof IcsParseError) return { ok: false, message: error.message };
		throw error;
	}
}

/**
 * Check, read and preview one picked or dropped file.
 *
 * A failure to READ (the file moved, a permission was revoked) is a different fact from a file that is
 * not a calendar, and is reported in its own words rather than as "that is not a calendar".
 */
export async function readCalendarFile(
	file: File,
	context: CalendarImportContext,
): Promise<CalendarImportRead> {
	const check = checkCalendarFile(file);
	if (!check.ok) return check;
	let text: string;
	try {
		text = await file.text();
	} catch (error) {
		if (!(error instanceof DOMException)) throw error;
		return { ok: false, message: "That file could not be read from your device." };
	}
	return previewCalendarText(text, file.name, context);
}
// #endregion
