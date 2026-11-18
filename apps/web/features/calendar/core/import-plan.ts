import {
	type AvailabilityBehavior,
	type CalendarEvent,
	civilParts,
	dateInZone,
	ENTRY_BATCH_MAX,
	type EntryFields,
	type EntryRoom,
	expandRRule,
	type IcsEvent,
	type IsoDate,
	parseRRule,
	serialiseRRule,
	wallClockInZone,
	weekdayOf,
} from "@projective/types/scheduling";
import { checkJoinLink } from "./meeting-link.ts";

/**
 * import-plan — how a calendar file becomes NATIVE Projective entries (Decision #442).
 *
 * A file is read into {@link ImportItem}s (one per occurrence), then planned into
 * {@link ImportGroup}s: a series the file itself declared (`RRULE`, kept whole by UID), a run of
 * identical entries detected as one ({@link inferRule}), or a single entry. The reader can then merge
 * groups into a repeating entry, put them in a new routine, split a series back into singles, or
 * leave a group out, and the plan is laid down as create batches for the ONE event door
 * (`POST /api/scheduling/events`) — which keeps every entry as the host's own, fully editable.
 *
 * Every rule this module writes is checked against the platform's own expander (`expandRRule`) and
 * the platform's own grammar (`parseRRule`: a date `UNTIL`, no `COUNT`), so a series it lays down is
 * read back by the calendar exactly as it was planned. Pure and DOM-free, so `deno test` covers it.
 */

// #region Constants
/** Above this many entries a file is reviewed in the import modal before anything is saved. */
export const IMPORT_REVIEW_THRESHOLD = 8;

/** The fewest identical entries that are merged into one repeating entry without being asked. */
export const AUTO_MERGE_MIN = 3;

const TITLE_MAX = 200;
const LOCATION_MAX = 160;
const AGENDA_MAX = 8000;
// #endregion

// #region Shapes
/** One occurrence the file holds, as the import reads it. */
export interface ImportItem {
	/** Stable within one plan. */
	key: string;
	uid: string;
	title: string;
	/** Plain text, or the producer's HTML. */
	description: string | null;
	location: string | null;
	start: number;
	end: number;
	allDay: boolean;
	/** The file's own repeat rule, on every occurrence of a declared series. */
	rrule: string | null;
	/** A join link the file named. */
	url: string | null;
}

/** Where a group came from, which is what the review says about it. */
export type ImportGroupOrigin = "file" | "detected" | "merged" | "single";

/** One thing the import lays down: a single entry, or one repeating entry. */
export interface ImportGroup {
	id: string;
	origin: ImportGroupOrigin;
	/** Ascending by start. */
	items: readonly ImportItem[];
	/**
	 * The repeat rule a series is laid down with, unbounded (each batch adds its own `UNTIL`); `null`
	 * for a single entry.
	 */
	rule: string | null;
	/** How many of its items are already on the calendar; those are never written twice. */
	duplicates: number;
	/** Whether the reader is importing it. A group wholly on the calendar starts left out. */
	included: boolean;
	/** The new routine it goes into ({@link ImportRoutineDraft.key}), or `null`. */
	routine: string | null;
}

/** A routine the import creates first, for the groups the reader put in it. */
export interface ImportRoutineDraft {
	key: string;
	name: string;
	behavior: AvailabilityBehavior;
}

/** The reviewable import. Every operation below returns a new plan. */
export interface ImportPlan {
	groups: readonly ImportGroup[];
	routines: readonly ImportRoutineDraft[];
	/** Item keys already on the calendar. */
	onCalendar: ReadonlySet<string>;
	/** Cancelled entries in the file, which are not imported. */
	cancelled: number;
	/** Exact copies inside the file, imported once. */
	copies: number;
}

/** One create the plan sends: one series, or up to {@link ENTRY_BATCH_MAX} single entries. */
export interface ImportBatch {
	entries: EntryFields[];
	room: EntryRoom | null;
	/** The routine draft the entries join, created before this batch is sent. */
	routine: ImportRoutineDraft | null;
}
// #endregion

// #region Reading
/** The file's occurrences as items. A cancelled entry is counted, not imported. */
export function importItemsOf(
	events: readonly IcsEvent[],
): { items: ImportItem[]; cancelled: number } {
	const items: ImportItem[] = [];
	let cancelled = 0;
	for (const [i, e] of events.entries()) {
		if (e.status === "CANCELLED") {
			cancelled++;
			continue;
		}
		items.push({
			key: `i${i}`,
			uid: e.uid,
			title: e.summary,
			description: e.description,
			location: e.location,
			start: e.start,
			end: e.end,
			allDay: e.allDay,
			rrule: e.rrule ?? null,
			url: e.url ?? null,
		});
	}
	items.sort((a, b) => a.start - b.start || a.end - b.end);
	return { items, cancelled };
}

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** What makes two entries the same entry: the title and the exact span. */
function sameEntryKey(title: string, start: number, end: number): string {
	return `${norm(title)}\u0000${start}\u0000${end}`;
}
// #endregion

