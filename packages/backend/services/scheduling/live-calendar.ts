import type { SupabaseClient } from "supabaseClient";
import type {
	AvailabilityRule,
	BlackoutDate,
	CalendarEvent,
	CalendarEventKind,
	CalendarEventStatus,
	CalendarPage,
	CalendarParams,
	EventAttendee,
	EventHistoryEntry,
	EventMeeting,
	EventReschedule,
	MeetingProvider,
	RescheduleProposal,
	SchedulePage,
	SchedulingParty,
	SchedulingTarget,
} from "@projective/types/scheduling";
import {
	eligibleVoterCount,
	MEETING_PROVIDER_LABEL,
	RESCHEDULE_PROPOSALS_MAX,
	rescheduleModeFor,
	settleVote,
} from "@projective/types/scheduling";
import type { AssetItem } from "@projective/types/files";
import { countsAsOnboarded } from "@projective/types/projects";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	fetchParties,
	partyOf,
	type PartyRow,
	resolveChannelRef,
	resolveProjectRef,
	UUID_RE,
} from "../projects/live-support.ts";
import { isClientSideRole } from "../projects/live-detail.ts";
import {
	fetchBoardPage,
	STAGE_WINDOW_COLUMNS,
	type StageWindowRow,
	stageWindows,
} from "../projects/live-board.ts";
import { ITEM_COLUMNS, type ItemRow, toAssetItem } from "../files/asset-row.ts";
import { emptyReschedule } from "./coordination-plan.ts";

/**
 * live-calendar — the PRIVATE calendars, read as the signed-in user: an engagement's calendar
 * (`/projects/[slug]/calendar`, `/projects/[slug]/[channel]/calendar`) and the acting account's own
 * agenda (`/calendar`), plus the single-event re-read every coordination write goes through.
 *
 * ## Where each entry comes from — nothing on these pages is derived from a hash
 *
 *  - **Meetings** are `scheduling.events` rows, with their roster, their reschedule rounds, their
 *    proposals and votes, their history and their attachments read from the six coordination tables
 *    (`00000022`). RLS decides which rows exist for this reader.
 *  - **Deadlines** are not rows of their own. A stage's due instant is the one the board resolves
 *    (`stageWindows`), and a ticket's is `projects.tickets.due_date` — and on the engagement calendar
 *    the tickets are the BOARD's own cards, so a ticket the board withholds from a provider (unpaid
 *    for its stage, or a stage they are not onboarded to) is withheld here too. A calendar that
 *    showed a deadline for a card the board hides would be leaking the card's title.
 *  - **Calls** on the personal agenda are `scheduling.discovery_calls` rows the viewer is a party to.
 *  - **Working hours, call windows and leave** are the viewer's own `scheduling.*` bands and
 *    blackouts, with every label (they are the owner's own).
 *
 * ## Seating is by identity
 *
 * `isViewer` is `attendee.user_id === actor.userId` and `viewerIsHost` is the host seat's user (the
 * creator when an event has no host seat). Nothing is compared by handle, and nothing a caller sent
 * is consulted. The service's privacy projection then reads this seating — a project member who is
 * not on a meeting's roster receives the meeting's time and title and not its room.
 *
 * ## Settlement happens here
 *
 * A vote whose deadline has passed, or whose electorate has finished answering, has already been
 * decided: {@link settleVote} is a function of (clock, ballot, electorate). There is no sweep job, so
 * the read that first observes a decided vote records it — through `scheduling.close_reschedule_round`,
 * which closes the round, moves the event to the winning slot and writes the log line in one
 * transaction and is a no-op for a round somebody else already closed. The projection shows the
 * settled state either way; persisting it is what makes the next reader see the same thing.
 *
 * ## Outcomes
 *
 * Each reader answers a value, `null` (nothing this reader may see at that address — a 404), or throws
 * (the database could not be asked). The service maps the throw to a 503; a 404 and an outage are
 * different facts and a caller must be able to tell them apart.
 */

// #region Rows
const EVENT_COLUMNS = [
	"id",
	"schedule_id",
	"project_id",
	"channel_id",
	"kind",
	"status",
	"title",
	"starts_at",
	"ends_at",
	"all_day",
	"is_masked",
	"accent",
	"location",
	"meeting_provider",
	"meeting_provider_label",
	"meeting_url",
	"meeting_passcode",
	"meeting_details",
	"meeting_pending",
	"meta",
	"attendee_count",
	"capacity",
	"href",
	"source_connection_id",
	"created_by",
].join(", ");

interface EventRow {
	id: string;
	schedule_id: string | null;
	project_id: string | null;
	channel_id: string | null;
	kind: CalendarEventKind;
	status: CalendarEventStatus | null;
	title: string;
	starts_at: string;
	ends_at: string;
	all_day: boolean;
	is_masked: boolean;
	accent: string | null;
	location: string | null;
	meeting_provider: string | null;
	meeting_provider_label: string | null;
	meeting_url: string | null;
	meeting_passcode: string | null;
	meeting_details: string | null;
	meeting_pending: boolean;
	meta: string | null;
	attendee_count: number | null;
	capacity: number | null;
	href: string | null;
	source_connection_id: string | null;
	created_by: string | null;
}

interface AttendeeRow {
	id: string;
	event_id: string;
	user_id: string | null;
	role: EventAttendee["role"];
	response: EventAttendee["response"];
	responded_at: string | null;
	note: string | null;
	created_at: string;
}

interface RoundRow {
	id: string;
	event_id: string;
	round: number;
	mode: EventReschedule["mode"];
	status: EventReschedule["status"];
	opened_by_user_id: string | null;
	opened_at: string | null;
	resolves_at: string | null;
	resolved_proposal_id: string | null;
}

interface ProposalRow {
	id: string;
	reschedule_id: string;
	starts_at: string;
	ends_at: string;
	proposed_by_user_id: string | null;
	proposed_by_role: "host" | "attendee";
	proposed_at: string;
	approved: boolean;
	note: string | null;
}

interface VoteRow {
	reschedule_id: string;
	proposal_id: string;
	attendee_id: string;
	cast_at: string;
}

interface HistoryRow {
	id: string;
	event_id: string;
	kind: EventHistoryEntry["kind"];
	actor_user_id: string | null;
	summary: string;
	detail: string | null;
	target_id: string | null;
	occurred_at: string;
}

