import type { CalendarEvent, CalendarPage } from "@projective/types/scheduling";

/**
 * entity-calendar — the PURE half of a team's or business's console Calendar (Decision #308): which
 * projects it reads, and how their pages fold into one.
 *
 * An entity calendar is not a calendar of its own. It is the union of the calendars of the entity's
 * projects, each read by `readProjectCalendar` AS the viewer, so RLS decides which projects, meetings
 * and deadlines exist for them exactly as it does on `/projects/[id]/calendar`. Nothing here reads;
 * `live-calendar.ts` does the reads and hands the pages here.
 */

// #region Params
/** What an entity calendar is read for. */
export interface EntityCalendarParams {
	/**
	 * The entity's projects, by `prj-` slug — taken from the console's own detail read, never from a
	 * request. Duplicates and blanks are tolerated; {@link entityProjectIds} normalises them.
	 */
	projectIds: readonly string[];
	/** The entity's handle — the page's `projectId` (see `CalendarPageSchema`). */
	ref: string;
	/** The page title, e.g. the entity's name. */
	title: string;
}

/**
 * The most projects one entity calendar reads. Each project is a handful of round trips, and an
 * entity with more live engagements than this is paging its work elsewhere; the console's detail
 * read lists the live ones first.
 */
export const ENTITY_CALENDAR_PROJECTS_MAX = 40;

/** How many project calendars are read at once. */
export const ENTITY_CALENDAR_CONCURRENCY = 4;

/** The projects to read: trimmed, de-duplicated case-insensitively, in order, capped. */
export function entityProjectIds(
	ids: readonly string[],
	max: number = ENTITY_CALENDAR_PROJECTS_MAX,
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of ids) {
		const id = raw.trim();
		const key = id.toLowerCase();
		if (!id || seen.has(key)) continue;
		seen.add(key);
		out.push(id);
		if (out.length >= max) break;
	}
	return out;
}
// #endregion

// #region Pool
/**
 * `run` over `items` with at most `limit` in flight, answers in input order. A rejection rejects the
 * whole map — an entity calendar missing one project's events without saying so would be passed off
 * as the whole schedule.
 */
export async function mapPooled<T, R>(
	items: readonly T[],
	limit: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const at = next++;
			out[at] = await run(items[at]);
		}
	};
	const width = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: width }, worker));
	return out;
}
// #endregion

// #region Merge
/** What the merged page is stamped with beyond its events. */
export interface EntityCalendarMeta {
	ref: string;
	title: string;
	/** The reader's zone — the zone every project page was drawn in. */
	timezone: string;
	now: number;
}

function clampText(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** One project's event as the union shows it: owned by its project, linked to it, labelled with it. */
function entityEvent(event: CalendarEvent, page: CalendarPage): CalendarEvent {
	const project = page.title;
	return {
		...event,
		projectId: page.projectId,
		href: event.href ?? clampText(`/projects/${page.projectId}/calendar`, 400),
		meta: clampText(event.meta ? `${project} · ${event.meta}` : project, 160),
	};
}

/**
 * Fold the visible projects' pages into the entity's one page. Pure.
 *
 * - An event is kept once, by id: the first page to carry it owns it (a project read twice under two
 *   spellings of its slug cannot double an entry).
 * - Every event is stamped with its `projectId`, links to its project when it had no link of its own,
 *   and its meta line leads with the project's title — on a grid of several engagements, "Stage
 *   deadline" alone does not say whose.
 * - The viewer is the client only when they are the client of every project on it (a business's
 *   console); an empty page says `false`.
 * - `canCreate` is `false`: an entry belongs to one project, and the union has none to give it.
 */
export function mergeEntityCalendar(
	pages: readonly CalendarPage[],
	meta: EntityCalendarMeta,
): CalendarPage {
	const seen = new Set<string>();
	const events: CalendarEvent[] = [];
	for (const page of pages) {
		for (const event of page.events) {
			if (seen.has(event.id)) continue;
			seen.add(event.id);
			events.push(entityEvent(event, page));
		}
	}
	events.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
	return {
		scope: "entity",
		projectId: clampText(meta.ref, 120) || "entity",
		channelId: null,
		title: clampText(meta.title, 160),
		timezone: meta.timezone,
		viewerIsClient: pages.length > 0 && pages.every((p) => p.viewerIsClient),
		canCreate: false,
		events,
		now: meta.now,
	};
}
// #endregion