// #region Rules
const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function daysBetween(a: IsoDate, b: IsoDate): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function monthsBetween(a: IsoDate, b: IsoDate): number {
	const x = civilParts(a);
	const y = civilParts(b);
	return (y.year - x.year) * 12 + (y.month - x.month);
}

/** Whether `rule`, anchored on the first date and stopped at the last, yields exactly `dates`. */
function yieldsExactly(rule: string, dates: readonly IsoDate[]): boolean {
	const first = dates[0];
	const last = dates[dates.length - 1];
	const parsed = parseRRule(`${rule};UNTIL=${last.replaceAll("-", "")}`);
	if (!parsed.ok) return false;
	const got = expandRRule(parsed.value, first, { from: first, to: last }, dates.length + 1);
	return got.length === dates.length && got.every((d, i) => d === dates[i]);
}

/**
 * The simplest repeat rule whose occurrences are EXACTLY these entries' dates, or `null`.
 *
 * Tried in order of how plainly a person would say it: every n days, every n weeks on a set of
 * weekdays, monthly on a day or on an nth weekday, every n years. Each candidate is checked by
 * expanding it, so a rule is only ever offered for a set it reproduces with nothing missing and
 * nothing extra. Two entries on one date are never a series.
 *
 * `repeated` asks for evidence that the pattern actually repeats — what an UNPROMPTED merge needs.
 * Any few dates inside one week are "weekly on those days" by construction, so with it each weekday of
 * a weekly rule must recur. A reader merging by hand has already said the entries belong together.
 */
export function inferRule(
	items: readonly Pick<ImportItem, "start">[],
	tz: string,
	opts: { repeated?: boolean } = {},
): string | null {
	const dates = items.map((i) => dateInZone(i.start, tz)).sort();
	if (dates.length < 2 || new Set(dates).size !== dates.length) return null;
	const [a, b] = dates;
	const candidates: string[] = [];

	// A gap of whole weeks reads as weekly, which the candidates below already say better.
	const dayGap = daysBetween(a, b);
	if (dayGap % 7 !== 0) {
		candidates.push(dayGap === 1 ? "FREQ=DAILY" : `FREQ=DAILY;INTERVAL=${dayGap}`);
	}

	const weekdays = [...new Set(dates.map((d) => weekdayOf(d)))].sort((x, y) => x - y);
	const byDay = weekdays.map((w) => WEEKDAY[w]).join(",");
	const recurs = weekdays.every((w) => dates.filter((d) => weekdayOf(d) === w).length >= 2);
	if (!opts.repeated || recurs) {
		for (const interval of [1, 2, 3, 4]) {
			candidates.push(`FREQ=WEEKLY${interval > 1 ? `;INTERVAL=${interval}` : ""};BYDAY=${byDay}`);
		}
	}

	const monthGap = monthsBetween(a, b);
	if (monthGap > 0) {
		// Whole years first: "every year" is how a person says a twelve-month step.
		if (monthGap % 12 === 0) {
			const years = monthGap / 12;
			candidates.push(`FREQ=YEARLY${years > 1 ? `;INTERVAL=${years}` : ""}`);
		}
		const step = monthGap > 1 ? `;INTERVAL=${monthGap}` : "";
		const { day } = civilParts(a);
		candidates.push(`FREQ=MONTHLY${step};BYMONTHDAY=${day}`);
		const nth = Math.ceil(day / 7);
		candidates.push(`FREQ=MONTHLY${step};BYDAY=${nth}${WEEKDAY[weekdayOf(a)]}`);
		candidates.push(`FREQ=MONTHLY${step};BYDAY=-1${WEEKDAY[weekdayOf(a)]}`);
	}

	for (const rule of candidates) {
		if (yieldsExactly(rule, dates)) return normaliseRule(rule);
	}
	return null;
}

/**
 * A file's rule in the platform's own grammar, without its bound: `COUNT` and `UNTIL` dropped (the
 * occurrences the file yielded are the bound), the rest parsed and re-serialised. `null` when the
 * platform cannot read it, and the series is then imported as single entries.
 */