interface CallRow {
	id: string;
	host_user_id: string;
	requester_user_id: string;
	call_type: "courtesy" | "paid";
	status: string;
	proposed_start: string;
	proposed_end: string;
	confirmed_start: string | null;
	confirmed_end: string | null;
	agenda: string | null;
	provider_slug: string | null;
	meeting_url: string | null;
	event_id: string | null;
	fee_amount_minor: number | string | null;
	fee_currency: string | null;
	proposed_at: string;
	responded_at: string | null;
	confirmed_at: string | null;
}

interface ProjectRef {
	id: string;
	slug: string;
	title: string;
}
// #endregion

// #region Constants
const DAY_MS = 86_400_000;

/** The zone a page falls back to when the reader has published none. The platform's home zone. */
const FALLBACK_TZ = "Europe/London";

/** A `.in()` list is a query string; past a few hundred uuids it outgrows a URL. */
const IN_CHUNK = 100;

/** The most history lines one event carries (`CalendarEventSchema.history` is `.max(100)`). */
const HISTORY_CAP = 100;

/** The most attachments one event carries (`.max(50)`). */
const ATTACHMENT_CAP = 50;

/** The most events one page reads, so a busy engagement cannot turn one page view into a scan. */
const EVENT_CAP = 500;

/** Ticket statuses that are no longer anybody's deadline. */
const DEADLINE_EXCLUDED_TICKETS = new Set(["cancelled", "reported_hidden"]);

/** Call statuses that no longer occupy anybody's time. */
const LIVE_CALL_STATUSES = ["proposed", "confirmed", "completed", "no_show"];

/** The providers a meeting room can be recorded as — `MeetingProvider`'s members. */
const MEETING_PROVIDERS: ReadonlySet<string> = new Set(Object.keys(MEETING_PROVIDER_LABEL));
// #endregion

// #region Plumbing
/** An RLS-scoped client on one schema. */
function db(actor: ReadActor & { accessToken: string }, schema: string): SupabaseClient {
	return getUserClient(actor.accessToken).schema(schema) as unknown as SupabaseClient;
}

/** Split a list into `.in()`-sized chunks. */
function chunks<T>(list: readonly T[], size = IN_CHUNK): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/** Run a `.in()` read over every chunk of `ids`, concatenating the rows. Throws on any failure. */
async function readIn<T>(
	ids: readonly string[],
	read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
	what: string,
): Promise<T[]> {
	if (ids.length === 0) return [];
	const answers = await Promise.all(chunks(ids).map((chunk) => read(chunk)));
	const out: T[] = [];
	for (const answer of answers) {
		if (answer.error) throw new Error(`${what} read failed: ${answer.error.message}`);
		out.push(...((answer.data ?? []) as T[]));
	}
	return out;
}

function ms(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : null;
}

const labelFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * "17 Sept, 14:05" in `tz` — the label a history line is listed with. Server-formatted so SSR and the
 * island print the same string. Falls back to UTC for a zone the runtime does not know, rather than
 * throwing a whole page over one label.
 */
function dateLabel(at: number, tz: string): string {
	let f = labelFormats.get(tz);
	if (!f) {
		try {
			f = new Intl.DateTimeFormat("en-GB", {
				timeZone: tz,
				day: "numeric",
				month: "short",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			});
		} catch {
			f = new Intl.DateTimeFormat("en-GB", {
				timeZone: "UTC",
				day: "numeric",
				month: "short",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			});
		}
		labelFormats.set(tz, f);
	}
	return clamp(f.format(new Date(at)), 28);
}

const slotFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * "Thu 17 Sept, 15:00 BST" — how a proposed slot is named in a PERSISTED history line.
 *
 * The zone abbreviation is part of the label on purpose. A log line is written once and read by
 * every party, in whatever zone each of them is in; "Thu 15:00" with no zone is a different time to
 * the host in Lisbon and the client in Toronto, and the line would be wrong for one of them.
 */
export function slotLabel(at: number, tz: string): string {
	let f = slotFormats.get(tz);
	if (!f) {
		try {
			f = new Intl.DateTimeFormat("en-GB", {
				timeZone: tz,
				weekday: "short",
				day: "numeric",
				month: "short",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
				timeZoneName: "short",
			});
		} catch {
			f = new Intl.DateTimeFormat("en-GB", {
				timeZone: "UTC",
				weekday: "short",
				day: "numeric",
				month: "short",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
				timeZoneName: "short",
			});
		}
		slotFormats.set(tz, f);
	}
	return f.format(new Date(at));
}
// #endregion

// #region The reader's own zone and schedule
interface OwnSchedule {
	id: string;
	timezone: string;
}

/** The reader's own (user-owned) schedule, when they have published or drafted one. */
async function readOwnSchedule(
	actor: ReadActor & { accessToken: string },
): Promise<OwnSchedule | null> {
	const { data, error } = await db(actor, "scheduling").from("schedules")
		.select("id, timezone")
		.eq("owner_type", "user")
		.eq("owner_id", actor.userId)
		.maybeSingle();
	if (error) throw new Error(`scheduling.schedules read failed: ${error.message}`);
	return (data as OwnSchedule | null) ?? null;
}

/**
 * The zone a page is drawn in: the reader's schedule's own zone (the one their working hours are
 * written in), else their profile's, else the platform's. A secondary read — a failure here costs the
 * page its zone, never the page.
 */
async function readerZone(
	actor: ReadActor & { accessToken: string },
	own: OwnSchedule | null,
): Promise<string> {
	if (own?.timezone) return own.timezone;
	const { data } = await db(actor, "org").from("users_public")
		.select("timezone")
		.eq("user_id", actor.userId)
		.maybeSingle();
	const tz = (data as { timezone: string | null } | null)?.timezone;
	return tz && tz.trim() ? tz : FALLBACK_TZ;
}
// #endregion

// #region Coordination
/** Everything the six coordination tables hold for a set of events, keyed for assembly. */
interface Coordination {
	attendees: Map<string, AttendeeRow[]>;
	/** The LATEST round per event. Earlier rounds are history, and the log already tells their story. */
	rounds: Map<string, RoundRow>;
	proposals: Map<string, ProposalRow[]>;
	votes: Map<string, VoteRow[]>;
	history: Map<string, HistoryRow[]>;
	attachments: Map<string, AssetItem[]>;
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
	const out = new Map<string, T[]>();
	for (const row of rows) {
		const k = key(row);
		const list = out.get(k);
		if (list) list.push(row);
		else out.set(k, [row]);
	}
	return out;
}

