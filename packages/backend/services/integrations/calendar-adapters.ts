import { hmacSha256Hex } from "../sessions/presence/adapter.ts";
import { providerCall } from "./channels.ts";

/**
 * calendar-adapters — the provider's half of calendar sync (Decision #383, rulings R1 and R3): direct
 * Google Calendar and Microsoft Graph, and the only place their field names appear. Everything a
 * provider says is reduced to the shapes below, and those shapes are the privacy rule.
 *
 * **Coming in: a span, and {@link BusyDetails} for the owner alone (Decision #387).** A change has no
 * room for an attendee, and Google's `fields` keeps them off the wire too. Graph's
 * `calendarView/delta` cannot be narrowed (no `$select`), so they arrive and go no further than
 * {@link graphChange}.
 *
 * **Going out: a title, a time, a `/meet` address and whether it blocks time.** {@link googleCopy} and
 * {@link graphCopy} take a {@link MirrorEvent}, which has no agenda, location, attendee or provider link
 * to send, and no routine: a routine's entries go out flattened, as the plain events they are. A person
 * joins through Projective's own address, so a provider's link stays on the server.
 *
 * Provider copies are written and never read back: an edit made there is overwritten by the next change
 * here, so no version is compared and nothing is merged. Each write is idempotent, because the response
 * to one can be lost: Google's event id is chosen here, and Graph takes a `transactionId`.
 */

const GOOGLE = "https://www.googleapis.com/calendar/v3";
const GRAPH = "https://graph.microsoft.com";
const CALENDAR_NAME = "Projective";
/** Graph refuses a second calendar of one name, and a person's own "Projective" is never adopted. */
const CALENDAR_NAME_TAKEN = "Projective events";
const CALENDAR_NOTE =
	"Your Projective events. Changes made here are replaced by the next change on Projective.";
/** Guards a provider's paging against running past the job's budget. */
const MAX_PAGES = 100;
/** The most series one read looks up the repeat of. The rest get theirs from the next full read. */
const MAX_SERIES = 100;

// #region Shapes
/** One event as a read reports it: a span, a run of whole days, or that it no longer holds time. */
export type BusyChange =
	| { id: string; gone: true }
	| (BusyDetails & { id: string; starts_at: string; ends_at: string })
	| (BusyDetails & { id: string; start_date: string; end_date: string });

/** The stretch a full read covers. */
export interface SyncWindow {
	from: string;
	to: string;
}

/** What only an entry's owner reads (`scheduling.connected_event_details`). */
export interface BusyDetails {
	title?: string;
	location?: string;
	description?: string;
	/** The series this is one occurrence of. Every occurrence is its own change. */
	series_id?: string;
	/** That series' repeat, in RFC 5545 form with no `RRULE:` prefix. */
	recurrence_rule?: string;
	join_url?: string;
}

/** Everything a read found, and where the next one takes up. */
export interface BusyRead {
	changes: BusyChange[];
	cursor: string;
}

/** What a copy of an event or a discovery call says (`scheduling.claim_event_mirrors`). */
export interface MirrorEvent {
	title: string;
	tentative: boolean;
	/** A passive entry (Decision #389), which leaves its time free at the provider too. */
	transparent: boolean;
	all_day: boolean;
	starts_at: string;
	ends_at: string;
	/** The event's days in its schedule's zone, the last one exclusive. */
	start_date: string;
	end_date: string;
	room_slug: string | null;
}

/** A copy to write. */
export interface MirrorWrite {
	mirror_id: string;
	external_event_id: string | null;
	version: string | null;
	event: MirrorEvent;
}

/** A copy as the provider stored it. */
export interface WrittenCopy {
	externalId: string;
	version: string | null;
}

/** What calendar sync asks of a provider. */
export interface CalendarAdapter {
	/** The window (`cursor` null) or every change since `cursor`. A lapsed cursor refuses 410. */
	readBusy(accessToken: string, cursor: string | null, window: SyncWindow): Promise<BusyRead>;
	/** Make the separate Projective calendar, answering its id. */
	openCalendar(accessToken: string): Promise<string>;
	writeEvent(
		accessToken: string,
		calendarId: string,
		mirror: MirrorWrite,
		appUrl: string,
	): Promise<WrittenCopy>;
	/** Take a copy off. One already gone is not an error. */
	removeEvent(accessToken: string, calendarId: string, externalId: string): Promise<void>;
	/** Delete a calendar this adapter made, and every copy on it. */
	removeCalendar(accessToken: string, calendarId: string): Promise<void>;
}

/** A provider refused. It carries a status and nothing else, so it can be logged and shown to an owner. */
export class CalendarRefusal extends Error {
	constructor(slug: string, readonly status: number) {
		super(`${slug} answered ${status}`);
		this.name = "CalendarRefusal";
	}
}