export function normaliseRule(rule: string): string | null {
	const kept = rule.trim().replace(/^RRULE:/i, "").split(";").map((s) => s.trim())
		.filter((s) => s && !/^(COUNT|UNTIL)=/i.test(s));
	const parsed = parseRRule(kept.join(";"));
	return parsed.ok ? serialiseRRule(parsed.value) : null;
}

/** A rule bounded at the date of the last occurrence one batch lays down. */
function boundedRule(rule: string, lastStart: number, tz: string): string {
	return `${rule};UNTIL=${dateInZone(lastStart, tz).replaceAll("-", "")}`;
}
// #endregion

// #region Planning
/**
 * Plan a file: dedupe against the calendar and within the file, keep each declared series whole, and
 * merge a run of {@link AUTO_MERGE_MIN} or more identical entries — same title, agenda, place, time of
 * day and length — into one repeating entry where one rule reproduces their dates.
 */
export function buildImportPlan(
	read: { items: readonly ImportItem[]; cancelled: number },
	existing: readonly CalendarEvent[],
	tz: string,
): ImportPlan {
	const onFile = new Set<string>();
	const calendarKeys = new Set(existing.map((e) => sameEntryKey(e.title, e.start, e.end)));
	const onCalendar = new Set<string>();
	const items: ImportItem[] = [];
	let copies = 0;
	for (const item of read.items) {
		const key = sameEntryKey(item.title, item.start, item.end);
		if (onFile.has(key)) {
			copies++;
			continue;
		}
		onFile.add(key);
		items.push(item);
		if (calendarKeys.has(key)) onCalendar.add(item.key);
	}

	const groups: ImportGroup[] = [];
	let n = 0;
	const group = (origin: ImportGroupOrigin, members: ImportItem[], rule: string | null) => {
		const duplicates = members.filter((m) => onCalendar.has(m.key)).length;
		groups.push({
			id: `g${n++}`,
			origin,
			items: members,
			rule,
			duplicates,
			included: duplicates < members.length,
			routine: null,
		});
	};

	// 1. The file's own series, by UID, kept whole.
	const loose: ImportItem[] = [];
	const series = new Map<string, ImportItem[]>();
	for (const item of items) {
		if (!item.rrule) {
			loose.push(item);
			continue;
		}
		const list = series.get(item.uid);
		if (list) list.push(item);
		else series.set(item.uid, [item]);
	}
	for (const members of series.values()) {
		const rule = members.length > 1 ? normaliseRule(members[0].rrule ?? "") : null;
		if (rule) group("file", members, rule);
		else loose.push(...members);
	}

	// 2. Runs of identical entries.
	const runs = new Map<string, ImportItem[]>();
	for (const item of loose) {
		const { minute } = wallClockInZone(item.start, tz);
		const sig = [
			norm(item.title),
			item.allDay ? "d" : `t${minute}`,
			item.end - item.start,
			norm(item.description),
			norm(item.location),
		].join("\u0000");
		const list = runs.get(sig);
		if (list) list.push(item);
		else runs.set(sig, [item]);
	}
	for (const members of runs.values()) {
		const rule = members.length >= AUTO_MERGE_MIN
			? inferRule(members, tz, { repeated: true })
			: null;
		if (rule) group("detected", members, rule);
		else for (const m of members) group("single", [m], null);
	}

	groups.sort((x, y) => x.items[0].start - y.items[0].start);
	return { groups, routines: [], onCalendar, cancelled: read.cancelled, copies };
}

/** The outcome of an operation that can be refused. */
export type PlanChange = { ok: true; plan: ImportPlan } | { ok: false; message: string };

function withGroups(plan: ImportPlan, groups: ImportGroup[]): ImportPlan {
	// A routine nobody is going into any more is not created.
	const used = new Set(groups.map((g) => g.routine).filter(Boolean));
	return { ...plan, groups, routines: plan.routines.filter((r) => used.has(r.key)) };
}

function freshId(plan: ImportPlan): string {
	let i = plan.groups.length;
	while (plan.groups.some((g) => g.id === `g${i}`)) i++;
	return `g${i}`;
}

/**
 * Merge the chosen groups into ONE repeating entry, where one rule reproduces every date they cover.
 * Refused, with the reason, when they do not follow one pattern — a routine is the answer then.
 */
