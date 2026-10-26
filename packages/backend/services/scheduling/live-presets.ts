import type { SupabaseClient } from "supabaseClient";
import {
	type ArchivePresetResult,
	type AvailabilityPreset,
	dateInZone,
	type PresetListResult,
	type PresetUser,
	type SavePresetInput,
	SavePresetInputSchema,
	type SavePresetResult,
	validate,
} from "@projective/types/scheduling";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { availabilityPayload } from "./live-owner-availability.ts";
import { compilePreset } from "./live-occurrences.ts";
import {
	BAND_COLUMNS,
	hardIssues,
	issueErrors,
	mirrorProjection,
	PRESET_COLUMNS,
	presetFromRows,
	presetPayload,
	presetRefusal,
	type PresetRow,
	RULE_COLUMNS,
	type RuleBandRow,
	type RuleRow,
} from "./preset-model.ts";

/**
 * live-presets — an owner's availability presets, read and written as the signed-in owner (plan
 * §5.5–§5.6). The preset, rule and band policies (`fn_can_manage_schedule`) decide what is theirs;
 * `scheduling.save_availability_preset` and `archive_availability_preset` are the writes, and every
 * refusal they raise is mapped by `preset-model.ts`.
 *
 * A save is three steps, in order: the door writes the rules, `live-occurrences.ts` compiles them for
 * the gate (service role), and — for the default preset — its weekly part is mirrored into the
 * `availability_rules` that discovery calls and `/[handle]/availability` still read (Decision
 * #217 (d)). The rules are the truth; a compile or mirror that fails is reported, never rolled back
 * into a refused save.
 */

type Result<T> = ServiceResult<T>;
type LiveActor = ReadActor & { accessToken: string };

/** The clients and clock a preset operation runs on; a test passes stubs. */
export interface PresetDeps {
	/** The owner's session client. */
	db: SupabaseClient;
	/** The service-role client the compiler writes through. */
	service?: SupabaseClient;
	now?: number;
}

// #region Schedules
/** A `scheduling.schedules` row as a preset operation reads it. */
export interface ScheduleRow {
	id: string;
	owner_type: string;
	owner_id: string;
	timezone: string;
	is_published: boolean;
}

const SCHEDULE_COLUMNS = "id, owner_type, owner_id, timezone, is_published";

/** The schedule the acting context owns: the person's own in a personal context, else the entity's. */
export function actorScheduleOwner(actor: ReadActor): { type: string; id: string } {
	return actor.contextType === "personal" || !actor.contextId
		? { type: "user", id: actor.userId }
		: { type: actor.contextType, id: actor.contextId };
}

/** An owner's schedule, or `null` when they have never saved one. Throws when the database fails. */
export async function scheduleOf(
	db: SupabaseClient,
	owner: { type: string; id: string },
): Promise<ScheduleRow | null> {
	const { data, error } = await db.schema("scheduling").from("schedules").select(SCHEDULE_COLUMNS)
		.eq("owner_type", owner.type).eq("owner_id", owner.id).maybeSingle();
	if (error) throw new Error(`schedules read failed: ${error.message}`);
	return (data as ScheduleRow | null) ?? null;
}
// #endregion

// #region Reads
/** A stored preset: the authored shape, and the row facts the shape does not carry. */
export interface StoredPreset {
	preset: AvailabilityPreset;
	row: PresetRow;
}

/**
 * The live presets of a schedule (or the ones named by `ids`), library first, then by name. Archived
 * presets are never returned.
 */
export async function readPresets(
	db: SupabaseClient,
	schedule: Pick<ScheduleRow, "id" | "timezone">,
	ids?: readonly string[],
): Promise<StoredPreset[]> {
	const scheduling = db.schema("scheduling");
	let query = scheduling.from("availability_presets").select(PRESET_COLUMNS)
		.eq("schedule_id", schedule.id).is("archived_at", null);
	if (ids) query = query.in("id", [...ids]);
	const presets = await query;
	if (presets.error) throw new Error(`availability_presets read failed: ${presets.error.message}`);
	const rows = (presets.data ?? []) as PresetRow[];
	if (rows.length === 0) return [];

	const rules = await scheduling.from("recurrence_rules").select(RULE_COLUMNS)
		.in("preset_id", rows.map((p) => p.id));
	if (rules.error) throw new Error(`recurrence_rules read failed: ${rules.error.message}`);
	const ruleRows = (rules.data ?? []) as RuleRow[];
	const bands = ruleRows.length
		? await scheduling.from("recurrence_rule_bands").select(BAND_COLUMNS)
			.in("rule_id", ruleRows.map((r) => r.id))
		: { data: [], error: null };
	if (bands.error) throw new Error(`recurrence_rule_bands read failed: ${bands.error.message}`);

	return rows
		.sort((a, b) =>
			(a.scope === b.scope ? 0 : a.scope === "library" ? -1 : 1) || a.name.localeCompare(b.name)
		)
		.map((row) => ({
			row,
			preset: presetFromRows(row, ruleRows, (bands.data ?? []) as RuleBandRow[], schedule.timezone),
		}));
}