/**
 * Read the coordination for a set of events, as the reader.
 *
 * The roster, the rounds, the proposals and the votes are load-bearing — the roster is what decides
 * who is a party, and so what the privacy projection withholds — so a failure there throws. History
 * and attachments are secondary: a log that could not be read renders as no log, and the page stays.
 */
async function loadCoordination(
	actor: ReadActor & { accessToken: string },
	eventIds: readonly string[],
	now: number,
): Promise<Coordination> {
	const sched = db(actor, "scheduling");
	const [attendeeRows, roundRows, historyRows, attachmentLinks] = await Promise.all([
		readIn<AttendeeRow>(
			eventIds,
			(ids) =>
				sched.from("event_attendees")
					.select("id, event_id, user_id, role, response, responded_at, note, created_at")
					.in("event_id", ids),
			"scheduling.event_attendees",
		),
		readIn<RoundRow>(
			eventIds,
			(ids) =>
				sched.from("event_reschedules")
					.select(
						"id, event_id, round, mode, status, opened_by_user_id, opened_at, resolves_at, resolved_proposal_id",
					)
					.in("event_id", ids),
			"scheduling.event_reschedules",
		),
		readIn<HistoryRow>(
			eventIds,
			(ids) =>
				sched.from("event_history")
					.select("id, event_id, kind, actor_user_id, summary, detail, target_id, occurred_at")
					.in("event_id", ids)
					.order("occurred_at", { ascending: true }),
			"scheduling.event_history",
		).catch(() => [] as HistoryRow[]),
		readIn<{ event_id: string; file_id: string }>(
			eventIds,
			(ids) =>
				sched.from("event_attachments")
					.select("event_id, file_id")
					.in("event_id", ids)
					.order("created_at", { ascending: true }),
			"scheduling.event_attachments",
		).catch(() => [] as { event_id: string; file_id: string }[]),
	]);

	const rounds = new Map<string, RoundRow>();
	for (const row of roundRows) {
		const seen = rounds.get(row.event_id);
		if (!seen || row.round > seen.round) rounds.set(row.event_id, row);
	}
	const roundIds = [...rounds.values()].map((r) => r.id);

	const [proposalRows, voteRows, attachments] = await Promise.all([
		readIn<ProposalRow>(
			roundIds,
			(ids) =>
				sched.from("reschedule_proposals")
					.select(
						"id, reschedule_id, starts_at, ends_at, proposed_by_user_id, proposed_by_role, proposed_at, approved, note",
					)
					.in("reschedule_id", ids)
					.order("proposed_at", { ascending: true }),
			"scheduling.reschedule_proposals",
		),
		readIn<VoteRow>(
			roundIds,
			(ids) =>
				sched.from("proposal_votes")
					.select("reschedule_id, proposal_id, attendee_id, cast_at")
					.in("reschedule_id", ids)
					.order("cast_at", { ascending: true }),
			"scheduling.proposal_votes",
		),
		loadAttachments(actor, attachmentLinks, now),
	]);

	return {
		attendees: group(attendeeRows, (r) => r.event_id),
		rounds,
		proposals: group(proposalRows, (r) => r.reschedule_id),
		votes: group(voteRows, (r) => r.reschedule_id),
		history: group(historyRows, (r) => r.event_id),
		attachments,
	};
}

/**
 * The agenda packs, as assets. The file rows are read through the FILES domain's own policies, so an
 * asset this reader may not open is simply absent — an attachment row is a pointer, not a grant.
 * Only settled uploads are listed, the rule every file reader applies.
 */
async function loadAttachments(
	actor: ReadActor & { accessToken: string },
	links: readonly { event_id: string; file_id: string }[],
	now: number,
): Promise<Map<string, AssetItem[]>> {
	const out = new Map<string, AssetItem[]>();
	if (links.length === 0) return out;
	let rows: ItemRow[];
	try {
		rows = await readIn<ItemRow>(
			[...new Set(links.map((l) => l.file_id))],
			(ids) =>
				db(actor, "files").from("items").select(ITEM_COLUMNS).in("id", ids).eq("status", "uploaded")
					.is("deleted_at", null),
			"files.items",
		);
	} catch {
		return out;
	}
	const byId = new Map(rows.map((row) => [row.id, row]));
	const ctx = {
		viewerId: actor.userId,
		folderPaths: new Map<string, string[]>(),
		downloaded: new Set<string>(),
		shareSlugs: new Map<string, string>(),
		now,
	};
	for (const link of links) {
		const row = byId.get(link.file_id);
		if (!row) continue;
		const list = out.get(link.event_id) ?? [];
		if (list.length >= ATTACHMENT_CAP) continue;
		// Hung on an event, an asset is read-only here: managing it belongs to its own library.
		list.push({ ...toAssetItem(row, ctx), canManage: false, shareSlug: null });
		out.set(link.event_id, list);
	}
	return out;
}

/** Every user id the coordination names, for one party read. */
function coordinationUserIds(coord: Coordination, events: readonly EventRow[]): string[] {
	const ids: (string | null)[] = [];
	for (const e of events) ids.push(e.created_by);
	for (const list of coord.attendees.values()) for (const a of list) ids.push(a.user_id);
	for (const r of coord.rounds.values()) ids.push(r.opened_by_user_id);
	for (const list of coord.proposals.values()) {
		for (const p of list) ids.push(p.proposed_by_user_id);
	}
	for (const list of coord.history.values()) for (const h of list) ids.push(h.actor_user_id);
	return ids.filter((id): id is string => !!id);
}
// #endregion

// #region Assembly
interface AssemblyContext {
	actorId: string;
	tz: string;
	parties: Map<string, PartyRow>;
	coord: Coordination;
}

function partyFor(ctx: AssemblyContext, userId: string | null): SchedulingParty {
	return partyOf(userId ? ctx.parties.get(userId) : null);
}

