import type { SupabaseClient } from "supabaseClient";
import {
	DEFAULT_CALL_SETTINGS,
	type OwnerAvailability,
	type OwnerBand,
	type OwnerCallSettings,
} from "@projective/types/scheduling";
import type { ProfileOwnerType } from "@projective/types/profile";

/**
 * live-owner-availability — a profile owner's schedule, read and written live: the weekly bands,
 * the timezone and published flag, and the discovery-call settings (`scheduling.schedules` +
 * `availability_rules` + `call_settings` + `call_platforms`).
 *
 * {@link fetchOwnerAvailability} is the OWNER's editor seed, read under their own session (the
 * "Manage …" policies decide it is theirs), including a draft schedule a visitor cannot see. The
 * VISITOR's view of the same call settings is `./live-call-offer.ts`, which reads only a published
 * schedule.
 *
 * The one write, {@link saveOwnerAvailability}, is a single `scheduling.save_owner_availability`
 * call: the timezone, the bands and the call settings land in one transaction, because a timezone
 * saved without the bands expressed in it re-times every band.
 *
 * Every function returns `undefined` when the database could not answer — never a default dressed up
 * as the owner's settings.
 */

// #region Owner vocabulary

/**
 * The schedule owner a profile owner maps to. An individual is ONE schedule (`user`) whatever their
 * freelancer flag, so switching it can never strand a second calendar.
 */
export function scheduleOwnerType(
	type: ProfileOwnerType,
): "user" | "team" | "business" | "organisation" {
	return type;
}

// #endregion

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
	is_active: boolean;
}

/** One `scheduling.call_settings` row as selected by {@link CALL_COLUMNS}. */
export interface CallRow {
	accepts_calls: boolean;
	courtesy_enabled: boolean;
	courtesy_duration_minutes: number;
	courtesy_max_per_week: number;
	courtesy_cooldown_days: number;
	paid_enabled: boolean;
	paid_duration_minutes: number;
	fee_amount_minor: number | string | null;
	fee_currency: string | null;
	buffer_before_minutes: number;
	buffer_after_minutes: number;
	min_notice_minutes: number;
	max_advance_days: number;
	auto_confirm: boolean;
	agenda_required: boolean;
}

export const CALL_COLUMNS =
	"accepts_calls, courtesy_enabled, courtesy_duration_minutes, courtesy_max_per_week, courtesy_cooldown_days, paid_enabled, paid_duration_minutes, fee_amount_minor, fee_currency, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_advance_days, auto_confirm, agenda_required";

/** A call-settings row as the editor's value. */
export function toCallSettings(row: CallRow): OwnerCallSettings {
	const fee = row.fee_amount_minor === null ? null : Number(row.fee_amount_minor);
	return {
		acceptsCalls: row.accepts_calls,
		courtesyEnabled: row.courtesy_enabled,
		courtesyDurationMinutes: row.courtesy_duration_minutes,
		courtesyMaxPerWeek: row.courtesy_max_per_week,
		courtesyCooldownDays: row.courtesy_cooldown_days,
		paidEnabled: row.paid_enabled,
		paidDurationMinutes: row.paid_duration_minutes,
		feeAmountMinor: fee !== null && Number.isFinite(fee) ? fee : null,
		feeCurrency: row.fee_currency?.trim() || null,
		bufferBeforeMinutes: row.buffer_before_minutes,
		bufferAfterMinutes: row.buffer_after_minutes,
		minNoticeMinutes: row.min_notice_minutes,
		maxAdvanceDays: row.max_advance_days,
		autoConfirm: row.auto_confirm,
		agendaRequired: row.agenda_required,
	};
}

async function scheduleOf(
	client: SupabaseClient,
	owner: { type: ProfileOwnerType; id: string },
): Promise<ScheduleRow | null | undefined> {
	const { data, error } = await client.schema("scheduling").from("schedules")
		.select("id, timezone, is_published")
		.eq("owner_type", scheduleOwnerType(owner.type))
		.eq("owner_id", owner.id)
		.maybeSingle();
	if (error) return undefined;
	return (data as ScheduleRow | null) ?? null;
}