/** The Projective calendar no longer exists at the provider, and every copy went with it. */
export class CalendarGone extends CalendarRefusal {}
// #endregion

// #region Reading
interface GoogleItem {
	id?: unknown;
	status?: string;
	transparency?: string;
	summary?: string;
	location?: string;
	description?: string;
	recurringEventId?: string;
	hangoutLink?: string;
	conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
	start?: { date?: string; dateTime?: string };
	end?: { date?: string; dateTime?: string };
}

interface GraphItem {
	id?: unknown;
	"@removed"?: unknown;
	isCancelled?: boolean;
	isAllDay?: boolean;
	showAs?: string;
	subject?: string;
	location?: { displayName?: string };
	seriesMasterId?: string;
	onlineMeeting?: { joinUrl?: string };
	start?: { dateTime?: string };
	end?: { dateTime?: string };
}

/** Graph's `showAs` values that leave a person free. Anything else, `unknown` too, holds the time. */
const GRAPH_FREE = new Set(["free", "workingElsewhere"]);

/** A change with what its owner alone reads, leaving out what the provider did not send. */
function detailed(change: BusyChange, details: Record<string, unknown>): BusyChange {
	const sent = Object.entries(details).filter(([, value]) => value && typeof value === "string");
	return { ...change, ...Object.fromEntries(sent) };
}

/** The rule in Google's `recurrence` lines. Its EXDATEs say which days, and the rows already are them. */
export function rruleOf(lines: unknown): string | null {
	if (!Array.isArray(lines)) return null;
	const line = lines.find((l) => typeof l === "string" && l.startsWith("RRULE:"));
	return line ? line.slice("RRULE:".length) : null;
}

/**
 * Give each series in a read its repeat. An occurrence does not carry it, only the series' master
 * does, so this is one more call per series. A miss costs a sentence, never the read.
 */
async function withSeriesRules(changes: BusyChange[], accessToken: string): Promise<BusyChange[]> {
	const series = new Set<string>();
	for (const change of changes) {
		if ("series_id" in change && change.series_id) series.add(change.series_id);
	}
	const rules = new Map<string, string>();
	for (const id of [...series].slice(0, MAX_SERIES)) {
		const url = new URL(`${GOOGLE}/calendars/primary/events/${encodeURIComponent(id)}`);
		url.searchParams.set("fields", "recurrence");
		const res = await providerCall(url.href, accessToken, "GET").catch(() => null);
		if (!res?.ok) {
			await res?.body?.cancel();
			continue;
		}
		const rule = rruleOf((await res.json()).recurrence);
		if (rule) rules.set(id, rule);
	}
	return changes.map((change) => {
		const rule = "series_id" in change && change.series_id
			? rules.get(change.series_id)
			: undefined;
		return rule ? { ...change, recurrence_rule: rule } : change;
	});
}

/** A timed span, or `null` for one no calendar could mean. */
function span(id: string, start: string, end: string): BusyChange | null {
	const from = Date.parse(start);
	const to = Date.parse(end);
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
	return { id, starts_at: new Date(from).toISOString(), ends_at: new Date(to).toISOString() };
}

/** A Google event as a change, or `null` when it cannot be read. */
export function googleChange(raw: unknown): BusyChange | null {
	const item = raw as GoogleItem | null;
	if (typeof item?.id !== "string") return null;
	if (item.status === "cancelled" || item.transparency === "transparent") {
		return { id: item.id, gone: true };
	}
	const change = item.start?.dateTime && item.end?.dateTime
		? span(item.id, item.start.dateTime, item.end.dateTime)
		: item.start?.date && item.end?.date
		? { id: item.id, start_date: item.start.date, end_date: item.end.date }
		: null;
	return change && detailed(change, {
		title: item.summary,
		location: item.location,
		description: item.description,
		series_id: item.recurringEventId,
		// Meet has its own field; an add-on such as Zoom writes only the conference's entry points.
		join_url: item.hangoutLink ??
			item.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri,
	});
}

/**
 * A Graph event as a change, or `null` when it cannot be read. Its times are UTC, because no `Prefer`
 * header asks otherwise. A whole day is a date there, whatever the zone says.
 */
