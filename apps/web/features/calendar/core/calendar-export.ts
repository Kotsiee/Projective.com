import type {
	CalendarEvent,
	CalendarEventKind,
	CalendarEventStatus,
} from "@projective/types/scheduling";
import {
	calendarComponentFor,
	dateInZone,
	serialiseIcsComponent,
	toCalendarCsv,
	toJCal,
} from "@projective/types/scheduling";

/**
 * calendar-export — which entries the `/calendar` export modal writes, and the file it writes them to.
 *
 * Choosing and writing are pure and live here so they are tested once; the modal only holds the
 * reader's choices and hands the result to `calendar-download.ts`, the one module that touches the DOM.
 * The FORMATS are the SSOT's (`@projective/types/scheduling` `export-formats.ts`), so a file written
 * here reads back through the same parser the import uses.
 *
 * **What "all events" means.** The agenda is a window the server loaded, not a person's whole
 * history, plus whatever they imported this session. The modal says so and shows the span it actually
 * matched; nothing here pretends to a range it does not hold.
 *
 * **A privacy-masked block is never written**, whatever the filters say. It carries only "Busy" and
 * stands for somebody else's commitment; putting it in a file that leaves the application is the leak
 * the mask exists to prevent. It is counted, so the modal can say how many were left out.
 */

// #region Vocabulary
/** The three files the modal writes. */
export type ExportFormat = "ics" | "jcal" | "csv";

/** One format's name, purpose and file facts. */
export interface ExportFormatSpec {
	value: ExportFormat;
	label: string;
	description: string;
	extension: string;
	mime: string;
}

export const EXPORT_FORMATS: readonly ExportFormatSpec[] = [
	{
		value: "ics",
		label: "iCalendar (.ics)",
		description: "Google Calendar, Outlook, Apple Calendar",
		extension: "ics",
		mime: "text/calendar;charset=utf-8",
	},
	{
		value: "jcal",
		label: "JSON · jCal (.json)",
		description: "The same calendar as JSON (RFC 7265), for scripts and tools",
		extension: "json",
		mime: "application/calendar+json;charset=utf-8",
	},
	{
		value: "csv",
		label: "CSV (.csv)",
		description: "Excel, Numbers, Google Sheets",
		extension: "csv",
		mime: "text/csv;charset=utf-8",
	},
];

/** Which part of the agenda is written. */
export type ExportRange = "all" | "upcoming" | "past" | "custom";

export const EXPORT_RANGES: readonly { value: ExportRange; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "upcoming", label: "Upcoming" },
	{ value: "past", label: "Past" },
	{ value: "custom", label: "Custom" },
];

/** The statuses an entry can be filtered by. An entry with none is `confirmed`, as the grid draws it. */
export type ExportStatus = CalendarEventStatus;

export const EXPORT_STATUS_LABEL: Record<ExportStatus, string> = {
	confirmed: "Confirmed",
	tentative: "Tentative",
	cancelled: "Cancelled",
	busy: "Busy",
	available: "Available",
};

/** The reader's choices. Every list is an ALLOW list of values that were offered. */
export interface ExportCriteria {
	range: ExportRange;
	/** Custom range, epoch ms, both inclusive. Read only when `range` is `custom`. */
	from: number | null;
	to: number | null;
	kinds: readonly CalendarEventKind[];
	statuses: readonly ExportStatus[];
	sources: readonly string[];
	/** One organiser's key ({@link organiserKey}), or `null` for anyone. */
	organiser: string | null;
}
// #endregion

// #region Facets
/** The organiser an entry is filtered under: their handle, else their name. */
export function organiserKey(event: CalendarEvent): string | null {
	return event.organiser ? event.organiser.handle ?? event.organiser.name : null;
}

function statusOf(event: CalendarEvent): ExportStatus {
	return event.status ?? "confirmed";
}

/** What the agenda actually contains — the modal offers only these, never an option that matches nothing. */
export interface ExportFacets {
	kinds: CalendarEventKind[];
	statuses: ExportStatus[];
	sources: string[];
	organisers: { key: string; name: string }[];
}