// #endregion

// #region The owner's editor seed

/**
 * Everything the Availability editor is seeded with. An owner who has never saved a schedule gets
 * an empty, unpublished draft in `fallbackTimezone` — the editor's starting point, not a claim that
 * they published anything. `call` is `null` for a buyer entity, which takes no calls.
 */
export async function fetchOwnerAvailability(
	client: SupabaseClient,
	owner: { type: ProfileOwnerType; id: string },
	options: { takesCalls: boolean; fallbackTimezone: string },
): Promise<OwnerAvailability | undefined> {
	try {
		const schedule = await scheduleOf(client, owner);
		if (schedule === undefined) return undefined;
		if (!schedule) {
			return {
				timezone: options.fallbackTimezone,
				published: false,
				bands: [],
				call: options.takesCalls ? { ...DEFAULT_CALL_SETTINGS } : null,
			};
		}
		const [rules, call] = await Promise.all([
			client.schema("scheduling").from("availability_rules")
				.select("weekday, start_minute, end_minute, kind, is_active")
				.eq("schedule_id", schedule.id)
				.order("weekday")
				.order("start_minute"),
			client.schema("scheduling").from("call_settings")
				.select(CALL_COLUMNS)
				.eq("schedule_id", schedule.id)
				.maybeSingle(),
		]);
		if (rules.error || call.error) return undefined;
		const bands: OwnerBand[] = ((rules.data ?? []) as RuleRow[])
			.filter((r) => r.is_active)
			.map((r) => ({
				weekday: r.weekday,
				startMinute: r.start_minute,
				endMinute: r.end_minute,
				kind: r.kind,
			}));
		return {
			timezone: schedule.timezone,
			published: schedule.is_published,
			bands,
			call: options.takesCalls
				? call.data ? toCallSettings(call.data as CallRow) : { ...DEFAULT_CALL_SETTINGS }
				: null,
		};
	} catch {
		return undefined;
	}
}

// #endregion

// #region The write

/** The `save_owner_availability` payload for an editor value. */
export function availabilityPayload(value: OwnerAvailability): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		timezone: value.timezone,
		published: value.published,
		rules: value.bands.map((b) => ({
			weekday: b.weekday,
			start_minute: b.startMinute,
			end_minute: b.endMinute,
			kind: b.kind,
		})),
	};
	if (value.call) {
		const c = value.call;
		payload.call = {
			accepts_calls: c.acceptsCalls,
			courtesy_enabled: c.courtesyEnabled,
			courtesy_duration_minutes: c.courtesyDurationMinutes,
			courtesy_max_per_week: c.courtesyMaxPerWeek,
			courtesy_cooldown_days: c.courtesyCooldownDays,
			paid_enabled: c.paidEnabled,
			paid_duration_minutes: c.paidDurationMinutes,
			// Kept while paid calls are switched off, so turning them back on restores the fee.
			fee_amount_minor: c.feeAmountMinor,
			fee_currency: c.feeCurrency,
			buffer_before_minutes: c.bufferBeforeMinutes,
			buffer_after_minutes: c.bufferAfterMinutes,
			min_notice_minutes: c.minNoticeMinutes,
			max_advance_days: c.maxAdvanceDays,
			auto_confirm: c.autoConfirm,
			agenda_required: c.agendaRequired,
		};
	}
	return payload;
}

/** Save the whole editor value in one transaction. Resolves the raw error for the caller to map. */
export async function saveOwnerAvailability(
	client: SupabaseClient,
	owner: { type: ProfileOwnerType; id: string },
	value: OwnerAvailability,
): Promise<{ error: { code?: string; message: string } | null }> {
	try {
		const { error } = await client.schema("scheduling").rpc("save_owner_availability", {
			p_owner_type: scheduleOwnerType(owner.type),
			p_owner_id: owner.id,
			p_payload: availabilityPayload(value),
		});
		return { error: error ? { code: error.code, message: error.message } : null };
	} catch (error) {
		return { error: { message: error instanceof Error ? error.message : String(error) } };
	}
}

// #endregion
