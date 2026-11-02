import type { SupabaseClient } from "supabaseClient";
import type {
	CalendarEvent,
	CreateEntriesInput,
	EntryFields,
	RemoveEntryInput,
	UpdateEntryInput,
} from "@projective/types/scheduling";
import { createRefusal, uuid } from "@projective/types/scheduling";
import { hasRichTextProse, sanitizeRichText } from "@projective/types/richtext";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";

/**
 * live-entries — a host creating, editing and removing their OWN `/calendar` entries (Decision #328
 * (a)).
 *
 * Unlike the coordination writes, every write here runs AS THE CALLER, through their JWT, under the
 * `Manage scheduling events` policy: an entry on one's own schedule with no engagement behind it has
 * no negotiation to protect, so RLS is the whole gate and the service role is never needed. The
 * checks below are the readable half of that gate — a `403` that says why — and a write RLS still
 * refuses (the actor's id is an unverified decode, `read-actor.ts`) affects no row and is answered
 * the same `403`.
 *
 * **Time.** A NEW entry may not start in the past ({@link createRefusal}, the composer's own rule and
 * wording); an edit or a removal may touch an entry whatever its time. **Removal is soft**: the row
 * is `cancelled` (which releases the time from free/busy and the booking gate) and `archived_at`
 * (which takes it off every reader), never deleted. A rostered entry can do neither through a client
 * role — `trg_guard_rostered_event` refuses it `55000`, answered as a `409`.
 */

// #region Plumbing
/** What every write here needs: the caller's own client, the agenda's re-read and the clock. */
export interface EntryDeps {
	/** The CALLER's client — never the service role. */
	db: SupabaseClient;
	/** The written entries as the caller's agenda draws them (`readEntries`). */
	reread: (ids: readonly string[]) => Promise<CalendarEvent[]>;
	now: number;
}

type Caller = ReadActor & { accessToken: string };

/** The row a host write is judged on. */
export interface EntryRow {
	id: string;
	schedule_id: string | null;
	project_id: string | null;
	archived_at: string | null;
}

const GONE = "That entry is no longer on your calendar.";
const NOT_HOST = "Only the entry’s host can change it.";
const BACKWARDS = "An entry can’t end before it starts.";

function sched(db: SupabaseClient): SupabaseClient {
	return db.schema("scheduling") as unknown as SupabaseClient;
}

/**
 * The columns an entry's own fields write. The agenda is HTML its attendees will render, so it is
 * stored only as {@link sanitizeRichText} rebuilt it, and an agenda with no prose is no agenda.
 */
function columns(f: EntryFields): Record<string, unknown> {
	const agenda = sanitizeRichText(f.description ?? "");
	return {
		title: f.title,
		kind: f.kind,
		starts_at: new Date(f.start).toISOString(),
		ends_at: new Date(f.end).toISOString(),
		all_day: f.allDay ?? false,
		location: f.location?.trim() || null,
		description: hasRichTextProse(agenda) ? agenda : null,
	};
}

/** A refused database write, as a result. */
function writeRefusal(error: { code?: string; message?: string }): ServiceResult<never> {
	if (error.code === "55000") {
		const said = (error.message ?? "").replace(/^event:\s*/, "");
		return fail(409, { message: said ? said[0].toUpperCase() + said.slice(1) + "." : GONE });
	}
	if (error.code === "42501") return fail(403, { message: NOT_HOST });
	console.error("[scheduling:entries] write failed", error.code, error.message);
	return fail(503, { message: "Your calendar could not be saved just now. Please try again." });
}

/** The caller's own (user-owned) schedule id, or `null` before their first entry. */
async function ownSchedule(db: SupabaseClient, userId: string): Promise<string | null> {
	const { data, error } = await sched(db).from("schedules").select("id")
		.eq("owner_type", "user").eq("owner_id", userId).maybeSingle();
	if (error) throw new Error(`scheduling.schedules read failed: ${error.message}`);
	return (data as { id: string } | null)?.id ?? null;
}

/**
 * The caller's schedule, opened on their first entry: unpublished, and in their profile's zone —
 * the column default would otherwise become the zone their whole agenda is drawn in.
 */
async function openSchedule(db: SupabaseClient, userId: string): Promise<string> {
	const existing = await ownSchedule(db, userId);
	if (existing) return existing;
	const profile = await db.schema("org").from("users_public").select("timezone")
		.eq("user_id", userId).maybeSingle();
	const tz = (profile.data as { timezone: string | null } | null)?.timezone?.trim();
	const { data, error } = await sched(db).from("schedules")
		.insert({ owner_type: "user", owner_id: userId, ...(tz ? { timezone: tz } : {}) })
		.select("id").single();
	if (!error) return (data as { id: string }).id;
	// Two first entries at once: the other one opened it.
	const raced = error.code === "23505" ? await ownSchedule(db, userId) : null;
	if (raced) return raced;
	throw new Error(`scheduling.schedules insert failed: ${error.message}`);
}
// #endregion