export function graphChange(raw: unknown): BusyChange | null {
	const item = raw as GraphItem | null;
	if (typeof item?.id !== "string") return null;
	if (item["@removed"] || item.isCancelled || GRAPH_FREE.has(item.showAs ?? "")) {
		return { id: item.id, gone: true };
	}
	const start = item.start?.dateTime;
	const end = item.end?.dateTime;
	if (!start || !end) return null;
	const change = item.isAllDay
		? { id: item.id, start_date: start.slice(0, 10), end_date: end.slice(0, 10) }
		: span(item.id, `${start}Z`, `${end}Z`);
	// shortcut: an Outlook series lists once but states no pattern, because Graph keeps it on the master
	// as a structured object. Translate that to a rule once an account can prove it.
	return change && detailed(change, {
		title: item.subject,
		location: item.location?.displayName,
		series_id: item.seriesMasterId,
		join_url: item.onlineMeeting?.joinUrl,
	});
}

/** A successful answer's body, or the provider's refusal. */
// deno-lint-ignore no-explicit-any
async function accepted(slug: string, res: Response): Promise<any> {
	if (res.ok) return res.json();
	await res.body?.cancel();
	throw new CalendarRefusal(slug, res.status);
}

/** Drop an answer the next call replaces. */
async function dropped(res: Response): Promise<void> {
	await res.body?.cancel();
}

/** Accept a removal, or a copy or calendar that was already gone: 404, and 410 from Google. */
async function removed(slug: string, res: Response): Promise<void> {
	await dropped(res);
	if (!res.ok && res.status !== 404 && res.status !== 410) {
		throw new CalendarRefusal(slug, res.status);
	}
}
// #endregion

// #region What goes out
/** The words on a copy. The room's own address is the only link that ever leaves. */
function copyWords(event: MirrorEvent, appUrl: string) {
	return {
		title: event.title.trim() || "Projective event",
		description: event.room_slug ? `Join on Projective: ${appUrl}/meet/${event.room_slug}` : "",
	};
}

/** A Google event body. A PUT replaces the event, so this is all of it: `transparency` is RFC 5545 TRANSP. */
export function googleCopy(event: MirrorEvent, appUrl: string) {
	const { title, description } = copyWords(event, appUrl);
	return {
		summary: title,
		description,
		status: event.tentative ? "tentative" : "confirmed",
		transparency: event.transparent ? "transparent" : "opaque",
		start: event.all_day ? { date: event.start_date } : { dateTime: event.starts_at },
		end: event.all_day ? { date: event.end_date } : { dateTime: event.ends_at },
	};
}

/** A Graph event body. Graph takes a time with no offset beside its zone, and spells TRANSP `showAs`. */
export function graphCopy(event: MirrorEvent, appUrl: string) {
	const { title, description } = copyWords(event, appUrl);
	const utc = (at: string) => ({
		dateTime: new Date(at).toISOString().slice(0, 19),
		timeZone: "UTC",
	});
	return {
		subject: title,
		body: { contentType: "text", content: description },
		showAs: event.transparent ? "free" : event.tentative ? "tentative" : "busy",
		isAllDay: event.all_day,
		start: utc(event.all_day ? `${event.start_date}T00:00:00Z` : event.starts_at),
		end: utc(event.all_day ? `${event.end_date}T00:00:00Z` : event.ends_at),
	};
}
// #endregion

// #region Google
const google: CalendarAdapter = {
	async readBusy(accessToken, cursor, window) {
		const changes: BusyChange[] = [];
		let pageToken: string | undefined;
		for (let page = 0; page < MAX_PAGES; page++) {
			const url = new URL(`${GOOGLE}/calendars/primary/events`);
			url.search = new URLSearchParams({
				singleEvents: "true",
				showDeleted: "true",
				maxResults: "2500",
				fields:
					"items(id,status,transparency,summary,location,description,recurringEventId,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),start,end),nextPageToken,nextSyncToken",
				...(cursor ? { syncToken: cursor } : { timeMin: window.from, timeMax: window.to }),
				...(pageToken ? { pageToken } : {}),
			}).toString();
			const body = await accepted("google", await providerCall(url.href, accessToken, "GET"));
			for (const item of body.items ?? []) {
				const change = googleChange(item);
				if (change) changes.push(change);
			}
			if (body.nextSyncToken) {
				return { changes: await withSeriesRules(changes, accessToken), cursor: body.nextSyncToken };
			}
			pageToken = body.nextPageToken;
			if (!pageToken) break;
		}
		throw new CalendarRefusal("google", 502);
	},

	async openCalendar(accessToken) {
		const res = await providerCall(`${GOOGLE}/calendars`, accessToken, "POST", {
			summary: CALENDAR_NAME,
			description: CALENDAR_NOTE,
		});
		return (await accepted("google", res)).id;
	},

	async writeEvent(accessToken, calendarId, mirror, appUrl) {
		const copy = googleCopy(mirror.event, appUrl);
		const events = `${GOOGLE}/calendars/${encodeURIComponent(calendarId)}/events`;
		// A uuid's hex is inside Google's base32hex ids, so the id is known before the call.
		const id = mirror.external_event_id ?? mirror.mirror_id.replaceAll("-", "");
		const replace = () => providerCall(`${events}/${id}`, accessToken, "PUT", copy);
		const insert = () => providerCall(events, accessToken, "POST", { id, ...copy });

		let res = await (mirror.external_event_id ? replace() : insert());
		if (res.status === 409) {
			// An earlier insert landed and its answer was lost.
			await dropped(res);
			res = await replace();
		} else if (res.status === 404 && mirror.external_event_id) {
			await dropped(res);
			res = await insert();
		}
		if (res.status === 404) {
			await dropped(res);
			throw new CalendarGone("google", 404);
		}
		const written = await accepted("google", res);
		return { externalId: written.id, version: written.etag ?? null };
	},

	async removeEvent(accessToken, calendarId, externalId) {
		const calendar = encodeURIComponent(calendarId);
		const url = `${GOOGLE}/calendars/${calendar}/events/${encodeURIComponent(externalId)}`;
		await removed("google", await providerCall(url, accessToken, "DELETE"));
	},

	async removeCalendar(accessToken, calendarId) {
		const url = `${GOOGLE}/calendars/${encodeURIComponent(calendarId)}`;
		await removed("google", await providerCall(url, accessToken, "DELETE"));
	},
};
// #endregion