const OWNER_USER: Record<string, PresetUser["kind"]> = {
	user: "profile",
	freelancer: "profile",
	team: "team",
	business: "business",
	enterprise: "business",
};

/**
 * Who follows each library preset: the timed services the schedule's owner sells (a service bound to
 * nothing follows the default), and the owner itself on the default, whose weekly hours mirror it.
 */
export async function presetUsage(
	db: SupabaseClient,
	schedule: ScheduleRow,
	presets: readonly StoredPreset[],
): Promise<Record<string, PresetUser[]>> {
	const library = presets.filter((p) => p.row.scope === "library");
	const usage: Record<string, PresetUser[]> = Object.fromEntries(
		library.map((p) => [p.row.id, []]),
	);
	const fallback = library.find((p) => p.row.is_default)?.row.id;
	const owner = OWNER_USER[schedule.owner_type] ?? "profile";
	if (fallback) usage[fallback].push({ kind: owner, name: "" });

	let query = db.schema("marketplace").from("service_blueprints")
		.select("title, availability_preset_id").in("delivery_model", ["session", "group_session"]);
	query = owner === "profile"
		? query.eq("freelancer_profile_id", schedule.owner_id).is("owner_team_id", null)
		: query.eq("owner_team_id", schedule.owner_id);
	const { data, error } = await query;
	if (error) throw new Error(`service_blueprints read failed: ${error.message}`);
	for (
		const bp of (data ?? []) as Array<{ title: string; availability_preset_id: string | null }>
	) {
		const id = bp.availability_preset_id ?? fallback;
		if (id && usage[id]) usage[id].push({ kind: "service", name: bp.title });
	}
	return usage;
}

/** The acting owner's live presets, and who follows each. A schedule never saved has none. */
export async function listPresets(
	actor: LiveActor,
	deps: PresetDeps,
): Promise<Result<PresetListResult>> {
	const schedule = await scheduleOf(deps.db, actorScheduleOwner(actor));
	if (!schedule) return ok({ presets: [], usage: {} });
	const stored = await readPresets(deps.db, schedule);
	return ok({
		presets: stored.map((p) => p.preset),
		usage: await presetUsage(deps.db, schedule, stored),
	});
}
// #endregion

// #region Mirror
/**
 * Write the default preset's weekly part into the schedule's `availability_rules`, keeping its zone
 * and published flag and leaving its call settings alone. Answers whether the bands say all the
 * preset says, or `null` when the write was refused (logged; the preset itself is saved).
 */
export async function mirrorDefault(
	db: SupabaseClient,
	schedule: ScheduleRow,
	preset: AvailabilityPreset,
	now: number,
): Promise<{ full: boolean } | null> {
	const projection = mirrorProjection(preset, dateInZone(now, schedule.timezone));
	const { error } = await db.schema("scheduling").rpc("save_owner_availability", {
		p_owner_type: schedule.owner_type,
		p_owner_id: schedule.owner_id,
		p_payload: availabilityPayload({
			timezone: schedule.timezone,
			published: schedule.is_published,
			bands: projection.bands,
			call: null,
		}),
	});
	if (error) {
		console.error("[scheduling:presets] default preset mirror refused", error.message);
		return null;
	}
	return { full: projection.full };
}
// #endregion

// #region Save
async function ensureSchedule(
	db: SupabaseClient,
	owner: { type: string; id: string },
	timezone: string,
): Promise<ScheduleRow | Result<never>> {
	const existing = await scheduleOf(db, owner);
	if (existing) {
		if (existing.timezone === timezone) return existing;
		const message = `Presets use your schedule's time zone (${existing.timezone}).`;
		return fail(422, { message, errors: { timezone: message } });
	}
	const { error } = await db.schema("scheduling").rpc("save_owner_availability", {
		p_owner_type: owner.type,
		p_owner_id: owner.id,
		p_payload: { timezone, published: false },
	});
	if (error) return presetRefusal(error);
	const created = await scheduleOf(db, owner);
	if (!created) throw new Error("the new schedule could not be read back");
	return created;
}