/** Host first, then in the order people were invited. */
function rosterOrder(a: AttendeeRow, b: AttendeeRow): number {
	if (a.role === "host" && b.role !== "host") return -1;
	if (b.role === "host" && a.role !== "host") return 1;
	return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function toRoster(rows: readonly AttendeeRow[], ctx: AssemblyContext): EventAttendee[] {
	return [...rows].sort(rosterOrder).map((row) => ({
		...partyFor(ctx, row.user_id),
		id: row.id,
		role: row.role,
		response: row.response,
		// "Null while pending" is the schema's own invariant (`ck_attendee_pending_unanswered`).
		respondedAt: row.response === "pending" ? null : ms(row.responded_at),
		isViewer: !!row.user_id && row.user_id === ctx.actorId,
		note: row.note ? clamp(row.note, 280) : null,
	}));
}

function toReschedule(
	round: RoundRow,
	roster: readonly EventAttendee[],
	ctx: AssemblyContext,
): EventReschedule {
	const seats = new Map(roster.map((a) => [a.id, a]));
	const votes = ctx.coord.votes.get(round.id) ?? [];
	const proposals: RescheduleProposal[] = (ctx.coord.proposals.get(round.id) ?? []).map((p) => ({
		id: p.id,
		start: ms(p.starts_at) ?? 0,
		end: ms(p.ends_at) ?? 0,
		proposedBy: partyFor(ctx, p.proposed_by_user_id),
		proposedByRole: p.proposed_by_role,
		proposedAt: ms(p.proposed_at) ?? 0,
		approved: p.approved,
		note: p.note ? clamp(p.note, 280) : null,
		votes: votes
			.filter((v) => v.proposal_id === p.id)
			.map((v) => {
				const seat = seats.get(v.attendee_id);
				return {
					name: seat?.name ?? "Unknown",
					avatar: seat?.avatar ?? null,
					handle: seat?.handle ?? null,
					attendeeId: v.attendee_id,
					at: ms(v.cast_at) ?? 0,
				};
			}),
	}));
	return {
		mode: round.mode,
		status: round.status,
		openedBy: round.opened_by_user_id ? partyFor(ctx, round.opened_by_user_id) : null,
		openedAt: ms(round.opened_at),
		// A defensive bound only: the planner refuses a slot past the cap and the
		// `fn_cap_reschedule_proposals` trigger refuses the row, so a round can no longer hold more. It
		// stays so a round written before the trigger existed still parses.
		proposals: proposals.slice(0, RESCHEDULE_PROPOSALS_MAX),
		resolvesAt: ms(round.resolves_at),
		resolvedProposalId: round.resolved_proposal_id,
		round: round.round,
	};
}

function toHistory(rows: readonly HistoryRow[], ctx: AssemblyContext): EventHistoryEntry[] {
	return rows.slice(-HISTORY_CAP).map((row) => {
		const at = ms(row.occurred_at) ?? 0;
		return {
			id: row.id,
			kind: row.kind,
			actor: row.actor_user_id ? partyFor(ctx, row.actor_user_id) : null,
			summary: clampOr(row.summary, 200, "Updated"),
			detail: row.detail ? clamp(row.detail, 400) : null,
			at: new Date(at).toISOString(),
			dateLabel: dateLabel(at, ctx.tz),
			// A per-viewer read marker does not exist yet (`00000022` says so beside the table), and
			// "unread" asserted without one would be a guess.
			unread: false,
			targetId: row.target_id ? clamp(row.target_id, 120) : null,
		};
	});
}

function toMeeting(row: EventRow): EventMeeting | undefined {
	if (!row.meeting_provider || !MEETING_PROVIDERS.has(row.meeting_provider)) return undefined;
	const provider = row.meeting_provider as MeetingProvider;
	return {
		provider,
		providerLabel: clampOr(row.meeting_provider_label, 60, MEETING_PROVIDER_LABEL[provider]),
		joinUrl: row.meeting_url ? clamp(row.meeting_url, 600) : null,
		passcode: row.meeting_passcode ? clamp(row.meeting_passcode, 120) : null,
		details: row.meeting_details ? clamp(row.meeting_details, 600) : null,
		pending: row.meeting_pending,
	};
}

/**
 * One `scheduling.events` row, with its coordination, as a {@link CalendarEvent}.
 *
 * A roster is attached whenever the event HAS attendees; a negotiation only alongside a roster, since
 * moving a time is something people agree to and an entry with nobody on it has nobody to agree.
 */
function toCalendarEvent(row: EventRow, ctx: AssemblyContext): CalendarEvent {
	const attendeeRows = ctx.coord.attendees.get(row.id) ?? [];
	const roster = attendeeRows.length > 0 ? toRoster(attendeeRows, ctx) : undefined;
	const hostUserId = attendeeRows.find((a) => a.role === "host")?.user_id ?? row.created_by;
	const round = ctx.coord.rounds.get(row.id);

	const event: CalendarEvent = {
		id: row.id,
		title: clamp(row.title, 200),
		kind: row.kind,
		start: ms(row.starts_at) ?? 0,
		end: ms(row.ends_at) ?? 0,
		organiser: partyFor(ctx, hostUserId),
		viewerIsHost: !!hostUserId && hostUserId === ctx.actorId,
	};
	if (row.status) event.status = row.status;
	if (row.all_day) event.allDay = true;
	if (row.is_masked) event.masked = true;
	if (row.accent) event.accent = clamp(row.accent, 60);
	if (row.location) event.location = clamp(row.location, 160);
	if (row.meta) event.meta = clamp(row.meta, 160);
	if (row.attendee_count !== null) event.attendees = Math.max(0, row.attendee_count);
	if (row.capacity !== null) event.capacity = Math.max(0, row.capacity);
	if (row.href) event.href = clamp(row.href, 400);
	// The platform's own copy; an entry mirrored in from a connected calendar names no provider here,
	// because which provider a connection is lives behind the definer-only connection store.
	if (!row.source_connection_id) event.sources = ["projective"];

	const meeting = toMeeting(row);
	if (meeting) event.meeting = meeting;
	if (roster) {
		event.roster = roster.slice(0, 200);
		event.reschedule = round
			? toReschedule(round, roster, ctx)
			: emptyReschedule(rescheduleModeFor(roster.length));
	}
	const history = ctx.coord.history.get(row.id);
	if (history && history.length > 0) event.history = toHistory(history, ctx);
	const attachments = ctx.coord.attachments.get(row.id);
	if (attachments && attachments.length > 0) event.attachments = attachments;
	return event;
}
// #endregion

// #region Settlement
/**
 * Record any vote this read found already decided, and fold the decision into the projection.
 *
 * Returns whether a round was closed by somebody else between this read and the close — the caller
 * then re-reads once, so the page it answers with is the one the database holds.
 */
async function settleDecidedVotes(
	events: CalendarEvent[],
	rounds: Map<string, RoundRow>,
	now: number,
	tz: string,
): Promise<boolean> {
	let raced = false;
	for (let i = 0; i < events.length; i++) {
		const event = events[i];
		const reschedule = event.reschedule;
		const round = rounds.get(event.id);
		if (!reschedule || !round || reschedule.status !== "voting" || !event.roster) continue;

		const settled = settleVote(now, reschedule, eligibleVoterCount(event.roster));
		if (settled.status === reschedule.status) continue;

		const winner = settled.proposals.find((p) => p.id === settled.resolvedProposalId) ?? null;
		const summary = winner
			? `Moved to ${slotLabel(winner.start, tz)}`
			: "Vote closed without a majority";
		const detail = winner ? "Carried by a majority of the attendees." : "The original time stands.";

		let line: string | null | undefined;
		try {
			const { data, error } = await getServiceClient().schema("scheduling").rpc(
				"close_reschedule_round",
				{
					p_reschedule_id: round.id,
					p_status: settled.status,
					p_resolved_proposal_id: winner?.id ?? null,
					p_actor: null,
					p_summary: summary,
					p_detail: detail,
				},
			);
			if (error) throw new Error(error.message);
			line = data as string | null;
		} catch (err) {
			// The decision is the rule's answer whether or not it could be written down: show it, and let
			// the next read try to record it again.
			console.error("scheduling: could not record a settled vote", round.id, err);
			line = undefined;
		}
		if (line === null) {
			raced = true;
			continue;
		}

		const moved: CalendarEvent = { ...event, reschedule: settled };
		if (winner) {
			moved.start = winner.start;
			moved.end = winner.end;
		}
		if (line) {
			const entry: EventHistoryEntry = {
				id: line,
				kind: winner ? "rescheduled" : "vote",
				actor: null,
				summary,
				detail,
				at: new Date(now).toISOString(),
				dateLabel: dateLabel(now, tz),
				unread: false,
				targetId: winner?.id ?? null,
			};
			moved.history = [...(event.history ?? []), entry].slice(-HISTORY_CAP);
		}
		events[i] = moved;
	}
	return raced;
}
// #endregion

// #region Event reads
/** The events for a set of ids, as the reader, in a window. */
async function readEventsByIds(
	actor: ReadActor & { accessToken: string },
	ids: readonly string[],
): Promise<EventRow[]> {
	return await readIn<EventRow>(
		ids,
		(chunk) => db(actor, "scheduling").from("events").select(EVENT_COLUMNS).in("id", chunk),
		"scheduling.events",
	);
}

/** Assemble event rows into settled projections — the one path every calendar event takes. */
async function assemble(
	actor: ReadActor & { accessToken: string },
	rows: readonly EventRow[],
	tz: string,
	now: number,
	extraUserIds: readonly string[] = [],
): Promise<
	{
		events: CalendarEvent[];
		rounds: Map<string, RoundRow>;
		parties: Map<string, PartyRow>;
		raced: boolean;
	}
> {
	const coord = await loadCoordination(actor, rows.map((r) => r.id), now);
	const parties = await fetchParties(actor, [...coordinationUserIds(coord, rows), ...extraUserIds]);
	const ctx: AssemblyContext = { actorId: actor.userId, tz, parties, coord };
	const events = rows.map((row) => toCalendarEvent(row, ctx));
	const raced = await settleDecidedVotes(events, coord.rounds, now, tz);
	return { events, rounds: coord.rounds, parties, raced };
}
// #endregion

// #region Project calendar
/**
 * An engagement's calendar (or one of its channels'), as the reader sees it.
 *
 * `null` when the reader may not see the project, or names a channel that is not one of its rooms.
 */
export async function readProjectCalendar(
	actor: ReadActor & { accessToken: string },
	params: CalendarParams,
	now: number,
): Promise<CalendarPage | null> {
	const project = await resolveProjectRef<ProjectRef>(
		db(actor, "projects"),
		"id, slug, title",
		params.projectId,
	);
	if (!project) return null;

	// A channel scope narrows to one ROOM. A stage's room is that stage's calendar — its meetings,
	// its due date and the due dates of the tickets in it; any other room shows the meetings arranged
	// in it.
	let channelId: string | null = null;
	let stageId: string | null = null;
	if (params.channelId) {
		channelId = await resolveChannelRef(actor, project.id, params.channelId);
		if (!channelId) return null;
		const room = await db(actor, "comms").from("project_channels")
			.select("id, stage_id")
			.eq("id", channelId)
			.eq("project_id", project.id)
			.maybeSingle();
		if (room.error) throw new Error(`comms.project_channels read failed: ${room.error.message}`);
		if (!room.data) return null;
		stageId = (room.data as { stage_id: string | null }).stage_id;
	}

	const own = await readOwnSchedule(actor);
	const [tz, board, eventRows] = await Promise.all([
		readerZone(actor, own),
		fetchBoardPage(actor, { projectId: project.slug }),
		(async () => {
			let q = db(actor, "scheduling").from("events")
				.select(EVENT_COLUMNS)
				.eq("project_id", project.id)
				.gte("ends_at", new Date(now - 180 * DAY_MS).toISOString())
				.lte("starts_at", new Date(now + 365 * DAY_MS).toISOString())
				.order("starts_at", { ascending: true })
				.limit(EVENT_CAP);
			if (channelId) q = q.eq("channel_id", channelId);
			const { data, error } = await q;
			if (error) throw new Error(`scheduling.events read failed: ${error.message}`);
			return (data ?? []) as unknown as EventRow[];
		})(),
	]);
	if (!board) return null;

	const first = await assemble(actor, eventRows, tz, now);
	const events = first.raced
		? (await assemble(actor, await readEventsByIds(actor, eventRows.map((r) => r.id)), tz, now))
			.events
		: first.events;

	// Deadlines: a room that is not a stage's has none of its own.
	if (!channelId || stageId) {
		const stageName = new Map(board.stages.map((s) => [s.id, s.name]));
		for (const stage of board.stages) {
			if (stageId && stage.id !== stageId) continue;
			const due = ms(stage.endAt);
			if (due === null) continue;
			events.push({
				id: `due-${stage.id}`,
				title: clamp(`${stage.name} due`, 200),
				kind: "deadline",
				status: stage.status === "cancelled" ? "cancelled" : "confirmed",
				start: due,
				end: due,
				meta: "Stage deadline",
				href: clamp(`/projects/${project.slug}/${stage.slug}`, 400),
				sources: ["projective"],
			});
		}
		for (const card of board.cards) {
			if (stageId && card.stageId !== stageId) continue;
			if (DEADLINE_EXCLUDED_TICKETS.has(card.status)) continue;
			const due = ms(card.dueDate);
			if (due === null) continue;
			events.push({
				id: `ticket-${card.id}`,
				title: clamp(`${card.title} due`, 200),
				kind: "deadline",
				status: "confirmed",
				start: due,
				end: due,
				meta: clamp(
					card.stageId
						? `${stageName.get(card.stageId) ?? "Stage"} · Ticket deadline`
						: "Ticket deadline",
					160,
				),
				href: clamp(
					card.slug
						? `/projects/${project.slug}/board?tkv=${encodeURIComponent(card.slug)}`
						: `/projects/${project.slug}/board`,
					400,
				),
				sources: ["projective"],
			});
		}
	}

	events.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
	return {
		scope: channelId ? "channel" : "project",
		projectId: params.projectId,
		channelId: params.channelId ?? null,
		title: clampOr(project.title, 160, "Project"),
		timezone: tz,
		viewerIsClient: board.viewerIsClient,
		canCreate: true,
		events,
		now,
	};
}
// #endregion

// #region Personal agenda
/** The engagements the reader is on, split by the side of the table they sit on. */
interface Involvement {
	/** Projects the reader owns or sits on the client side of — every stage and ticket is theirs. */
	clientProjects: Set<string>;
	/** Stages the reader has been onboarded to as a provider. */
	providerStages: Set<string>;
	/** Every project id either set touches. */
	projectIds: Set<string>;
}

async function readInvolvement(actor: ReadActor & { accessToken: string }): Promise<Involvement> {
	const projects = db(actor, "projects");
	const [owned, participant, assignments] = await Promise.all([
		projects.from("projects").select("id").eq("owner_user_id", actor.userId).neq(
			"status",
			"archived",
		),
		projects.from("project_participants").select("project_id, role").eq("profile_id", actor.userId),
		projects.from("stage_assignments")
			.select("project_stage_id, status")
			.eq("assignee_type", "freelancer")
			.eq("freelancer_profile_id", actor.userId),
	]);
	if (owned.error) throw new Error(`projects.projects read failed: ${owned.error.message}`);
	if (participant.error) {
		throw new Error(`projects.project_participants read failed: ${participant.error.message}`);
	}

	const clientProjects = new Set<string>((owned.data ?? []).map((r: { id: string }) => r.id));
	for (const row of (participant.data ?? []) as { project_id: string; role: string | null }[]) {
		if (isClientSideRole(row.role)) clientProjects.add(row.project_id);
	}
	// A failed assignment read costs the provider-side due dates, not the page.
	const providerStages = new Set<string>(
		((assignments.error ? [] : assignments.data ?? []) as {
			project_stage_id: string;
			status: string | null;
		}[])
			.filter((r) => countsAsOnboarded(r.status ?? ""))
			.map((r) => r.project_stage_id),
	);
	const projectIds = new Set<string>(clientProjects);
	for (const row of (participant.data ?? []) as { project_id: string }[]) {
		projectIds.add(row.project_id);
	}
	// A provider onboarded to a stage is on that engagement even without a participant row.
	for (
		const row of await readIn<{ project_id: string }>(
			[...providerStages],
			(ids) => projects.from("project_stages").select("project_id").in("id", ids),
			"projects.project_stages",
		).catch(() => [] as { project_id: string }[])
	) projectIds.add(row.project_id);
	return { clientProjects, providerStages, projectIds };
}

/**
 * The reader's own agenda: their working hours, call windows and leave; the entries on their own
 * schedule; every meeting they are seated on or arranged; their calls; and the due dates of the work
 * they are on — every stage and ticket of an engagement they are the client of, and the stages they
 * were onboarded to and tickets they hold on the provider side.
 */
export async function readPersonalCalendar(
	actor: ReadActor & { accessToken: string },
	now: number,
): Promise<SchedulePage> {
	const from = new Date(now - 60 * DAY_MS).toISOString();
	const to = new Date(now + 180 * DAY_MS).toISOString();
	const sched = db(actor, "scheduling");
	const projects = db(actor, "projects");

	const own = await readOwnSchedule(actor);
	const [tz, involvement, rules, blackouts, ownEvents, seatRows, createdEvents, calls] =
		await Promise.all([
			readerZone(actor, own),
			readInvolvement(actor),
			own
				? sched.from("availability_rules")
					.select("weekday, start_minute, end_minute, kind, label")
					.eq("schedule_id", own.id)
					.eq("is_active", true)
					.order("weekday")
					.order("start_minute")
				: Promise.resolve({ data: [], error: null }),
			own
				? sched.from("blackout_dates")
					.select("starts_at, ends_at, label")
					.eq("schedule_id", own.id)
					.lt("starts_at", to)
					.gt("ends_at", from)
				: Promise.resolve({ data: [], error: null }),
			own
				? sched.from("events").select(EVENT_COLUMNS).eq("schedule_id", own.id)
					.gte("ends_at", from).lte("starts_at", to).limit(EVENT_CAP)
				: Promise.resolve({ data: [], error: null }),
			sched.from("event_attendees").select("event_id").eq("user_id", actor.userId),
			sched.from("events").select(EVENT_COLUMNS).eq("created_by", actor.userId)
				.not("project_id", "is", null).gte("ends_at", from).lte("starts_at", to).limit(EVENT_CAP),
			sched.from("discovery_calls")
				.select(
					"id, host_user_id, requester_user_id, call_type, status, proposed_start, proposed_end, confirmed_start, confirmed_end, agenda, provider_slug, meeting_url, event_id, fee_amount_minor, fee_currency, proposed_at, responded_at, confirmed_at",
				)
				.or(`host_user_id.eq.${actor.userId},requester_user_id.eq.${actor.userId}`)
				.in("status", LIVE_CALL_STATUSES)
				.gte("proposed_end", from)
				.lte("proposed_start", to),
		]);
	for (
		const [what, answer] of [
			["scheduling.availability_rules", rules],
			["scheduling.blackout_dates", blackouts],
			["scheduling.events", ownEvents],
			["scheduling.event_attendees", seatRows],
			["scheduling.events", createdEvents],
			["scheduling.discovery_calls", calls],
		] as const
	) {
		if (answer.error) throw new Error(`${what} read failed: ${answer.error.message}`);
	}

	// A call that has been mirrored into an event is drawn once, as the call.
	const callRows = (calls.data ?? []) as CallRow[];
	const mirrored = new Set(callRows.map((c) => c.event_id).filter((id): id is string => !!id));

	// The meetings the reader is seated on, read in the same window.
	const seatedIds = [
		...new Set(((seatRows.data ?? []) as { event_id: string }[]).map((r) => r.event_id)),
	];
	const seated = (await readEventsByIds(actor, seatedIds)).filter((row) => {
		const start = ms(row.starts_at) ?? 0;
		const end = ms(row.ends_at) ?? 0;
		return end >= Date.parse(from) && start <= Date.parse(to);
	});

	const rows = new Map<string, EventRow>();
	for (
		const row of [
			...((ownEvents.data ?? []) as unknown as EventRow[]),
			...seated,
			...((createdEvents.data ?? []) as unknown as EventRow[]),
		]
	) {
		if (!mirrored.has(row.id)) rows.set(row.id, row);
	}

	// Stage and ticket due dates.
	const stageRows = involvement.projectIds.size === 0 ? [] : await readIn<
		StageWindowRow & {
			project_id: string;
			slug: string;
			name: string | null;
			status: string | null;
		}
	>(
		[...involvement.projectIds],
		(ids) =>
			projects.from("project_stages")
				.select(`${STAGE_WINDOW_COLUMNS}, project_id, slug, name, status`)
				.in("project_id", ids),
		"projects.project_stages",
	);
	const ticketFilters = [`current_assignee_id.eq.${actor.userId}`];
	if (involvement.clientProjects.size > 0) {
		ticketFilters.push(`project_id.in.(${[...involvement.clientProjects].join(",")})`);
	}
	const tickets = await projects.from("tickets")
		.select("id, slug, project_id, current_stage_id, title, status, due_date")
		.or(ticketFilters.join(","))
		.not("due_date", "is", null)
		.gte("due_date", from)
		.lte("due_date", to);
	if (tickets.error) throw new Error(`projects.tickets read failed: ${tickets.error.message}`);
	const ticketRows = (tickets.data ?? []) as {
		id: string;
		slug: string | null;
		project_id: string;
		current_stage_id: string | null;
		title: string;
		status: string;
		due_date: string;
	}[];

	// Every engagement anything above belongs to, for the strapline and the link.
	const projectIds = new Set<string>();
	for (const row of rows.values()) if (row.project_id) projectIds.add(row.project_id);
	for (const s of stageRows) projectIds.add(s.project_id);
	for (const t of ticketRows) projectIds.add(t.project_id);
	const projectRefs = new Map<string, ProjectRef>();
	for (
		const ref of await readIn<ProjectRef>(
			[...projectIds],
			(ids) => projects.from("projects").select("id, slug, title").in("id", ids),
			"projects.projects",
		)
	) projectRefs.set(ref.id, ref);

	const callPeople = callRows.flatMap((c) => [c.host_user_id, c.requester_user_id]);
	const { events: meetings, parties, raced } = await assemble(actor, [...rows.values()], tz, now, [
		actor.userId,
		...callPeople,
	]);
	let settledMeetings = meetings;
	if (raced) {
		settledMeetings =
			(await assemble(actor, await readEventsByIds(actor, [...rows.keys()]), tz, now)).events;
	}

	const events: CalendarEvent[] = settledMeetings.map((event) => {
		const row = rows.get(event.id);
		const ref = row?.project_id ? projectRefs.get(row.project_id) : undefined;
		if (!ref) return event;
		// The engagement is the answer to "why is this in my week", on the strapline the block renders.
		return {
			...event,
			meta: clamp(event.meta ? `${ref.title} · ${event.meta}` : ref.title, 160),
			href: event.href ?? clamp(`/projects/${ref.slug}/calendar`, 400),
		};
	});

	// Stage due dates: every stage of an engagement the reader is the client of, and the stages they
	// were onboarded to. Windows are resolved per project, because a dependency is within a project.
	const byProject = new Map<string, typeof stageRows>();
	for (const s of stageRows) {
		const list = byProject.get(s.project_id);
		if (list) list.push(s);
		else byProject.set(s.project_id, [s]);
	}
	for (const [projectId, list] of byProject) {
		const ref = projectRefs.get(projectId);
		if (!ref) continue;
		const windows = stageWindows(list);
		for (const stage of list) {
			if (!involvement.clientProjects.has(projectId) && !involvement.providerStages.has(stage.id)) {
				continue;
			}
			const due = ms(windows.get(stage.id)?.endAt);
			if (due === null) continue;
			const name = clampOr(stage.name, 120, "Stage");
			events.push({
				id: `due-${stage.id}`,
				title: clamp(`${name} due`, 200),
				kind: "deadline",
				status: stage.status === "cancelled" ? "cancelled" : "confirmed",
				start: due,
				end: due,
				meta: clamp(`${ref.title} · Stage deadline`, 160),
				href: clamp(`/projects/${ref.slug}/${stage.slug}`, 400),
				sources: ["projective"],
			});
		}
	}

	const stageNames = new Map(stageRows.map((s) => [s.id, s.name ?? "Stage"]));
	for (const ticket of ticketRows) {
		if (DEADLINE_EXCLUDED_TICKETS.has(ticket.status)) continue;
		const ref = projectRefs.get(ticket.project_id);
		const due = ms(ticket.due_date);
		if (!ref || due === null) continue;
		const where = ticket.current_stage_id ? stageNames.get(ticket.current_stage_id) : null;
		events.push({
			id: `ticket-${ticket.id}`,
			title: clamp(`${ticket.title} due`, 200),
			kind: "deadline",
			status: "confirmed",
			start: due,
			end: due,
			meta: clamp(where ? `${ref.title} · ${where}` : `${ref.title} · Ticket deadline`, 160),
			href: clamp(
				ticket.slug
					? `/projects/${ref.slug}/board?tkv=${encodeURIComponent(ticket.slug)}`
					: `/projects/${ref.slug}/board`,
				400,
			),
			sources: ["projective"],
		});
	}

	for (const call of callRows) events.push(callEvent(call, actor.userId, parties));

	events.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
	return {
		scope: "personal",
		title: "Calendar",
		subtitle: "Everything you are on, in one week",
		timezone: tz,
		ownerHandle: parties.get(actor.userId)?.username
			? clamp(parties.get(actor.userId)!.username, 64)
			: null,
		viewerCanBook: true,
		availability: {
			timezone: tz,
			rules: ((rules.data ?? []) as {
				weekday: number;
				start_minute: number;
				end_minute: number;
				kind: AvailabilityRule["kind"];
				label: string | null;
			}[]).map((r) => {
				const rule: AvailabilityRule = {
					weekday: r.weekday,
					startMinute: r.start_minute,
					endMinute: r.end_minute,
					kind: r.kind,
				};
				if (r.label) rule.label = clamp(r.label, 80);
				return rule;
			}),
			// The owner's own leave, so every label is theirs to read.
			blackouts: ((blackouts.data ?? []) as { starts_at: string; ends_at: string; label: string }[])
				.map((b): BlackoutDate => ({
					start: ms(b.starts_at) ?? 0,
					end: ms(b.ends_at) ?? 0,
					label: clampOr(b.label, 120, "Unavailable"),
				})),
		},
		events,
		now,
	};
}

/**
 * A discovery call as a `booking` block on a party's agenda.
 *
 * Its roster is the two people it is between, answered from the call's own lifecycle — the requester
 * asked for it, and the host has answered only once it is confirmed. It carries NO negotiation: a
 * call is moved and confirmed through its own request/confirm flow, not through event reschedule
 * rounds, so offering those controls here would offer something that reaches nothing.
 */
function callEvent(call: CallRow, actorId: string, parties: Map<string, PartyRow>): CalendarEvent {
	const start = ms(call.confirmed_start) ?? ms(call.proposed_start) ?? 0;
	const end = ms(call.confirmed_end) ?? ms(call.proposed_end) ?? start;
	const iAmHost = call.host_user_id === actorId;
	const other = partyOf(parties.get(iAmHost ? call.requester_user_id : call.host_user_id));
	const hostAnswered = call.status !== "proposed";
	const roster: EventAttendee[] = [
		{
			...partyOf(parties.get(call.host_user_id)),
			id: `${call.id}-host`,
			role: "host",
			response: hostAnswered ? "accepted" : "pending",
			respondedAt: hostAnswered ? (ms(call.confirmed_at) ?? ms(call.responded_at)) : null,
			isViewer: iAmHost,
			note: null,
		},
		{
			...partyOf(parties.get(call.requester_user_id)),
			id: `${call.id}-requester`,
			role: "participant",
			response: "accepted",
			respondedAt: ms(call.proposed_at),
			isViewer: !iAmHost && call.requester_user_id === actorId,
			note: null,
		},
	];
	const kindLabel = call.call_type === "paid" ? "Paid call" : "Courtesy call";
	const event: CalendarEvent = {
		id: `call-${call.id}`,
		title: clamp(`Call with ${other.name}`, 200),
		kind: "booking",
		status: call.status === "proposed" ? "tentative" : "confirmed",
		start,
		end,
		meta: clamp(
			call.status === "proposed" ? `${kindLabel} · Awaiting confirmation` : kindLabel,
			160,
		),
		callId: clamp(call.id, 120),
		callType: call.call_type,
		organiser: partyOf(parties.get(call.host_user_id)),
		viewerIsHost: iAmHost,
		roster,
		sources: ["projective"],
	};
	if (call.agenda) event.description = clamp(call.agenda, 8000);
	if (call.provider_slug) {
		event.conferenceProvider = clamp(call.provider_slug, 40);
		if (MEETING_PROVIDERS.has(call.provider_slug)) {
			const provider = call.provider_slug as MeetingProvider;
			event.meeting = {
				provider,
				providerLabel: MEETING_PROVIDER_LABEL[provider],
				joinUrl: call.meeting_url ? clamp(call.meeting_url, 600) : null,
				passcode: null,
				details: null,
				pending: !call.meeting_url,
			};
		}
	}
	if (call.meeting_url) event.meetingUrl = clamp(call.meeting_url, 600);
	if (call.call_type === "paid" && call.fee_amount_minor !== null && call.fee_currency) {
		const fee = Number(call.fee_amount_minor);
		if (Number.isFinite(fee) && fee >= 0) {
			event.feeAmountMinor = Math.floor(fee);
			event.feeCurrency = call.fee_currency.trim().toUpperCase();
		}
	}
	return event;
}
// #endregion

// #region One event, for a write
/** A coordinated event re-read for a write: the projection and the round it would write to. */
export interface LoadedEvent {
	event: CalendarEvent;
	/** The latest reschedule round's row id, or `null` when nobody has asked to move it yet. */
	roundId: string | null;
	/** The zone the reader's labels are written in. */
	tz: string;
}

/**
 * Re-read ONE event exactly as the surface the write came from drew it, settled.
 *
 * Only a `scheduling.events` row can be negotiated — a deadline or a call has no roster rounds — so
 * any other id is `null`. The event must also belong to what the target names: an engagement's own
 * calendar for a project/channel target, and the reader's own agenda (their schedule, a seat on it,
 * or an event they arranged) for a personal one. The public scopes carry nothing to answer or move.
 */
export async function readCalendarEvent(
	actor: ReadActor & { accessToken: string },
	target: SchedulingTarget,
	now: number,
): Promise<LoadedEvent | null> {
	if (!UUID_RE.test(target.eventId)) return null;
	const [row] = await readEventsByIds(actor, [target.eventId]);
	if (!row) return null;

	const own = await readOwnSchedule(actor);
	let meta: ProjectRef | null = null;
	switch (target.scope) {
		case "project":
		case "channel": {
			if (!target.projectId || !row.project_id) return null;
			const project = await resolveProjectRef<ProjectRef>(
				db(actor, "projects"),
				"id, slug, title",
				target.projectId,
			);
			if (!project || project.id !== row.project_id) return null;
			break;
		}
		case "personal": {
			const seat = await db(actor, "scheduling").from("event_attendees")
				.select("id")
				.eq("event_id", row.id)
				.eq("user_id", actor.userId)
				.maybeSingle();
			if (seat.error) {
				throw new Error(`scheduling.event_attendees read failed: ${seat.error.message}`);
			}
			const mine = (own && row.schedule_id === own.id) || !!seat.data ||
				row.created_by === actor.userId;
			if (!mine) return null;
			if (row.project_id) {
				const refs = await db(actor, "projects").from("projects").select("id, slug, title")
					.eq("id", row.project_id).maybeSingle();
				meta = (refs.data as ProjectRef | null) ?? null;
			}
			break;
		}
		default:
			return null;
	}

	const tz = await readerZone(actor, own);
	let assembled = await assemble(actor, [row], tz, now);
	if (assembled.raced) {
		const [again] = await readEventsByIds(actor, [row.id]);
		if (!again) return null;
		assembled = await assemble(actor, [again], tz, now);
	}
	let event = assembled.events[0];
	if (meta) {
		event = {
			...event,
			meta: clamp(event.meta ? `${meta.title} · ${event.meta}` : meta.title, 160),
			href: event.href ?? clamp(`/projects/${meta.slug}/calendar`, 400),
		};
	}
	return { event, roundId: assembled.rounds.get(row.id)?.id ?? null, tz };
}
// #endregion