// #region Microsoft Graph
const outlook: CalendarAdapter = {
	async readBusy(accessToken, cursor, window) {
		const first = new URL(`${GRAPH}/v1.0/me/calendarView/delta`);
		first.search = new URLSearchParams({
			startDateTime: window.from,
			endDateTime: window.to,
		}).toString();
		const changes: BusyChange[] = [];
		let link: string = cursor ?? first.href;
		for (let page = 0; page < MAX_PAGES; page++) {
			// A link comes from outside and this call carries a token, so it only ever goes to Graph.
			if (!link.startsWith(`${GRAPH}/`)) break;
			const res = await providerCall(link, accessToken, "GET", undefined, {
				prefer: "odata.maxpagesize=100",
			});
			const body = await accepted("outlook", res);
			for (const item of body.value ?? []) {
				const change = graphChange(item);
				if (change) changes.push(change);
			}
			if (body["@odata.deltaLink"]) return { changes, cursor: body["@odata.deltaLink"] };
			link = body["@odata.nextLink"] ?? "";
		}
		throw new CalendarRefusal("outlook", 502);
	},

	async openCalendar(accessToken) {
		const open = (name: string) =>
			providerCall(`${GRAPH}/v1.0/me/calendars`, accessToken, "POST", { name });
		let res = await open(CALENDAR_NAME);
		if (res.status === 409) {
			await dropped(res);
			res = await open(CALENDAR_NAME_TAKEN);
		}
		return (await accepted("outlook", res)).id;
	},

	async writeEvent(accessToken, calendarId, mirror, appUrl) {
		const copy = graphCopy(mirror.event, appUrl);
		let res: Response | null = null;
		if (mirror.external_event_id) {
			const url = `${GRAPH}/v1.0/me/events/${encodeURIComponent(mirror.external_event_id)}`;
			res = await providerCall(url, accessToken, "PATCH", copy);
			if (res.status === 404) {
				await dropped(res);
				res = null;
			}
		}
		if (!res) {
			// The same id on a retry is what makes a create idempotent. A copy deleted at the provider
			// needs a new one, and a stored version is what tells the two apart.
			const transactionId = mirror.version
				? await hmacSha256Hex(mirror.mirror_id, mirror.version)
				: mirror.mirror_id;
			const url = `${GRAPH}/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`;
			res = await providerCall(url, accessToken, "POST", { ...copy, transactionId });
			if (res.status === 404) {
				await dropped(res);
				throw new CalendarGone("outlook", 404);
			}
		}
		const written = await accepted("outlook", res);
		return { externalId: written.id, version: written.changeKey ?? null };
	},

	async removeEvent(accessToken, _calendarId, externalId) {
		const url = `${GRAPH}/v1.0/me/events/${encodeURIComponent(externalId)}`;
		await removed("outlook", await providerCall(url, accessToken, "DELETE"));
	},

	async removeCalendar(accessToken, calendarId) {
		const url = `${GRAPH}/v1.0/me/calendars/${encodeURIComponent(calendarId)}`;
		await removed("outlook", await providerCall(url, accessToken, "DELETE"));
	},
};
// #endregion

/** Every provider calendar sync can run on, by `integrations.providers` slug. */
export const CALENDAR_ADAPTERS: Readonly<Record<string, CalendarAdapter | undefined>> = {
	google,
	outlook,
};
