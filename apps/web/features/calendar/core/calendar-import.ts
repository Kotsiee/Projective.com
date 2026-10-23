import type { CalendarEvent } from "@projective/types/scheduling";
import {
	ICS_MAX_BYTES,
	ICS_REFUSAL_COPY,
	icsEventsToCalendarEvents,
	IcsParseError,
	parseIcsCalendar,
} from "@projective/types/scheduling";

/**
 * calendar-import — what `/calendar` does with a calendar file, kept out of the popover so it can be
 * tested: refuse the wrong file before reading a byte of it, read the right one through the SSOT
 * parser, and project what came back onto the grid's own event shape.
 *
 * The parsing itself is `@projective/types/scheduling` `ics.ts` — the one reader the fat service also
 * calls — so this module decides only what the SURFACE decides: which files it offers to read, how far
 * a repeating entry is expanded around today, and how a second import of the same file lands.
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

/** One file, read and projected, waiting for the reader to confirm it. */
export interface CalendarImportPreview {
	fileName: string;
	/** The calendar's own name (`X-WR-CALNAME`), else the file's. */
	calendarName: string;
	format: "icalendar" | "vcalendar";
	/** The entries as the grid draws them, earliest first. */
	events: CalendarEvent[];
	warnings: string[];
	/** The id prefix every entry from this file carries — what a re-import replaces. */
	idPrefix: string;
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
 * A short, fixed-length id prefix for one file NAME.
 *
 * Hashed rather than slugged: two slugs can be prefixes of each other (`work` and `work-ics`), so a
 * re-import of one would have replaced the other's entries. FNV-1a is enough — this separates a
 * reader's own files, it is not a security boundary.
 */
export function importIdPrefix(fileName: string): string {
	let hash = 0x811c9dc5;
	for (const ch of fileName.toLowerCase()) {
		hash ^= ch.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193);
	}
	return `ics-${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

/** Read calendar TEXT into a preview. Pure; {@link readCalendarFile} is the same with the file I/O. */
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
		});
		const idPrefix = importIdPrefix(fileName);
		const events = icsEventsToCalendarEvents(result.events, { source: "ics", idPrefix })
			.sort((a, b) => a.start - b.start);
		return {
			ok: true,
			preview: {
				fileName,
				calendarName: result.calendarName ?? fileName,
				format: result.format,
				events,
				warnings: result.warnings,
				idPrefix,
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

/**
 * Add a preview to what is already imported. Importing the same file again REPLACES its earlier
 * entries rather than drawing every meeting twice — the UID promise `IcsEvent` makes, kept at the
 * level of the file because the grid's ids are per occurrence.
 */
export function mergeImported(
	existing: readonly CalendarEvent[],
	preview: CalendarImportPreview,
): CalendarEvent[] {
	const prefix = `${preview.idPrefix}-`;
	return [...existing.filter((e) => !e.id.startsWith(prefix)), ...preview.events];
}
// #endregion
