import type { SupabaseClient } from "supabaseClient";
import type { CalendarEvent, CalendarScope, SchedulePage } from "@projective/types/scheduling";
import { getAnonClient } from "../../core/supabase.ts";
import { readPublicCallOffer } from "./live-call-offer.ts";
import type { ScheduleOwner } from "./live-slots.ts";

/**
 * live-schedule-page — the PUBLIC view of a provider's calendar: their published bands, their time
 * off, and when they are busy — the page a profile's availability route and a session listing's
 * schedule render.
 *
 * It discloses exactly what the booking grid already does and no more: bands and blackout spans are
 * world-readable by policy, a blackout's label only when its owner marked it public, and busy time
 * arrives through `scheduling.get_free_busy` as bare spans, so every commitment renders as a masked
 * "Busy" block with no title, no attendees and no link. A visitor learns when to book, never what the
 * provider is doing.
 *
 * Returns `null` when the owner has no published schedule (the page then says so), `undefined` when
 * the database could not answer.
 */

// #region Rows
interface ScheduleRow {
	id: string;
	timezone: string;
	is_published: boolean;
}

interface RuleRow {
	weekday: number;
	start_minute: number;
	end_minute: number;
	kind: "working_hours" | "call_window";
}

interface BlackoutRow {
	starts_at: string;
	ends_at: string;
	label: string;
	label_is_public: boolean;
}

interface SpanRow {
	starts_at: string;
	ends_at: string;
}
// #endregion

/** What the caller knows about the page that the schedule itself does not. */
export interface SchedulePageMeta {
	scope: Extract<CalendarScope, "availability" | "schedule">;
	title: string;
	subtitle: string | null;
	/** The owner's `@handle`, for booking attribution. */
	ownerHandle: string | null;
	/** Whether a slot on this page opens a booking flow. */
	viewerCanBook: boolean;
	/** The instant the page is resolved against — stamped onto it as `SchedulePage.now`. */
	now: number;
}

/**
 * Read an owner's published schedule as a public {@link SchedulePage} over `[from, to)` (epoch ms).
 */
export async function readSchedulePage(
	owner: ScheduleOwner,
	meta: SchedulePageMeta,
	window: { from: number; to: number },
	client: SupabaseClient = getAnonClient(),
): Promise<SchedulePage | null | undefined> {
	try {
		const schedule = await client.schema("scheduling").from("schedules")
			.select("id, timezone, is_published")
			.eq("owner_type", owner.type)
			.eq("owner_id", owner.id)
			.maybeSingle();
		if (schedule.error) return undefined;
		const row = schedule.data as ScheduleRow | null;
		if (!row || !row.is_published) return null;

		const fromIso = new Date(window.from).toISOString();
		const toIso = new Date(window.to).toISOString();
		const [rules, blackouts, busy, callOffer] = await Promise.all([
			client.schema("scheduling").from("availability_rules")
				.select("weekday, start_minute, end_minute, kind")
				.eq("schedule_id", row.id)
				.eq("is_active", true)
				.order("weekday")
				.order("start_minute"),
			client.schema("scheduling").from("blackout_dates")
				.select("starts_at, ends_at, label, label_is_public")
				.eq("schedule_id", row.id)
				.lt("starts_at", toIso)
				.gt("ends_at", fromIso),
			client.schema("scheduling").rpc("get_free_busy", {
				p_schedule: row.id,
				p_from: fromIso,
				p_to: toIso,
			}),
			readPublicCallOffer(client, owner),
		]);
		if (rules.error || blackouts.error || busy.error || callOffer === undefined) return undefined;

		const events: CalendarEvent[] = ((busy.data ?? []) as SpanRow[]).map((span) => {
			const start = Date.parse(span.starts_at);
			return {
				id: `busy-${start}`,
				title: "Busy",
				kind: "busy",
				status: "busy",
				start,
				end: Date.parse(span.ends_at),
				masked: true,
			};
		});

		return {
			scope: meta.scope,
			title: meta.title,
			subtitle: meta.subtitle,
			timezone: row.timezone,
			ownerHandle: meta.ownerHandle,
			viewerCanBook: meta.viewerCanBook,
			availability: {
				timezone: row.timezone,
				rules: ((rules.data ?? []) as RuleRow[]).map((r) => ({
					weekday: r.weekday,
					startMinute: r.start_minute,
					endMinute: r.end_minute,
					kind: r.kind,
				})),
				blackouts: ((blackouts.data ?? []) as BlackoutRow[]).map((b) => ({
					start: Date.parse(b.starts_at),
					end: Date.parse(b.ends_at),
					// A private label stays private: the span is public, what it is for is not.
					label: b.label_is_public ? b.label : "Unavailable",
				})),
			},
			events,
			callOffer: callOffer ?? undefined,
			now: meta.now,
		};
	} catch {
		return undefined;
	}
}