function isSchedule(value: ScheduleRow | Result<never>): value is ScheduleRow {
	return "id" in value;
}

/**
 * Save a preset (plan §5.6 step 1). Re-validated with the same schema and evaluator the editor ran:
 * a hard issue is a 422 naming the rule, a soft one rides along in `issues`. Then the door, then the
 * compile, then — for the default — the weekly mirror.
 */
export async function savePreset(
	input: SavePresetInput,
	actor: LiveActor,
	deps: PresetDeps,
): Promise<Result<SavePresetResult>> {
	const parsed = SavePresetInputSchema.safeParse(input);
	if (!parsed.success) {
		const errors: Record<string, string> = {};
		for (const issue of parsed.error.issues) {
			errors[issue.path.map(String).join(".") || "form"] ??= issue.message;
		}
		return fail(422, { message: "Check the highlighted rules.", errors });
	}
	const value = parsed.data;
	const now = deps.now ?? Date.now();

	const schedule = await ensureSchedule(deps.db, actorScheduleOwner(actor), value.timezone);
	if (!isSchedule(schedule)) return schedule;

	const today = dateInZone(now, schedule.timezone);
	const issues = validate({ timezone: schedule.timezone, rules: value.rules }, { today });
	const hard = hardIssues(issues);
	if (hard.length) {
		return fail(422, {
			message: hard[0].message,
			errors: issueErrors(hard, value.rules),
		});
	}

	const { data, error } = await deps.db.schema("scheduling").rpc("save_availability_preset", {
		p_schedule: schedule.id,
		p_preset: presetPayload(value),
	});
	if (error) return presetRefusal(error);
	const presetId = data as string;

	let compiled: { spans: number } | null = null;
	try {
		const outcome = await compilePreset(presetId, { now, db: deps.service });
		compiled = outcome ? { spans: outcome.spans } : null;
	} catch (err) {
		console.error(
			"[scheduling:presets] compile after save failed",
			err instanceof Error ? err.message : err,
		);
	}

	const [stored] = await readPresets(deps.db, schedule, [presetId]);
	if (!stored) throw new Error(`preset ${presetId} could not be read back`);
	const mirrored = stored.row.is_default
		? await mirrorDefault(deps.db, schedule, stored.preset, now)
		: null;

	const notes = [
		compiled ? null : "Bookings use your weekly hours until this preset finishes compiling.",
		stored.row.is_default && !mirrored ? "Your profile's weekly hours were not updated." : null,
	].filter(Boolean);
	return ok(
		{
			preset: stored.preset,
			issues: issues.filter((i) => i.severity !== "error"),
			compiled,
			mirrored,
		},
		{ message: notes.length ? `Saved. ${notes.join(" ")}` : "Saved." },
	);
}
// #endregion

// #region Archive
/**
 * Archive a preset — never delete it (plan §5.5). Every listing bound to it falls back to the
 * default, and comes back by slug. Archiving the default hands the default on, and the new default's
 * weekly part is mirrored.
 */
export async function archivePreset(
	id: string,
	actor: LiveActor,
	deps: PresetDeps,
): Promise<Result<ArchivePresetResult>> {
	const schedule = await scheduleOf(deps.db, actorScheduleOwner(actor));
	const [target] = schedule ? await readPresets(deps.db, schedule, [id]) : [];
	if (!schedule || !target) return fail(404, { message: "That preset no longer exists." });

	const { data, error } = await deps.db.schema("scheduling").rpc("archive_availability_preset", {
		p_preset: id,
	});
	if (error) return presetRefusal(error);
	const unbound = (data ?? []) as string[];

	let rebound: string[] = [];
	if (unbound.length) {
		const slugs = await deps.db.schema("marketplace").from("service_blueprints").select("id, slug")
			.in("id", unbound);
		if (slugs.error) throw new Error(`service_blueprints read failed: ${slugs.error.message}`);
		rebound = ((slugs.data ?? []) as Array<{ slug: string }>).map((b) => b.slug).sort();
	}

	if (target.row.is_default) {
		const next = (await readPresets(deps.db, schedule)).find((p) => p.row.is_default);
		if (next) await mirrorDefault(deps.db, schedule, next.preset, deps.now ?? Date.now());
	}
	return ok({ rebound }, { message: "Preset archived." });
}
// #endregion
