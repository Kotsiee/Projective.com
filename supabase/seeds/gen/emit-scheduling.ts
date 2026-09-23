/**
 * emit-scheduling.ts — `08_scheduling.sql`: every published schedule, its weekly bands, blackouts,
 * call settings and platforms, the commitments already on it, and the discovery calls in flight.
 *
 * Runs after identities, entities, listings and projects (a schedule is owned by a person or a team,
 * and a call may be about a listing). Nothing later depends on it, so it sorts after `08_comms.sql`
 * and before the hand-written search projection.
 *
 * The seed inserts as the table owner, so `auth.uid()` is NULL and the discovery-call booking gate
 * (`fn_enforce_call_request`) steps aside — it guards the CLIENT path. The calls below are still
 * written to satisfy it (inside a call window, the configured length, the host's fee) so the world
 * reads the way a real one would.
 */

import { HEADER, id, insert, localAt, minutesOf, num, q, uuidFor } from "./sql.ts";
import { type Lookup, party, persona, type World } from "./resolve.ts";
import {
	type Band,
	DISCOVERY_CALLS,
	type ScheduleSpec,
	SCHEDULES,
	type WeekSlot,
} from "./schedules.ts";

/** The schedule an owner key resolves to: the owner row, its zone, and the person who hosts calls. */
interface ResolvedSchedule {
	spec: ScheduleSpec;
	scheduleId: string;
	ownerType: "user" | "team";
	ownerId: string;
	hostUserId: string;
	timezone: string;
}

function resolveSchedule(world: Lookup, spec: ScheduleSpec): ResolvedSchedule {
	const who = party(world, spec.owner);
	const scheduleId = uuidFor("schedule", spec.owner);
	if (who.kind === "user") {
		return {
			spec,
			scheduleId,
			ownerType: "user",
			ownerId: who.persona.userId,
			hostUserId: who.persona.userId,
			timezone: who.persona.timezone,
		};
	}
	if (who.kind !== "team") {
		throw new Error(`schedules: "${spec.owner}" is a ${who.kind}; only people and teams publish schedules`);
	}
	return {
		spec,
		scheduleId,
		ownerType: "team",
		ownerId: who.entity.entityId,
		hostUserId: who.entity.ownerUserId,
		timezone: who.entity.timezone,
	};
}

/** Refuse a spec the owner's Availability editor could not round-trip. */
function assertBands(owner: string, kind: string, bands: Band[]): void {
	for (const [weekday, start, end] of bands) {
		if (minutesOf(end) <= minutesOf(start)) {
			throw new Error(`schedules: ${owner} ${kind} band on ${weekday} ends before it starts`);
		}
	}
	for (let i = 0; i < bands.length; i++) {
		for (let j = i + 1; j < bands.length; j++) {
			const [da, sa, ea] = bands[i];
			const [db, sb, eb] = bands[j];
			if (da === db && minutesOf(sa) < minutesOf(eb) && minutesOf(sb) < minutesOf(ea)) {
				throw new Error(`schedules: ${owner} has overlapping ${kind} bands on weekday ${da}`);
			}
		}
	}
}

/** A `WeekSlot` in the owner's zone as a SQL timestamptz expression, shifted by `plusMinutes`. */
function at(tz: string, slot: WeekSlot, plusMinutes = 0): string {
	return localAt(tz, slot.week, slot.day, minutesOf(slot.time) + plusMinutes);
}

