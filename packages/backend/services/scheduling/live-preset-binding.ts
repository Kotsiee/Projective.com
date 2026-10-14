import type { SupabaseClient } from "supabaseClient";
import type {
	BindListingAvailabilityResult,
	ListingAvailabilityBinding,
} from "@projective/types/catalogue";
import type { BindListingAvailability } from "@projective/types/scheduling";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { ownedListing } from "../catalogue/live-catalogue.ts";
import { compilePreset } from "./live-occurrences.ts";
import {
	type PresetDeps,
	readPresets,
	scheduleOf,
	type ScheduleRow,
	type StoredPreset,
} from "./live-presets.ts";
import { forkInput, presetPayload, presetRefusal } from "./preset-model.ts";

/**
 * live-preset-binding — which availability a Session or Group Session listing books against (plan
 * §5.5, Decision #217 (c)), written as the seller:
 *
 * - `default`: no binding stored; the listing follows its schedule's default preset;
 * - `preset`: linked to a library preset, so edits to it flow to every listing bound to it;
 * - `override`: a `scope = 'service'` copy of the named preset that only this listing uses. A
 *   listing has at most one live fork, so overriding again rewrites that fork rather than minting
 *   another — the operation is idempotent.
 *
 * `trg_blueprint_preset_binding` re-checks every binding in the database (a live preset, on the
 * blueprint owner's schedule, and only this listing's own fork).
 */

type Result<T> = ServiceResult<T>;
type LiveActor = ReadActor & { accessToken: string };

// #region Rows & refusals
interface BlueprintRow {
	id: string;
	freelancer_profile_id: string;
	owner_team_id: string | null;
	delivery_model: string;
	availability_preset_id: string | null;
}

const TIMED = new Set(["session", "group_session"]);

function noPreset<T>(): Result<T> {
	const message = "That preset no longer exists.";
	return fail(404, { message, errors: { presetId: message } });
}

function notTimed<T>(): Result<T> {
	const message = "Only sessions are booked from a schedule.";
	return fail(422, { message, errors: { listingId: message } });
}
// #endregion

// #region Writes
async function setBinding(
	db: SupabaseClient,
	blueprintId: string,
	presetId: string | null,
): Promise<Result<never> | null> {
	const { error } = await db.schema("marketplace").from("service_blueprints")
		.update({ availability_preset_id: presetId }).eq("id", blueprintId);
	return error ? presetRefusal(error) : null;
}

/** The listing's binding as the console reads it, from the preset its blueprint now resolves to. */
async function resolved(
	db: SupabaseClient,
	schedule: ScheduleRow,
	blueprint: BlueprintRow,
	boundId: string | null,
): Promise<BindListingAvailabilityResult> {
	const { data, error } = await db.schema("scheduling").rpc("fn_preset_for_blueprint", {
		p_blueprint: blueprint.id,
	});
	if (error) throw new Error(`fn_preset_for_blueprint failed: ${error.message}`);
	const presetId = data as string | null;
	const [stored] = presetId ? await readPresets(db, schedule, [presetId]) : [];
	if (!stored) return { binding: null, preset: null };
	const bound = boundId === stored.row.id;
	const binding: ListingAvailabilityBinding = {
		mode: !bound ? "default" : stored.row.scope === "service" ? "override" : "preset",
		presetId: bound ? stored.row.id : null,
		presetName: stored.row.name.slice(0, 60),
	};
	return { binding, preset: stored.preset };
}

/**
 * Write `blueprint`'s own fork of `source` — creating it, or rewriting the live one — and compile it.
 * Answers the fork's id. A source that IS the fork needs no copy.
 */
async function writeFork(
	db: SupabaseClient,
	schedule: ScheduleRow,
	blueprint: BlueprintRow,
	source: StoredPreset,
	deps: PresetDeps,
): Promise<string | Result<never>> {
	const forks = await db.schema("scheduling").from("availability_presets").select("id")
		.eq("schedule_id", schedule.id).eq("blueprint_id", blueprint.id).is("archived_at", null);
	if (forks.error) throw new Error(`availability_presets read failed: ${forks.error.message}`);
	const forkId = ((forks.data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
	if (forkId === source.row.id) return forkId;

	const { data, error } = await db.schema("scheduling").rpc("save_availability_preset", {
		p_schedule: schedule.id,
		p_preset: presetPayload(forkInput(source.preset, blueprint.id, forkId)),
	});
	if (error) return presetRefusal(error);
	const id = data as string;
	try {
		await compilePreset(id, { now: deps.now, db: deps.service });
	} catch (err) {
		console.error(
			"[scheduling:presets] fork compile failed",
			err instanceof Error ? err.message : err,
		);
	}
	return id;
}

// #endregion

// #region Bind
/** Bind a listing's availability (`POST /api/catalogue/availability`). */
export async function bindListing(
	input: BindListingAvailability,
	actor: LiveActor,
	deps: PresetDeps,
): Promise<Result<BindListingAvailabilityResult>> {
	const db = deps.db;
	const listing = await ownedListing(db, input.listingId, actor);
	if (!listing) return fail(404, { message: "No such listing." });
	if (!listing.service_blueprint_id) return notTimed();

	const bp = await db.schema("marketplace").from("service_blueprints")
		.select("id, freelancer_profile_id, owner_team_id, delivery_model, availability_preset_id")
		.eq("id", listing.service_blueprint_id).maybeSingle();
	if (bp.error) throw new Error(`service_blueprints read failed: ${bp.error.message}`);
	const blueprint = bp.data as BlueprintRow | null;
	if (!blueprint) return fail(404, { message: "No such listing." });
	if (!TIMED.has(blueprint.delivery_model)) return notTimed();

	const schedule = await scheduleOf(
		db,
		blueprint.owner_team_id
			? { type: "team", id: blueprint.owner_team_id }
			: { type: "user", id: blueprint.freelancer_profile_id },
	);
	if (!schedule) {
		const message = "Set up your availability before choosing a preset.";
		return fail(422, { message, errors: { presetId: message } });
	}

	let target: string | null = null;
	if (input.mode !== "default") {
		const [source] = await readPresets(db, schedule, [input.presetId ?? ""]);
		if (!source) return noPreset();
		if (input.mode === "preset") {
			if (source.row.scope !== "library") {
				const message = "Choose a preset from your library.";
				return fail(422, { message, errors: { presetId: message } });
			}
			target = source.row.id;
		} else {
			if (source.row.scope === "service" && source.row.blueprint_id !== blueprint.id) {
				return noPreset();
			}
			const fork = await writeFork(db, schedule, blueprint, source, deps);
			if (typeof fork !== "string") return fork;
			target = fork;
		}
	}

	if (blueprint.availability_preset_id !== target) {
		const refused = await setBinding(db, blueprint.id, target);
		if (refused) return refused;
	}
	return ok(await resolved(db, schedule, blueprint, target), {
		message: input.mode === "override" ? "This listing now has its own availability." : "Saved.",
	});
}
// #endregion