export function mergeGroups(plan: ImportPlan, ids: readonly string[], tz: string): PlanChange {
	const chosen = plan.groups.filter((g) => ids.includes(g.id));
	const items = chosen.flatMap((g) => g.items).sort((a, b) => a.start - b.start);
	if (items.length < 2) return { ok: false, message: "Choose at least two entries to merge." };
	const rule = inferRule(items, tz);
	if (!rule) {
		return {
			ok: false,
			message: "These dates don’t follow one repeating pattern. Put them in a routine instead, " +
				"or import them separately.",
		};
	}
	const routines = new Set(chosen.map((g) => g.routine));
	const merged: ImportGroup = {
		id: freshId(plan),
		origin: "merged",
		items,
		rule,
		duplicates: items.filter((m) => plan.onCalendar.has(m.key)).length,
		included: true,
		routine: routines.size === 1 ? [...routines][0] : null,
	};
	const at = plan.groups.findIndex((g) => ids.includes(g.id));
	const rest = plan.groups.filter((g) => !ids.includes(g.id));
	rest.splice(Math.min(at, rest.length), 0, merged);
	return { ok: true, plan: withGroups(plan, rest) };
}

/** Split a series back into single entries ("Import separately"). */
export function splitGroup(plan: ImportPlan, id: string): ImportPlan {
	const target = plan.groups.find((g) => g.id === id);
	if (!target || target.items.length < 2) return plan;
	let next = plan.groups.length;
	const singles = target.items.map((item): ImportGroup => ({
		id: `g${next++}-${item.key}`,
		origin: "single",
		items: [item],
		rule: null,
		duplicates: plan.onCalendar.has(item.key) ? 1 : 0,
		included: target.included && !plan.onCalendar.has(item.key),
		routine: target.routine,
	}));
	return withGroups(plan, plan.groups.flatMap((g) => (g.id === id ? singles : [g])));
}

/** Import, or leave out, the chosen groups. */
export function setIncluded(
	plan: ImportPlan,
	ids: readonly string[],
	included: boolean,
): ImportPlan {
	return withGroups(
		plan,
		plan.groups.map((g) => (ids.includes(g.id) ? { ...g, included } : g)),
	);
}

/** Put the chosen groups in a new routine, created when the import runs. */
export function assignRoutine(
	plan: ImportPlan,
	ids: readonly string[],
	routine: { name: string; behavior: AvailabilityBehavior },
): PlanChange {
	const name = routine.name.trim();
	if (!name) return { ok: false, message: "Name the routine first." };
	if (!plan.groups.some((g) => ids.includes(g.id))) {
		return { ok: false, message: "Choose the entries to put in it." };
	}
	let i = plan.routines.length;
	while (plan.routines.some((r) => r.key === `r${i}`)) i++;
	const draft: ImportRoutineDraft = { key: `r${i}`, name, behavior: routine.behavior };
	const groups = plan.groups.map((g) =>
		ids.includes(g.id) ? { ...g, routine: draft.key, included: true } : g
	);
	return { ok: true, plan: withGroups({ ...plan, routines: [...plan.routines, draft] }, groups) };
}

/** Take the chosen groups out of the routine the import was going to put them in. */
export function clearRoutine(plan: ImportPlan, ids: readonly string[]): ImportPlan {
	return withGroups(
		plan,
		plan.groups.map((g) => (ids.includes(g.id) ? { ...g, routine: null } : g)),
	);
}

/** What the plan will write. */
export interface ImportTally {
	/** Entries that will be created. */
	entries: number;
	series: number;
	singles: number;
	routines: number;
	/** Entries left out because they are already on the calendar. */
	onCalendar: number;
}

/** Count what {@link importBatches} would write. */
export function tallyPlan(plan: ImportPlan): ImportTally {
	let entries = 0;
	let series = 0;
	let singles = 0;
	for (const g of plan.groups) {
		if (!g.included) continue;
		const fresh = g.items.length - g.duplicates;
		if (fresh <= 0) continue;
		entries += fresh;
		if (g.rule && fresh > 1) series++;
		else singles += fresh;
	}
	const routines = new Set(
		plan.groups.filter((g) => g.included && g.routine).map((g) => g.routine),
	);
	return { entries, series, singles, routines: routines.size, onCalendar: plan.onCalendar.size };
}
// #endregion

// #region Laying it down
function clip(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) : s;
}

const LOOKS_LIKE_HTML = /<\/?(p|br|a|b|i|u|strong|em|ul|ol|li|div|span|h[1-6])\b[^>]*>/i;

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(
		/"/g,
		"&quot;",
	);
}

function paragraphs(text: string): string {
	return text.trim().split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
		.join("");
}

/**
 * A file's description as the agenda the editor writes: a producer's HTML as it is (the door
 * sanitises), plain text as paragraphs with its line breaks kept. Within the agenda's ceiling: plain
 * text is shortened before it is wrapped, so a tag is never cut in half.
 */