/** Every facet value present on the exportable (unmasked) entries, in first-seen order. */
export function exportFacets(events: readonly CalendarEvent[]): ExportFacets {
	const facets: ExportFacets = { kinds: [], statuses: [], sources: [], organisers: [] };
	for (const e of events) {
		if (e.masked) continue;
		if (!facets.kinds.includes(e.kind)) facets.kinds.push(e.kind);
		const status = statusOf(e);
		if (!facets.statuses.includes(status)) facets.statuses.push(status);
		for (const s of e.sources ?? []) if (!facets.sources.includes(s)) facets.sources.push(s);
		const key = organiserKey(e);
		if (key && e.organiser && !facets.organisers.some((o) => o.key === key)) {
			facets.organisers.push({ key, name: e.organiser.name });
		}
	}
	return facets;
}
// #endregion

// #region Selection
/** Why the custom range cannot be used, or `null` when it can (or is not in use). */
export function customRangeError(criteria: ExportCriteria): string | null {
	if (criteria.range !== "custom") return null;
	if (criteria.from === null || criteria.to === null) return "Choose both a start and an end.";
	if (criteria.from > criteria.to) return "The start is after the end.";
	return null;
}

function inRange(event: CalendarEvent, criteria: ExportCriteria, now: number): boolean {
	const last = Math.max(event.start, event.end);
	if (criteria.range === "upcoming") return last >= now;
	if (criteria.range === "past") return last < now;
	if (criteria.range === "custom") {
		if (criteria.from === null || criteria.to === null) return false;
		return event.start <= criteria.to && last >= criteria.from;
	}
	return true;
}

function onChosenCalendar(event: CalendarEvent, sources: readonly string[]): boolean {
	if (!event.sources || event.sources.length === 0) return true;
	return event.sources.some((s) => sources.includes(s));
}

/** What the criteria select, earliest first, and how many masked blocks were left out. */
export interface ExportSelection {
	events: CalendarEvent[];
	withheld: number;
}

/**
 * Apply every criterion. `now` is the moment of the export: "upcoming" is measured against it, and
 * includes an entry still in progress.
 *
 * The Calendars facet follows the header band's LAYER rule: an entry is kept while any calendar it is
 * on is chosen, and is never dropped for having no calendar named at all.
 */
export function selectForExport(
	events: readonly CalendarEvent[],
	criteria: ExportCriteria,
	now: number,
): ExportSelection {
	const chosen: CalendarEvent[] = [];
	let withheld = 0;
	for (const e of events) {
		if (!inRange(e, criteria, now)) continue;
		if (e.masked) {
			withheld++;
			continue;
		}
		if (!criteria.kinds.includes(e.kind)) continue;
		if (!criteria.statuses.includes(statusOf(e))) continue;
		if (!onChosenCalendar(e, criteria.sources)) continue;
		if (criteria.organiser !== null && organiserKey(e) !== criteria.organiser) continue;
		chosen.push(e);
	}
	chosen.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
	return { events: chosen, withheld };
}
// #endregion

// #region Files
/** A written file, ready to hand over. */
export interface ExportFile {
	content: string;
	filename: string;
	mime: string;
}

/** What writing depends on beyond the entries. */
export interface ExportContext {
	timezone: string;
	/** The moment of writing: the `DTSTAMP`, and the date in the file name. */
	now: number;
	/** The site origin, so entry links and organisers become absolute. */
	origin?: string;
	calendarName?: string;
}

/**
 * Write `events` in `format`.
 *
 * The CSV opens with a byte-order mark: Excel reads a BOM-less CSV in the machine's legacy code page,
 * so every accented title in a UTF-8 file arrives as mojibake. Sheets and Numbers ignore the mark.
 */
export function buildExportFile(
	format: ExportFormat,
	events: readonly CalendarEvent[],
	context: ExportContext,
): ExportFile {
	const spec = EXPORT_FORMATS.find((f) => f.value === format) ?? EXPORT_FORMATS[0];
	const filename = `projective-calendar-${dateInZone(context.now, context.timezone)}.${spec.extension}`;
	if (format === "csv") {
		return {
			content: `﻿${toCalendarCsv(events, { timezone: context.timezone })}`,
			filename,
			mime: spec.mime,
		};
	}
	const component = calendarComponentFor(events, {
		timezone: context.timezone,
		stampIso: new Date(context.now).toISOString(),
		calendarName: context.calendarName,
		origin: context.origin,
	});
	const content = format === "jcal"
		? `${JSON.stringify(toJCal(component), null, 2)}\n`
		: serialiseIcsComponent(component);
	return { content, filename, mime: spec.mime };
}
// #endregion
