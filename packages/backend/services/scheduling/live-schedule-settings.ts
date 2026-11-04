import {
	type BlackoutInput,
	BlackoutInputSchema,
	type ScheduleSettings,
	zonedSpan,
} from "@projective/types/scheduling";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { compilePreset } from "./live-occurrences.ts";
import { presetRefusal } from "./preset-model.ts";
import {
	actorScheduleOwner,
	type PresetDeps,
	readScheduleSettings,
	scheduleOf,
	type ScheduleRow,
} from "./live-presets.ts";

/**
 * live-schedule-settings — the schedule-wide half of the `/calendar` availability view: the blackout
 * dates cut out of every preset. Written as the signed-in owner; the blackout policy
 * (`fn_owner_manages`) decides whose schedule that is, so a stranger's write is a `403`, never a
 * silent no-op. The zone and publishing are Settings' (Decision #378).
 *
 * A blackout changes what the compiled occurrences say — a preset is evaluated minus its schedule's
 * blackouts — so each write recompiles the schedule's live presets afterwards. The booking
 * gate reads blackouts on its own (`fn_is_blacked_out`), so a recompile that fails leaves only the
 * public calendar stale until the horizon job: it is logged, never turned into a refused write.
 */

type Result<T> = ServiceResult<T>;
type LiveActor = ReadActor & { accessToken: string };

// #region Helpers
function fieldErrors(
	issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const issue of issues) errors[issue.path.map(String).join(".") || "form"] ??= issue.message;
	return errors;
}

/** Recompile every live preset of a schedule; failures are logged, the write already stands. */
async function recompile(deps: PresetDeps, schedule: ScheduleRow, now: number): Promise<void> {
	const { data, error } = await deps.db.schema("scheduling").from("availability_presets")
		.select("id").eq("schedule_id", schedule.id).is("archived_at", null);
	if (error) {
		console.error("[scheduling:settings] preset list for recompile failed", error.message);
		return;
	}
	for (const { id } of (data ?? []) as Array<{ id: string }>) {
		try {
			await compilePreset(id, { now, db: deps.service });
		} catch (err) {
			console.error(
				"[scheduling:settings] recompile failed",
				id,
				err instanceof Error ? err.message : err,
			);
		}
	}
}

function noSchedule<T>(field: string): Result<T> {
	const message = "Save your hours once before booking time off.";
	return fail(422, { message, errors: { [field]: message } });
}
// #endregion

// #region Blackouts
/**
 * Book whole days off: local midnight of `startsOn` to the midnight after `endsOn`, in the schedule's
 * zone. The label stays private unless the owner opts in (`label_is_public`, default false); a
 * visitor otherwise sees "Unavailable".
 */
export async function addBlackout(
	input: BlackoutInput,
	actor: LiveActor,
	deps: PresetDeps,
): Promise<Result<ScheduleSettings>> {
	const parsed = BlackoutInputSchema.safeParse(input);
	if (!parsed.success) {
		const errors = fieldErrors(parsed.error.issues);
		return fail(422, { message: Object.values(errors)[0] ?? "Check the dates.", errors });
	}
	const schedule = await scheduleOf(deps.db, actorScheduleOwner(actor));
	if (!schedule) return noSchedule("startsOn");
	const { startsOn, endsOn, label, labelIsPublic } = parsed.data;
	const { error } = await deps.db.schema("scheduling").from("blackout_dates").insert({
		schedule_id: schedule.id,
		starts_at: new Date(zonedSpan(startsOn, 0, 0, schedule.timezone).startsAt).toISOString(),
		ends_at: new Date(zonedSpan(endsOn, 0, 1440, schedule.timezone).endsAt).toISOString(),
		label,
		label_is_public: labelIsPublic,
	});
	if (error) return presetRefusal(error);
	const now = deps.now ?? Date.now();
	await recompile(deps, schedule, now);
	return ok(await readScheduleSettings(deps.db, schedule, now), { message: "Time off added." });
}

/** Remove one blackout from the acting owner's schedule; a row that is not theirs is a `404`. */
export async function removeBlackout(
	id: string,
	actor: LiveActor,
	deps: PresetDeps,
): Promise<Result<ScheduleSettings>> {
	const schedule = await scheduleOf(deps.db, actorScheduleOwner(actor));
	if (!schedule) return fail(404, { message: "That time off no longer exists." });
	const { data, error } = await deps.db.schema("scheduling").from("blackout_dates").delete()
		.eq("id", id).eq("schedule_id", schedule.id).select("id");
	if (error) return presetRefusal(error);
	if (!data?.length) return fail(404, { message: "That time off no longer exists." });
	const now = deps.now ?? Date.now();
	await recompile(deps, schedule, now);
	return ok(await readScheduleSettings(deps.db, schedule, now), { message: "Time off removed." });
}
// #endregion