export function agendaHtml(text: string): string | undefined {
	const source = text.replace(/\r\n?/g, "\n");
	if (!source.trim()) return undefined;
	if (LOOKS_LIKE_HTML.test(source)) return clip(source, AGENDA_MAX);
	let body = source;
	let html = paragraphs(body);
	while (html.length > AGENDA_MAX && body.length > 0) {
		body = body.slice(0, Math.max(0, body.length - (html.length - AGENDA_MAX) - 1));
		html = paragraphs(body);
	}
	return html;
}

const URL_IN_TEXT = /https:\/\/[^\s<>"')]+/gi;
/** The longest join link the event door stores (`EntryRoomSchema.link`). */
const LINK_MAX = 600;

/** A link the door can store as a room, with the provider it belongs to, or `null`. */
function roomLink(raw: string, knownOnly: boolean): EntryRoom | null {
	const link = raw.trim();
	if (link.length > LINK_MAX || !/^https:\/\/\S+$/.test(link)) return null;
	const check = checkJoinLink(link);
	if (!check.ok || (knownOnly && check.provider === "custom")) return null;
	return { provider: check.provider, link, passcode: null };
}

/**
 * The room a file's entry names: its own join link (`URL`, Google's conference field, or a location
 * that is a bare link) on any https host, else the first link in its location or agenda on a known
 * meeting provider. A link that names no provider is not guessed at from prose.
 */
export function importRoomOf(
	item: Pick<ImportItem, "url" | "location" | "description">,
): EntryRoom | null {
	for (const raw of [item.url, item.location]) {
		const room = raw ? roomLink(raw, false) : null;
		if (room) return room;
	}
	for (const text of [item.location, item.description]) {
		for (const found of (text ?? "").match(URL_IN_TEXT) ?? []) {
			const room = roomLink(found, true);
			if (room) return room;
		}
	}
	return null;
}

/**
 * One item as the fields the event door writes: an Event, or a Reminder when it has no length, holding
 * its time, with the file's agenda and place. Every one is the host's own and edits like any other.
 */
export function entryFieldsOf(item: ImportItem): EntryFields {
	const instant = item.end <= item.start;
	const fields: EntryFields = {
		title: clip(item.title.trim() || "Untitled event", TITLE_MAX),
		kind: instant ? "general" : "sync",
		start: item.start,
		end: Math.max(item.end, item.start),
		availabilityBehavior: "disruptive",
	};
	if (item.allDay && !instant) fields.allDay = true;
	const location = item.location?.trim();
	if (location) fields.location = clip(location, LOCATION_MAX);
	const agenda = item.description ? agendaHtml(item.description) : undefined;
	if (agenda) fields.description = agenda;
	return fields;
}

/**
 * The plan as create batches, in time order: each series in batches of at most
 * {@link ENTRY_BATCH_MAX} (each batch its own bounded master, so nothing the file held is lost to the
 * door's cap), and single entries packed together per room and routine. Entries already on the
 * calendar are left out.
 */
export function importBatches(plan: ImportPlan, tz: string): ImportBatch[] {
	const routines = new Map(plan.routines.map((r) => [r.key, r]));
	const batches: ImportBatch[] = [];
	const pools = new Map<string, ImportBatch>();

	for (const g of plan.groups) {
		if (!g.included) continue;
		const fresh = g.items.filter((m) => !plan.onCalendar.has(m.key));
		if (fresh.length === 0) continue;
		const routine = g.routine ? routines.get(g.routine) ?? null : null;

		if (g.rule && fresh.length > 1) {
			for (let i = 0; i < fresh.length; i += ENTRY_BATCH_MAX) {
				const chunk = fresh.slice(i, i + ENTRY_BATCH_MAX);
				const entries = chunk.map(entryFieldsOf);
				if (chunk.length > 1) {
					entries[0].recurrenceRule = boundedRule(g.rule, chunk[chunk.length - 1].start, tz);
				}
				batches.push({ entries, room: roomFor(chunk[0]), routine });
			}
			continue;
		}

		for (const item of fresh) {
			const room = roomFor(item);
			if (room) {
				batches.push({ entries: [entryFieldsOf(item)], room, routine });
				continue;
			}
			const key = routine?.key ?? "";
			let pool = pools.get(key);
			if (!pool || pool.entries.length >= ENTRY_BATCH_MAX) {
				pool = { entries: [], room: null, routine };
				pools.set(key, pool);
				batches.push(pool);
			}
			pool.entries.push(entryFieldsOf(item));
		}
	}
	return batches;
}

/** A room only for an Event: a Reminder has no length to meet in. */
function roomFor(item: ImportItem): EntryRoom | null {
	return item.end > item.start && !item.allDay ? importRoomOf(item) : null;
}
// #endregion
