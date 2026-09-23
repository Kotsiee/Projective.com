import type { SupabaseClient } from "supabaseClient";
import { getAnonClient } from "../../core/supabase.ts";
import { DEFAULT_GRID_RULES, type GridBand, type GridRules, type GridSource, type Span } from "./slot-grid.ts";

/**
 * live-slots — a provider's published schedule, read as the input the slot grid is built from.
 *
 * Everything here is PUBLIC shape and nothing more: the bands and blackout spans of a published
 * schedule (world-readable by policy), its booking guards (`call_settings`, likewise), and its busy
 * time as bare spans through `scheduling.get_free_busy` — the definer read that answers "this time is
 * taken" without saying by whom or for what. So the anonymous client answers a guest and a member
 * identically, and the grid a buyer is shown is the grid the database's booking gate will enforce.
 *
 * Returns `undefined` only when the database could not answer — never an empty schedule dressed up
 * as the provider's. An unpublished (or absent) schedule is a real answer: a CLOSED source with the
 * reason the picker prints.
 */

// #region Owner
/** Whose schedule: an individual is ONE schedule (`user`) whatever their freelancer flag; a team is `team`. */
export interface ScheduleOwner {
	type: "user" | "team" | "business" | "organisation";
	id: string;
}

/** Which bands a booking lands in: a discovery call in the call windows, paid work in working hours. */
export type BandKind = "call_window" | "working_hours";

/** The reason a grid is closed because the provider has published nothing to book. */
export const UNPUBLISHED_REASON = "This provider has not published their availability yet.";
// #endregion

// #region Rows
interface ScheduleRow {
	id: string;
	timezone: string;
	is_published: boolean;
}

interface BandRow {
	weekday: number;
	start_minute: number;
	end_minute: number;
}

interface GuardRow {
	min_notice_minutes: number;
	max_advance_days: number;
	buffer_before_minutes: number;
	buffer_after_minutes: number;
}

interface SpanRow {
	starts_at: string;
	ends_at: string;
}

function spanOf(row: SpanRow): Span {
	return { start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) };
}
// #endregion

// #region The read
/**
 * The grid source for an owner's schedule, over the window `[from, to)` (epoch ms). The caller sizes
 * the window to the rail it is about to draw; free/busy is clamped to 120 days by the database.
 */
export async function readGridSource(
	owner: ScheduleOwner,
	kind: BandKind,
	window: { from: number; to: number },
	client: SupabaseClient = getAnonClient(),
): Promise<GridSource | undefined> {
	try {
		const schedule = await client.schema("scheduling").from("schedules")
			.select("id, timezone, is_published")
			.eq("owner_type", owner.type)
			.eq("owner_id", owner.id)
			.maybeSingle();
		if (schedule.error) return undefined;
		const row = schedule.data as ScheduleRow | null;
		if (!row || !row.is_published) return closedSource(row?.timezone ?? "UTC", UNPUBLISHED_REASON);

		const fromIso = new Date(window.from).toISOString();
		const toIso = new Date(window.to).toISOString();
		const [bands, blackouts, guards, busy] = await Promise.all([
			client.schema("scheduling").from("availability_rules")
				.select("weekday, start_minute, end_minute")
				.eq("schedule_id", row.id)
				.eq("kind", kind)
				.eq("is_active", true),
			client.schema("scheduling").from("blackout_dates")
				.select("starts_at, ends_at")
				.eq("schedule_id", row.id)
				.lt("starts_at", toIso)
				.gt("ends_at", fromIso),
			client.schema("scheduling").from("call_settings")
				.select("min_notice_minutes, max_advance_days, buffer_before_minutes, buffer_after_minutes")
				.eq("schedule_id", row.id)
				.maybeSingle(),
			client.schema("scheduling").rpc("get_free_busy", {
				p_schedule: row.id,
				p_from: fromIso,
				p_to: toIso,
			}),
		]);
		if (bands.error || blackouts.error || guards.error || busy.error) return undefined;

		const g = guards.data as GuardRow | null;
		const rules: GridRules = g
			? {
				minNoticeMinutes: g.min_notice_minutes,
				maxAdvanceDays: g.max_advance_days,
				bufferBeforeMinutes: g.buffer_before_minutes,
				bufferAfterMinutes: g.buffer_after_minutes,
			}
			: DEFAULT_GRID_RULES;

		return {
			timezone: row.timezone,
			bands: ((bands.data ?? []) as BandRow[]).map((b): GridBand => ({
				weekday: b.weekday,
				startMinute: b.start_minute,
				endMinute: b.end_minute,
			})),
			blackouts: ((blackouts.data ?? []) as SpanRow[]).map(spanOf),
			busy: ((busy.data ?? []) as SpanRow[]).map(spanOf),
			rules,
			closedReason: null,
		};
	} catch {
		return undefined;
	}
}

/**
 * The id of an owner's PUBLISHED schedule — what a booking is made against. `null` when the owner has
 * none or has not published it; `undefined` when the database could not answer.
 */
export async function scheduleIdOf(
	owner: ScheduleOwner,
	client: SupabaseClient = getAnonClient(),
): Promise<string | null | undefined> {
	try {
		const { data, error } = await client.schema("scheduling").from("schedules")
			.select("id, is_published")
			.eq("owner_type", owner.type)
			.eq("owner_id", owner.id)
			.maybeSingle();
		if (error) return undefined;
		const row = data as { id: string; is_published: boolean } | null;
		return row?.is_published ? row.id : null;
	} catch {
		return undefined;
	}
}

/** A schedule that offers nothing, with the sentence that says why. */
export function closedSource(timezone: string, reason: string): GridSource {
	return {
		timezone,
		bands: [],
		blackouts: [],
		busy: [],
		rules: DEFAULT_GRID_RULES,
		closedReason: reason,
	};
}
// #endregion