export function emitScheduling(world: World): string {
	const out: string[] = [
		HEADER(
			"08_scheduling.sql — schedules, bands, blackouts, call settings, commitments, discovery calls",
			"Generated from supabase/seeds/gen/schedules.ts. Times are wall-clock times in each owner's zone, placed relative to the current week.",
		),
	];

	const resolved = SCHEDULES.map((spec) => resolveSchedule(world, spec));
	const byOwner = new Map(resolved.map((r) => [r.spec.owner, r]));

	// #region Schedules
	out.push(insert(
		"scheduling.schedules",
		["id", "owner_type", "owner_id", "timezone", "is_published", "mask_external_events"],
		resolved.map((r) => [
			id(r.scheduleId),
			`${q(r.ownerType)}::scheduling.owner_type`,
			id(r.ownerId),
			q(r.timezone),
			r.spec.published ? "true" : "false",
			"true",
		]),
		"(owner_type, owner_id)",
	));
	// #endregion

	// #region Weekly bands
	const bandRows: string[][] = [];
	for (const r of resolved) {
		assertBands(r.spec.owner, "working_hours", r.spec.working);
		assertBands(r.spec.owner, "call_window", r.spec.calls);
		const kinds: Array<["working_hours" | "call_window", Band[]]> = [
			["working_hours", r.spec.working],
			["call_window", r.spec.calls],
		];
		for (const [kind, bands] of kinds) {
			for (const [weekday, start, end] of bands) {
				bandRows.push([
					id(uuidFor("availability-rule", `${r.spec.owner}:${kind}:${weekday}:${start}`)),
					id(r.scheduleId),
					`${q(kind)}::scheduling.availability_kind`,
					String(weekday),
					String(minutesOf(start)),
					String(minutesOf(end)),
					"true",
				]);
			}
		}
	}
	out.push(insert(
		"scheduling.availability_rules",
		["id", "schedule_id", "kind", "weekday", "start_minute", "end_minute", "is_active"],
		bandRows,
	));
	// #endregion

	// #region Blackouts
	out.push(insert(
		"scheduling.blackout_dates",
		["id", "schedule_id", "starts_at", "ends_at", "label", "label_is_public"],
		resolved.flatMap((r) =>
			(r.spec.blackouts ?? []).map((b, i) => [
				id(uuidFor("blackout", `${r.spec.owner}:${i}`)),
				id(r.scheduleId),
				at(r.timezone, b.from),
				at(r.timezone, b.to),
				q(b.label),
				b.public ? "true" : "false",
			])
		),
	));
	// #endregion

	// #region Call settings + platforms
	const withCalls = resolved.filter((r) => r.spec.call);
	out.push(insert(
		"scheduling.call_settings",
		[
			"schedule_id",
			"accepts_calls",
			"courtesy_enabled",
			"courtesy_duration_minutes",
			"courtesy_max_per_week",
			"courtesy_cooldown_days",
			"paid_enabled",
			"paid_duration_minutes",
			"fee_amount_minor",
			"fee_currency",
			"buffer_before_minutes",
			"buffer_after_minutes",
			"min_notice_minutes",
			"max_advance_days",
			"auto_confirm",
			"agenda_required",
			"preferred_provider_slug",
		],
		withCalls.map((r) => {
			const c = r.spec.call!;
			if (!c.courtesy && !c.paid) {
				throw new Error(`schedules: ${r.spec.owner} accepts calls but offers no flavour`);
			}
			if (r.spec.calls.length === 0) {
				throw new Error(`schedules: ${r.spec.owner} takes calls but publishes no call window`);
			}
			return [
				id(r.scheduleId),
				"true",
				c.courtesy ? "true" : "false",
				String(c.courtesy?.minutes ?? 15),
				String(c.courtesy?.maxPerWeek ?? 0),
				String(c.courtesy?.cooldownDays ?? 0),
				c.paid ? "true" : "false",
				String(c.paid?.minutes ?? 30),
				num(c.paid?.feeMinor ?? null),
				q(c.paid?.currency ?? null),
				String(c.bufferBefore),
				String(c.bufferAfter),
				String(c.noticeMinutes),
				String(c.advanceDays),
				c.autoConfirm ? "true" : "false",
				c.agendaRequired ? "true" : "false",
				q(c.platforms[0] ?? null),
			];
		}),
		"(schedule_id)",
	));
	out.push(insert(
		"scheduling.call_platforms",
		["schedule_id", "provider_slug", "position"],
		withCalls.flatMap((r) =>
			r.spec.call!.platforms.map((slug, position) => [id(r.scheduleId), q(slug), String(position)])
		),
		"(schedule_id, provider_slug)",
	));
	// #endregion

	// #region Commitments
	out.push(insert(
		"scheduling.events",
		["id", "schedule_id", "kind", "status", "title", "starts_at", "ends_at", "is_masked", "created_by"],
		resolved.flatMap((r) =>
			(r.spec.events ?? []).map((e, i) => [
				id(uuidFor("schedule-event", `${r.spec.owner}:${i}`)),
				id(r.scheduleId),
				`${q(e.kind)}::scheduling.event_kind`,
				`'confirmed'::scheduling.event_status`,
				q(e.title),
				at(r.timezone, e.at),
				at(r.timezone, e.at, e.minutes),
				"false",
				id(r.hostUserId),
			])
		),
	));
	// #endregion

	// #region Discovery calls
	const callRows = DISCOVERY_CALLS.map((c) => {
		const host = byOwner.get(c.host);
		if (!host?.spec.call) throw new Error(`schedules: call "${c.key}" is hosted by "${c.host}", who takes no calls`);
		const settings = host.spec.call;
		const flavour = c.type === "paid" ? settings.paid : settings.courtesy;
		if (!flavour) throw new Error(`schedules: call "${c.key}" is ${c.type}, which "${c.host}" does not offer`);
		if (c.platform && !settings.platforms.includes(c.platform)) {
			throw new Error(`schedules: call "${c.key}" is on ${c.platform}, which "${c.host}" does not offer`);
		}
		const requester = persona(world, c.requester);
		const start = at(host.timezone, c.at);
		const end = at(host.timezone, c.at, flavour.minutes);
		const confirmed = c.status === "confirmed" || c.status === "completed";
		const fee = c.type === "paid" ? settings.paid! : null;
		return [
			id(uuidFor("discovery-call", c.key)),
			id(host.scheduleId),
			id(host.hostUserId),
			id(requester.userId),
			`${q(c.type)}::scheduling.call_type`,
			`${q(c.status)}::scheduling.call_status`,
			start,
			end,
			confirmed ? start : "NULL",
			confirmed ? end : "NULL",
			q(requester.timezone),
			q(c.agenda),
			id(c.listing ? world.serviceId(c.listing) : null),
			q(c.platform),
			num(fee?.feeMinor ?? null),
			q(fee?.currency ?? null),
			`${start} - interval '${c.requestedDaysBefore * 24} hours'`,
			confirmed ? `${start} - interval '${Math.max(1, c.requestedDaysBefore - 1) * 24} hours'` : "NULL",
			c.status === "completed" ? end : "NULL",
		];
	});
	out.push(insert(
		"scheduling.discovery_calls",
		[
			"id",
			"host_schedule_id",
			"host_user_id",
			"requester_user_id",
			"call_type",
			"status",
			"proposed_start",
			"proposed_end",
			"confirmed_start",
			"confirmed_end",
			"requester_timezone",
			"agenda",
			"service_blueprint_id",
			"provider_slug",
			"fee_amount_minor",
			"fee_currency",
			"proposed_at",
			"confirmed_at",
			"completed_at",
		],
		callRows,
	));
	// #endregion

	// A trailing marker, so a partial run is visible in the reset log.
	out.push(`-- scheduling: ${resolved.length} schedules, ${bandRows.length} bands, ${callRows.length} calls.\n`);
	return out.join("\n");
}