// #region The rules (pure)
/** Why these fields cannot be written, or `null`. A create also may not start in the past. */
export function fieldsRefusal(
	fields: EntryFields,
	now: number,
	creating: boolean,
): ServiceResult<never> | null {
	if (fields.end < fields.start) {
		return fail(422, { message: BACKWARDS, errors: { end: BACKWARDS } });
	}
	const past = creating ? createRefusal(now, fields) : null;
	return past ? fail(422, { message: past, errors: { start: past } }) : null;
}

/**
 * Whether the caller hosts this entry: it is on THEIR schedule and belongs to no engagement (a
 * project's events move only through their negotiation). An archived or unreadable row is a `404`;
 * a readable one that is not theirs — a seat on someone's entry, a team schedule — is a `403`.
 */
export function hostRefusal(
	row: EntryRow | null,
	ownScheduleId: string | null,
): ServiceResult<never> | null {
	if (!row || row.archived_at) return fail(404, { message: GONE });
	if (row.project_id || !ownScheduleId || row.schedule_id !== ownScheduleId) {
		return fail(403, { message: NOT_HOST });
	}
	return null;
}
// #endregion

// #region Doors
/**
 * The entry `eventId` names, judged for a host write as the caller. An id that is not a persisted
 * entry's — a stage or ticket due date (`due-…`, `ticket-…`), a call (`call-…`) — names something
 * derived from elsewhere, which nobody changes from here.
 */
async function judge(
	db: SupabaseClient,
	actor: Caller,
	eventId: string,
): Promise<ServiceResult<never> | null> {
	if (!uuid.safeParse(eventId).success) return fail(403, { message: NOT_HOST });
	const [row, own] = await Promise.all([
		sched(db).from("events").select("id, schedule_id, project_id, archived_at")
			.eq("id", eventId).maybeSingle(),
		ownSchedule(db, actor.userId),
	]);
	if (row.error) throw new Error(`scheduling.events read failed: ${row.error.message}`);
	return hostRefusal(row.data as EntryRow | null, own);
}

/**
 * Create entries on the caller's own schedule — one, or every day of a daily series in ONE insert,
 * so a series is written whole or not at all — and answer with them as the agenda draws them.
 */
export async function createEntries(
	input: CreateEntriesInput,
	actor: Caller,
	deps: EntryDeps,
): Promise<ServiceResult<{ events: CalendarEvent[] }>> {
	for (const fields of input.entries) {
		const refused = fieldsRefusal(fields, deps.now, true);
		if (refused) return refused;
	}
	const scheduleId = await openSchedule(deps.db, actor.userId);
	const { data, error } = await sched(deps.db).from("events").insert(
		input.entries.map((f) => ({
			...columns(f),
			schedule_id: scheduleId,
			status: "confirmed",
			created_by: actor.userId,
		})),
	).select("id");
	if (error) return writeRefusal(error);
	const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
	return ok({ events: await deps.reread(ids) }, { status: 201 });
}

/** Edit one of the caller's own entries, past or not, and answer with it re-read. */
export async function updateEntry(
	input: UpdateEntryInput,
	actor: Caller,
	deps: EntryDeps,
): Promise<ServiceResult<{ event: CalendarEvent }>> {
	const { eventId, ...fields } = input;
	const refused = fieldsRefusal(fields, deps.now, false) ?? await judge(deps.db, actor, eventId);
	if (refused) return refused;
	const { data, error } = await sched(deps.db).from("events").update(columns(fields))
		.eq("id", eventId).is("archived_at", null).select("id");
	if (error) return writeRefusal(error);
	if (!data?.length) return fail(403, { message: NOT_HOST });
	const [event] = await deps.reread([eventId]);
	return event
		? ok({ event })
		: fail(500, { message: "The entry was saved but could not be re-read." });
}

/** Take one of the caller's own entries off the calendar: cancelled and archived, never deleted. */
export async function removeEntry(
	input: RemoveEntryInput,
	actor: Caller,
	deps: EntryDeps,
): Promise<ServiceResult<{ eventId: string }>> {
	const refused = await judge(deps.db, actor, input.eventId);
	if (refused) return refused;
	const { data, error } = await sched(deps.db).from("events")
		.update({ status: "cancelled", archived_at: new Date(deps.now).toISOString() })
		.eq("id", input.eventId).is("archived_at", null).select("id");
	if (error) return writeRefusal(error);
	if (!data?.length) return fail(403, { message: NOT_HOST });
	return ok({ eventId: input.eventId });
}
// #endregion
