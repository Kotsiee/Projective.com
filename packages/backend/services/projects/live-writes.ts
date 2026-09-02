import {
	type ArchiveProject,
	type ChatMessage,
	type CommitTicket,
	type CreatedProject,
	createFormatToColumns,
	type CreateProject,
	type CreateSubmission,
	type MoveTicket,
	type ProjectFormat,
	type ProjectRoleSetup,
	type ProjectRules,
	type ProjectSetup,
	projectSlugFrom,
	type ProjectStructure,
	reconcileSetup,
	type SendProjectMessage,
	type StageSetup,
	type SubmissionUnit,
	type UpdateProject,
	workloadIntensity,
} from "@projective/types/projects";
import type { FieldErrors } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	orgDb,
	projectsDb,
	senderOf,
	toSubmissionStatus,
} from "./live-support.ts";

/**
 * live-writes — the RLS-scoped WRITE path for the projects domain.
 *
 * Every statement here runs under the caller's own JWT through {@link getUserClient}, so the policies
 * on `projects.*` and `comms.*` are what decide whether it lands. Nothing in this module authorises
 * anything: it maps a validated payload onto columns, states the traps at the site that can spring
 * them, and reports a refusal in the caller's own words.
 *
 * ## `projects.tickets` is governed by eleven triggers, and two of them move money
 *
 * A ticket is not an ordinary row. The four that shape every write here are stated again at each
 * write site, because the failure they cause is a raised exception in the middle of a save rather
 * than a validation message a form can render:
 *
 * - `fn_enforce_ticket_due_date` RAISES when `due_date IS NOT NULL` and the parent project's
 *   `allow_deadline_bonuses` is false. A due date is therefore REFUSED with a field error before the
 *   statement is built, never sent to a write that will abort.
 * - `fn_enforce_ticket_checkout_desc` RAISES on entering `claimed`/`in_progress` with an empty
 *   description — the purchasing gate, enforced in the database as well as in the composer.
 * - `fn_ticket_ordering_guard` RAISES when `sort_order` changes while `status <> 'backlog'`, so a
 *   manual position is only ever sent for the backlog lane.
 * - `trg_ticket_escrow_sync` **MOVES MONEY** on a status write: a plain
 *   `UPDATE ... SET status = 'completed'` releases escrow to the freelancer. Status is treated here
 *   as a money-moving column, so every transition goes through `projects.move_ticket`, which checks
 *   delivery authority and writes the audit row before the trigger fires.
 *
 * ## There is no transaction envelope
 *
 * PostgREST gives one statement per request, so a multi-part save — project columns, then stages,
 * then an order — is several independent commits. A later part failing therefore leaves the earlier
 * parts written. That is stated rather than hidden: each part reports its own refusal with a field
 * key, so the owner is told which half did not land instead of being shown a generic failure over a
 * half-saved form. A genuine all-or-nothing save needs one `SECURITY DEFINER` RPC that takes the
 * whole payload, which is a schema decision rather than something this layer may invent.
 */

// #region Constants
/** A project or channel id may arrive as a slug or a uuid; matching the wrong column raises `22P02`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The prefixes a client mints for a row that does not exist yet. */
const DRAFT_STAGE_PREFIX = "stage-draft-";
const DRAFT_ROLE_PREFIX = "role-draft-";

/** `projects.tickets.workload_intensity` is `numeric(4,2)`; a larger sum would abort the insert. */
const WORKLOAD_MAX = 99.99;

/** Zod bounds the projections clamp against. */
const TITLE_MAX = 160;
const NAME_MAX = 120;
const RICH_TEXT_MAX = 8000;
// #endregion

// #region Row shapes
/** The `projects.projects` columns the setup projection is built from. */
interface SetupProjectRow {
	id: string;
	slug: string;
	title: string;
	format: string;
	structure_variation: string;
	session_kind: string;
	status: string;
	description: unknown;
	description_text: string;
	currency: string | null;
	budget_type: string;
	budget_amount_cents: number | null;
	visibility: string;
	ip_ownership_mode: string;
	nda_required: boolean;
	portfolio_display_rights: string;
	timeline_preset: string;
	allow_deadline_bonuses: boolean;
	location_restriction: string[] | null;
	language_requirement: string[] | null;
	owner_user_id: string;
	archived_at: string | null;
}

/** The `projects.project_stages` columns the setup form edits. */
interface SetupStageRow {
	id: string;
	name: string;
	sort_order: number;
	description: unknown;
	description_text: string;
	unit_price_cents: number | null;
	milestone: string | null;
	skills: string[] | null;
}

/** The `projects.stage_staffing_roles` columns a Direct Deliverable's roles map onto. */
interface StaffingRoleRow {
	id: string;
	project_stage_id: string;
	role_title: string;
	/** Nullable: NULL is "not priced yet", which is a different fact from a seat offered for zero. */
	budget_amount_cents: number | null;
	skills: string[] | null;
}

/** The columns the setup read selects, named once so the row interface and the query cannot drift. */
const SETUP_PROJECT_COLUMNS = [
	"id",
	"slug",
	"title",
	"format",
	"structure_variation",
	"session_kind",
	"status",
	"description",
	"description_text",
	"currency",
	"budget_type",
	"budget_amount_cents",
	"visibility",
	"ip_ownership_mode",
	"nda_required",
	"portfolio_display_rights",
	"timeline_preset",
	"allow_deadline_bonuses",
	"location_restriction",
	"language_requirement",
	"owner_user_id",
	"archived_at",
].join(", ");

/** The stage columns the setup form reads and writes. */
const SETUP_STAGE_COLUMNS =
	"id, name, sort_order, description, description_text, unit_price_cents, milestone, skills";
// #endregion

// #region Rich text
/**
 * Read a rich body out of the pair of columns that store it.
 *
 * `description` is `jsonb` and `description_text` is its flattened twin for search. The editor emits
 * HTML, so the canonical body is `description.html`; `description_text` is the fallback for a row
 * written before an editor ever touched it, and for anything that stored plain prose. Reading the
 * flattened column FIRST would silently drop every heading and list the owner wrote.
 */
function richTextOf(json: unknown, text: string): string {
	if (json && typeof json === "object" && !Array.isArray(json)) {
		const html = (json as Record<string, unknown>).html;
		if (typeof html === "string" && html.length > 0) return clamp(html, RICH_TEXT_MAX);
	}
	return clamp(text, RICH_TEXT_MAX);
}

/**
 * The flattened twin of a rich body.
 *
 * Tags are stripped and entity whitespace normalised so the search column holds what a reader would
 * see. It is deliberately not a sanitiser — nothing here renders this string as markup.
 */
function flattenRichText(html: string): string {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;|&#160;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
// #endregion

// #region Setup projection
/**
 * Whether a client-supplied id names a row that already exists.
 *
 * A stage or role whose id is absent, carries a draft prefix, or is not a uuid is a CREATE. Treating
 * a non-uuid as a create rather than as an update is what stops a fabricated id from being sent to a
 * `.eq("id", …)` on a uuid column, which raises `22P02` instead of matching nothing.
 */
function isExistingId(id: string | undefined, draftPrefix: string): id is string {
	if (!id || id.startsWith(draftPrefix)) return false;
	return UUID_RE.test(id);
}

/** Project a stage row onto the setup form's stage shape. */
function toStageSetup(row: SetupStageRow): StageSetup {
	return {
		id: row.id,
		name: clampOr(row.name, NAME_MAX, "Stage"),
		order: row.sort_order,
		description: richTextOf(row.description, row.description_text),
		unitPriceCents: row.unit_price_cents,
		milestone: clamp(row.milestone ?? "", 240),
		skills: (row.skills ?? []).map((skill) => clamp(skill, 60)).filter((s) => s.length > 0),
	};
}

/** Project a staffing-role row onto the setup form's role shape. */
function toRoleSetup(row: StaffingRoleRow): ProjectRoleSetup {
	return {
		id: row.id,
		name: clampOr(row.role_title, NAME_MAX, "Role"),
		skills: (row.skills ?? []).map((skill) => clamp(skill, 60)).filter((s) => s.length > 0),
		budgetCents: row.budget_amount_cents,
	};
}

/** The engagement rules, read straight off the columns they map 1:1 onto. */
function toRules(row: SetupProjectRow): ProjectRules {
	return {
		visibility: row.visibility as ProjectRules["visibility"],
		ipOwnershipMode: row.ip_ownership_mode as ProjectRules["ipOwnershipMode"],
		ndaRequired: row.nda_required,
		portfolioDisplayRights: row.portfolio_display_rights as ProjectRules["portfolioDisplayRights"],
		timelinePreset: row.timeline_preset as ProjectRules["timelinePreset"],
		allowDeadlineBonuses: row.allow_deadline_bonuses,
		locationRestriction: (row.location_restriction ?? []).map((v) => clamp(v, 60)),
		languageRequirement: (row.language_requirement ?? []).map((v) => clamp(v, 60)),
	};
}

/**
 * Compose the whole setup projection.
 *
 * `reconcileSetup` derives the ladder, the percentage and the gate, so the bar an owner reads is
 * computed by the same function on the live path and the stub path. Nothing here computes a
 * percentage of its own.
 */
function toSetup(
	row: SetupProjectRow,
	stages: readonly SetupStageRow[],
	roles: readonly StaffingRoleRow[],
	viewerId: string,
): ProjectSetup {
	return reconcileSetup({
		slug: row.slug,
		title: clamp(row.title, TITLE_MAX),
		format: row.format as ProjectFormat,
		structure: row.structure_variation as ProjectStructure,
		// A stored axis, not a guess: `projects.session_kind` records 1-1 versus cohort, and only a
		// `session` engagement can be either. Anything else reads `none` regardless of what is stored,
		// so a format change that leaves a stale value behind cannot render a cohort form over a
		// pipeline.
		sessionKind: row.format === "session"
			? (row.session_kind === "group" ? "group" : "normal")
			: "none",
		// `project_status` carries an `archived` member the Zod enum does not. An archived project
		// keeps its last real status here and the archive is reported through `archived_at`, so the
		// projection cannot fail its own schema on a row the database considers perfectly valid.
		status: row.status === "archived" ? "on_hold" : row.status as ProjectSetup["status"],
		archivedAt: row.archived_at,
		description: richTextOf(row.description, row.description_text),
		budget: {
			budgetType: row.budget_type as ProjectSetup["budget"]["budgetType"],
			amountCents: row.budget_amount_cents,
			currency: clampOr(row.currency, 8, "USD"),
		},
		rules: toRules(row),
		stages: [...stages].sort((a, b) => a.sort_order - b.sort_order).map(toStageSetup),
		roles: roles.map(toRoleSetup),
		// The setup surface is the OWNER's. `create_stage` and `reorder_stages` both authorise on
		// ownership, so anything wider here would draw controls the database will refuse.
		viewerIsClient: row.owner_user_id === viewerId,
	});
}
// #endregion

// #region Setup read
/** The project row the setup surface edits, by slug or uuid. */
async function fetchSetupProject(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<SetupProjectRow | null> {
	const base = projectsDb(actor).from("projects").select(SETUP_PROJECT_COLUMNS);
	const filtered = UUID_RE.test(projectId) ? base.eq("id", projectId) : base.eq("slug", projectId);
	const { data, error } = await filtered.maybeSingle();
	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	if (!data) return null;
	return data as unknown as SetupProjectRow;
}

/** The project's stages, in their configured order. */
async function fetchSetupStages(
	actor: ReadActor & { accessToken: string },
	projectRowId: string,
): Promise<SetupStageRow[]> {
	const { data, error } = await projectsDb(actor)
		.from("project_stages")
		.select(SETUP_STAGE_COLUMNS)
		.eq("project_id", projectRowId)
		.order("sort_order", { ascending: true });
	if (error) return [];
	return (data ?? []) as unknown as SetupStageRow[];
}

/**
 * The staffing roles hanging off the project's stages.
 *
 * `stage_staffing_roles` is keyed to a STAGE, not a project, so the roles are gathered across the
 * project's stages. On a Direct Deliverable there is exactly one stage
 * (`fn_enforce_structure_variation` refuses a second), so the list is unambiguous there — which is
 * the only structure whose form renders roles at all.
 */
async function fetchStaffingRoles(
	actor: ReadActor & { accessToken: string },
	stageIds: readonly string[],
): Promise<StaffingRoleRow[]> {
	if (stageIds.length === 0) return [];
	const { data, error } = await projectsDb(actor)
		.from("stage_staffing_roles")
		.select("id, project_stage_id, role_title, budget_amount_cents, skills")
		.in("project_stage_id", stageIds);
	if (error) return [];
	return (data ?? []) as unknown as StaffingRoleRow[];
}

/**
 * The owner's configuration projection for one engagement, or `null` when it does not exist or is
 * not visible.
 *
 * THROWS only when the PRIMARY project read fails, with the table named, so the calling service can
 * log it and fall back to fixtures. Stages and roles degrade to empty lists instead: a withheld join
 * should cost a section, not the page.
 */
export async function fetchProjectSetup(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<ProjectSetup | null> {
	const row = await fetchSetupProject(actor, projectId);
	if (!row) return null;
	const stages = await fetchSetupStages(actor, row.id);
	const roles = await fetchStaffingRoles(actor, stages.map((s) => s.id));
	return toSetup(row, stages, roles, actor.userId);
}
// #endregion

// #region Project update
/** What a write reports back: the refusal, or nothing when it landed. */
export interface WriteRefusal {
	status: number;
	message: string;
	errors?: FieldErrors;
}

/**
 * Map a PostgREST/plpgsql failure onto a refusal.
 *
 * A raised `insufficient_privilege` is the database saying no to THIS caller, which is a `403` and
 * is worth passing through in the database's own words — those messages are written for a reader
 * ("Only the project owner may reorder its stages."). Anything else becomes a `502` with a generic
 * sentence, because an unexpected SQL error is not something to show a user and may describe
 * internals.
 */
function refusalFrom(message: string, field?: string): WriteRefusal {
	// `permission denied` is deliberately NOT in this list. It is Postgres's GRANT-level wording and
	// it names the table it failed on — `permission denied for table projects_index` is a real,
	// reachable example — so passing it through would hand the caller an internal table name. A
	// missing grant is also our configuration error rather than this caller's, which is what a 502
	// says and a 403 does not.
	const denied = message.includes("insufficient_privilege") ||
		message.includes("Only the project owner");
	if (denied) {
		return {
			status: 403,
			message: clampOr(message, 200, "You cannot make that change."),
			errors: field ? { [field]: "not_permitted" } : undefined,
		};
	}

	// A RULE the database enforces is a refusal the caller can act on, not a fault to retry. These
	// are raised with `check_violation` and carry a sentence written for a reader; reporting them as
	// "please try again" tells someone to repeat something that can never succeed.
	const rule = message.includes("cannot be reordered") ||
		message.includes("can no longer change state") ||
		message.includes("does not belong to project") ||
		message.includes("are limited to") ||
		message.includes("still open") ||
		message.includes("unsettled");
	if (rule) {
		return {
			status: 422,
			message: clampOr(message, 200, "That change is not allowed on this project."),
			errors: field ? { [field]: "not_allowed" } : undefined,
		};
	}

	return {
		status: 502,
		message: "That change could not be saved — please try again.",
		errors: field ? { [field]: "write_failed" } : undefined,
	};
}

/**
 * The refusal an RLS-filtered write deserves.
 *
 * Under RLS an `UPDATE` whose `USING` arm matches nothing affects ZERO rows and raises NOTHING —
 * PostgREST reports success. So a stranger's write is indistinguishable from an owner's unless the
 * affected count is read back, and the caller is told "Saved" over a row that never changed. Every
 * table write below therefore selects its ids back and checks that something actually moved.
 */
function notWritten(field?: string): WriteRefusal {
	return {
		status: 403,
		message: "You cannot make that change.",
		errors: field ? { [field]: "not_permitted" } : undefined,
	};
}

/** Build the `projects.projects` column patch from the validated payload. */
function projectColumnPatch(input: UpdateProject): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	if (input.title !== undefined) patch.title = clamp(input.title, TITLE_MAX);
	if (input.format !== undefined) patch.format = input.format;
	if (input.structure !== undefined) patch.structure_variation = input.structure;
	// Only a session has a kind. Writing `none` alongside any other format keeps the column and the
	// format from disagreeing, rather than leaving a value behind that the read then has to ignore.
	if (input.sessionKind !== undefined || input.format !== undefined) {
		const format = input.format ?? null;
		const kind = input.sessionKind ?? "normal";
		patch.session_kind = format !== null && format !== "session" ? "none" : kind;
	}
	if (input.description !== undefined) {
		const html = clamp(input.description, RICH_TEXT_MAX);
		patch.description = { html };
		patch.description_text = flattenRichText(html);
	}
	if (input.budget?.budgetType !== undefined) patch.budget_type = input.budget.budgetType;
	if (input.budget?.amountCents !== undefined) {
		patch.budget_amount_cents = input.budget.amountCents;
	}
	if (input.budget?.currency !== undefined) patch.currency = clamp(input.budget.currency, 8);
	const rules = input.rules;
	if (rules?.visibility !== undefined) patch.visibility = rules.visibility;
	if (rules?.ipOwnershipMode !== undefined) patch.ip_ownership_mode = rules.ipOwnershipMode;
	if (rules?.ndaRequired !== undefined) patch.nda_required = rules.ndaRequired;
	if (rules?.portfolioDisplayRights !== undefined) {
		patch.portfolio_display_rights = rules.portfolioDisplayRights;
	}
	if (rules?.timelinePreset !== undefined) patch.timeline_preset = rules.timelinePreset;
	if (rules?.allowDeadlineBonuses !== undefined) {
		patch.allow_deadline_bonuses = rules.allowDeadlineBonuses;
	}
	if (rules?.locationRestriction !== undefined) {
		patch.location_restriction = rules.locationRestriction;
	}
	if (rules?.languageRequirement !== undefined) {
		patch.language_requirement = rules.languageRequirement;
	}
	// `last_activity_at` is not `updated_at`: any write touches the latter, so idleness has to mean
	// "nothing has HAPPENED here" or the stale-draft sweep spares a project that was merely renamed.
	if (Object.keys(patch).length > 0) patch.last_activity_at = new Date().toISOString();
	return patch;
}

/**
 * Reconcile the form's stage list against the stored one.
 *
 * Create, update, remove and reorder, in that order, and the order matters: a stage created in this
 * pass has to exist before it can be named in the reorder, and a stage removed before the reorder
 * must not be named in it at all. Removal goes through `projects.delete_stage` rather than a raw
 * DELETE because that function releases escrow on any claimed ticket sitting in the stage first —
 * a raw delete would strand the money.
 */
async function reconcileStages(
	actor: ReadActor & { accessToken: string },
	projectRowId: string,
	stages: NonNullable<UpdateProject["stages"]>,
	/**
	 * Whether stages omitted from the payload should be DELETED.
	 *
	 * False for a `PATCH`, and that is the whole point: a PATCH sends the section that changed, so
	 * treating an absent stage as "remove it" turns a title-only save into a pipeline wipe — and
	 * `delete_stage` releases escrow before it deletes. Only `PUT`, which means "here is the whole
	 * resource", may remove anything.
	 */
	replace: boolean,
): Promise<WriteRefusal | null> {
	const db = projectsDb(actor);
	const existing = await fetchSetupStages(actor, projectRowId);
	const keep = new Set<string>();
	const ordered: string[] = [];

	for (const [index, stage] of stages.entries()) {
		const html = clamp(stage.description ?? "", RICH_TEXT_MAX);
		const name = clampOr(stage.name, NAME_MAX, `Stage ${index + 1}`);
		if (isExistingId(stage.id, DRAFT_STAGE_PREFIX)) {
			const patch: Record<string, unknown> = { name };
			if (stage.description !== undefined) {
				patch.description = { html };
				patch.description_text = flattenRichText(html);
			}
			if (stage.unitPriceCents !== undefined) patch.unit_price_cents = stage.unitPriceCents;
			if (stage.milestone !== undefined) patch.milestone = clamp(stage.milestone, 240);
			if (stage.skills !== undefined) patch.skills = stage.skills;
			const { data: touched, error } = await db
				.from("project_stages")
				.update(patch)
				.eq("id", stage.id)
				.select("id");
			if (error) return refusalFrom(error.message, "stages");
			if (!touched || touched.length === 0) return notWritten("stages");
			keep.add(stage.id);
			ordered.push(stage.id);
			continue;
		}

		// `create_stage` provisions the stage's room in the same transaction. That is not a
		// convenience: a stage with no channel is omitted from the channel tree, so a stage inserted
		// directly would be invisible in the sidebar that is supposed to show it.
		const { data, error } = await db.rpc("create_stage", {
			p_project_id: projectRowId,
			p_name: name,
			p_description: { html },
			p_description_text: flattenRichText(html),
			p_unit_price_cents: stage.unitPriceCents ?? null,
		});
		if (error) return refusalFrom(error.message, "stages");
		const newId = typeof data === "string" ? data : null;
		if (!newId) return refusalFrom("create_stage returned no id", "stages");
		// `create_stage` takes neither skills nor a milestone, so both are a follow-up write rather than
		// a widened RPC signature — the function is `SECURITY DEFINER` and its argument list is a schema
		// decision. One statement for the pair, because two would be two chances to half-write a stage.
		const extras: Record<string, unknown> = {};
		if (stage.skills?.length) extras.skills = stage.skills;
		if (stage.milestone) extras.milestone = clamp(stage.milestone, 240);
		if (Object.keys(extras).length > 0) {
			const { error: extraError } = await db
				.from("project_stages")
				.update(extras)
				.eq("id", newId);
			if (extraError) return refusalFrom(extraError.message, "stages");
		}
		keep.add(newId);
		ordered.push(newId);
	}

	if (replace) {
		for (const row of existing) {
			if (keep.has(row.id)) continue;
			const { error } = await db.rpc("delete_stage", {
				p_project_id: projectRowId,
				p_stage_id: row.id,
			});
			if (error) return refusalFrom(error.message, "stages");
		}
	}

	// Only when the ORDER actually moved.
	//
	// `fn_stage_reorder_lock` raises on any project with a started or claimed stage, so calling this
	// unconditionally makes every save on a live project fail — including a save that never touched
	// the stage list. Comparing first means the lock is only ever met by a caller who really is
	// trying to reorder, which is the case it exists to refuse.
	const currentOrder = existing.map((row) => row.id);
	// Compared as joined lists. The separator only has to be a character a uuid cannot contain, so
	// two different orders can never render as one string; a comma is enough and, unlike a NUL, it
	// leaves the file readable to grep and to a diff.
	const asKey = (ids: readonly string[]) => ids.join(",");
	const reordered = replace
		? asKey(ordered) !== asKey(currentOrder)
		: asKey(ordered) !== asKey(currentOrder.filter((id) => keep.has(id)));
	if (ordered.length > 0 && reordered) {
		const { error } = await db.rpc("reorder_stages", {
			p_project_id: projectRowId,
			p_ordered_ids: ordered,
		});
		// A refusal here is the started-stage lock, which is a rule the owner can act on rather than a
		// fault. It is reported against `stages` so the form can say which section did not land.
		if (error) return refusalFrom(error.message, "stages");
	}
	return null;
}

/**
 * Reconcile the Direct Deliverable's staffing roles.
 *
 * `stage_staffing_roles.budget_amount_cents` is `NOT NULL`, so an UNPRICED role is not representable
 * — and mapping `null` to zero would satisfy the pricing ladder with a number nobody typed, which is
 * exactly the distinction {@link ProjectRoleSetupSchema} exists to keep. An unpriced role is
 * therefore refused with a field error rather than silently stored as free.
 */
async function reconcileRoles(
	actor: ReadActor & { accessToken: string },
	projectRowId: string,
	roles: NonNullable<UpdateProject["roles"]>,
	/** Whether roles omitted from the payload are DELETED — a full replace only. See `reconcileStages`. */
	replace: boolean,
): Promise<WriteRefusal | null> {
	const db = projectsDb(actor);
	let stages = await fetchSetupStages(actor, projectRowId);
	if (stages.length === 0) {
		// A Direct Deliverable is one stage and one ticket (`fn_enforce_structure_variation`), and its
		// roles have nowhere to hang until that stage exists. Creating it here rather than refusing
		// keeps the form's first save from failing on a row the form never asked the owner about.
		const { data, error } = await db.rpc("create_stage", {
			p_project_id: projectRowId,
			p_name: "Delivery",
			p_description: { html: "" },
			p_description_text: "",
			p_unit_price_cents: null,
		});
		if (error) return refusalFrom(error.message, "roles");
		stages = await fetchSetupStages(actor, projectRowId);
		if (typeof data !== "string" || stages.length === 0) {
			return refusalFrom("create_stage returned no id", "roles");
		}
	}

	const stageId = stages[0].id;
	const existing = await fetchStaffingRoles(actor, [stageId]);
	const keep = new Set<string>();

	for (const role of roles) {
		const patch = {
			role_title: clampOr(role.name, NAME_MAX, "Role"),
			skills: role.skills?.map((skill) => clamp(skill, 60)).filter((s) => s.length > 0) ?? [],
			// `null`, not `0`. The column is nullable and NULL means "not priced yet", where zero is a
			// decision somebody took — a seat offered for free. `validateUpdate` refuses a budget-less
			// role on THIS path before any write happens, so the fallback is unreachable here; it is
			// written honestly anyway, because the create path stores NULL and the two must agree about
			// what an unpriced seat looks like in the column.
			budget_amount_cents: role.budgetCents ?? null,
		};
		if (isExistingId(role.id, DRAFT_ROLE_PREFIX)) {
			const { data: touched, error } = await db
				.from("stage_staffing_roles")
				.update(patch)
				.eq("id", role.id)
				.select("id");
			if (error) return refusalFrom(error.message, "roles");
			if (!touched || touched.length === 0) return notWritten("roles");
			keep.add(role.id);
			continue;
		}
		const { data, error } = await db
			.from("stage_staffing_roles")
			.insert({ ...patch, project_stage_id: stageId })
			.select("id")
			.maybeSingle();
		if (error) return refusalFrom(error.message, "roles");
		const created = (data as { id?: string } | null)?.id;
		if (created) keep.add(created);
	}

	if (replace) {
		for (const row of existing) {
			if (keep.has(row.id)) continue;
			const { error } = await db.from("stage_staffing_roles").delete().eq("id", row.id);
			if (error) return refusalFrom(error.message, "roles");
		}
	}
	return null;
}

/**
 * Everything about a patch that can be refused WITHOUT asking the database.
 *
 * Hoisted out of the reconcilers because the update is not one transaction: the column patch commits,
 * and only then does a later section refuse. The form is told nothing was saved — `commit()` adopts a
 * new baseline only on success — so the owner keeps editing a draft the database has already moved
 * past. Reachable from the shipped surface: "Add role" creates a role with no budget, and the setup
 * form always sends the whole `roles` section, so a title edit made in the same sitting committed
 * under a 422.
 *
 * A pre-check cannot cover every refusal — RLS, the immutability guards and the stage-reorder lock
 * all live in the database and are only knowable by asking. It covers the ones that ARE knowable
 * first, which is what stops the most common half-commit rather than pretending to prevent all of
 * them. The complete answer is one RPC doing the whole reconciliation in a single transaction.
 */
function validateUpdate(input: UpdateProject): WriteRefusal | null {
	if (input.roles?.some((role) => role.budgetCents === null || role.budgetCents === undefined)) {
		return {
			status: 422,
			message: "Give every team role a budget.",
			errors: { roles: "budget_required" },
		};
	}
	return null;
}

/** The outcome of a write: the new projection, a refusal, or `null` for "no such project". */
export type WriteOutcome<T> = { data: T } | { refusal: WriteRefusal } | null;

/**
 * Apply the setup form's patch and return the RE-DERIVED projection.
 *
 * Re-derived rather than echoed: the ladder, the percentage and the gate are functions of what is
 * now stored, and returning the caller's own payload folded over the old projection would report a
 * completeness the database does not agree with.
 *
 * Status goes through `projects.set_project_status` rather than a column write, because that
 * function owns the legality of a transition and the audit row that records it.
 */
export async function applyProjectUpdate(
	actor: ReadActor & { accessToken: string },
	projectId: string,
	input: UpdateProject,
	replace = false,
): Promise<WriteOutcome<ProjectSetup>> {
	// Before anything is written, so a section that was always going to be refused cannot leave the
	// earlier sections committed behind it.
	const invalid = validateUpdate(input);
	if (invalid) return { refusal: invalid };

	const row = await fetchSetupProject(actor, projectId);
	if (!row) return null;
	const db = projectsDb(actor);

	// An archived project is a soft-deleted one. Editing it would let content change underneath a
	// decision that has already been recorded — and the setup projection has nowhere to SAY it is
	// archived, so the surface could not even warn the owner it was happening.
	if (row.archived_at) {
		return {
			refusal: {
				status: 409,
				message: "This project is archived. Restore it before making changes.",
				errors: { form: "archived" },
			},
		};
	}

	const patch = projectColumnPatch(input);
	if (Object.keys(patch).length > 0) {
		// `.select()` is what turns an RLS refusal into a refusal. Without it an UPDATE whose `USING`
		// arm matches nothing affects zero rows and raises nothing, so a caller who may READ the row
		// but not write it is told "Saved" over a row that never changed.
		const { data: touched, error } = await db
			.from("projects")
			.update(patch)
			.eq("id", row.id)
			.select("id");
		if (error) return { refusal: refusalFrom(error.message) };
		if (!touched || touched.length === 0) return { refusal: notWritten() };
	}

	if (input.status !== undefined && input.status !== row.status) {
		const { error } = await db.rpc("set_project_status", {
			p_project_id: row.id,
			p_to_status: input.status,
			p_reason: null,
		});
		if (error) return { refusal: refusalFrom(error.message, "status") };
	}

	if (input.stages) {
		const refusal = await reconcileStages(actor, row.id, input.stages, replace);
		if (refusal) return { refusal };
	}
	if (input.roles) {
		const refusal = await reconcileRoles(actor, row.id, input.roles, replace);
		if (refusal) return { refusal };
	}

	const setup = await fetchProjectSetup(actor, row.id);
	if (!setup) return null;
	return { data: setup };
}

/**
 * Soft-archive a project. Nothing is hard-deleted (root CLAUDE.md §5).
 *
 * `set_project_status` writes the status; `archived_at` is stamped alongside it because
 * `ck_projects_archived_at` requires the two to agree — a status without its timestamp is a row the
 * CHECK refuses, and a reader that consulted only one column would answer "is this archived?"
 * differently depending on which one it looked at.
 */
export async function archiveProjectRow(
	actor: ReadActor & { accessToken: string },
	projectId: string,
	input: ArchiveProject,
): Promise<WriteOutcome<{ slug: string; archivedAt: string }>> {
	const row = await fetchSetupProject(actor, projectId);
	if (!row) return null;
	if (row.archived_at) {
		// Idempotent: archiving twice returns the ORIGINAL instant rather than restamping it, so a
		// double-press cannot rewrite when the decision was taken.
		return { data: { slug: row.slug, archivedAt: row.archived_at } };
	}

	const db = projectsDb(actor);
	// ONE call, not a status write followed by a timestamp write. `ck_projects_archived_at` is
	// bidirectional — `(status = 'archived') = (archived_at IS NOT NULL)` — so the two halves have to
	// land in the same statement or the first one is refused before the second can run. The RPC does
	// that, and writes the status-history and activity rows every other transition writes, so an
	// archive is as explicable afterwards as a completion is.
	const { error } = await db.rpc("set_project_status", {
		p_project_id: row.id,
		p_to_status: "archived",
		p_reason: input.reason ? clamp(input.reason, 400) : null,
	});
	if (error) return { refusal: refusalFrom(error.message, "status") };

	// Read the stamp BACK rather than minting one here: the database wrote it, and a second clock
	// would report an instant a millisecond away from the one the row actually carries.
	const stamped = await fetchSetupProject(actor, row.id);
	return {
		data: { slug: row.slug, archivedAt: stamped?.archived_at ?? new Date().toISOString() },
	};
}
// #endregion

// #region Tickets
/** Resolve a project id that may be a slug, together with the facts a ticket write must check. */
async function fetchTicketProject(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<{ id: string; allowDeadlines: boolean } | null> {
	const base = projectsDb(actor).from("projects").select("id, allow_deadline_bonuses");
	const filtered = UUID_RE.test(projectId) ? base.eq("id", projectId) : base.eq("slug", projectId);
	const { data, error } = await filtered.maybeSingle();
	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	if (!data) return null;
	const row = data as unknown as { id: string; allow_deadline_bonuses: boolean };
	return { id: row.id, allowDeadlines: row.allow_deadline_bonuses };
}

/**
 * The ticket's summed capacity draw.
 *
 * `categoryWeight` has no column anywhere, so every stage contributes a weight of `1` — the same
 * neutral the live board reads it at. Inventing a weight would make $W_i$ plausible and wrong (root
 * CLAUDE.md §8 Decision #64(b)). Clamped to the column's `numeric(4,2)` range, because a sum past it
 * aborts the statement rather than rounding.
 */
function ticketWorkload(stages: CommitTicket["stages"]): number {
	const total = stages.reduce((sum, s) => sum + workloadIntensity(1, s.intensity), 0);
	return Math.min(WORKLOAD_MAX, Math.round(total * 100) / 100);
}

/** The `required_stages` jsonb shape the column documents. */
function requiredStages(
	stages: CommitTicket["stages"],
): Array<{ stage_id: string; order: number }> {
	return stages.map((s) => ({ stage_id: s.stageId, order: s.order }));
}

/** The `tasks` jsonb shape the column documents. */
function ticketTasks(tasks: CommitTicket["tasks"]): Array<Record<string, unknown>> {
	return tasks.map((task) => ({
		id: task.id,
		text: task.text,
		done: task.done,
		completed_by: task.completedBy.map((party) => party.handle ?? party.name),
	}));
}

/**
 * Resolve the ticket's client-side accountable seat to a real user id.
 *
 * The client can only ever send a HANDLE: the board projects every party through
 * `ProjectPartySchema`, which is `{name, avatar, handle}` and carries no id at all. So the field is a
 * REFERENCE, and it has to be resolved here — writing it through verbatim put a handle into a `uuid`
 * column and made every save of a ticket that has an owner abort with `22P02`.
 *
 * Resolution is also the authorisation. The reference is matched only against people who actually
 * participate in THIS project, so a caller who may write here cannot name an arbitrary third party as
 * accountable for the work — `owner_user_id` is the seat the ticket modal renders and `board-access`
 * gates editing on, and nothing else validates it.
 */
async function resolveTicketOwner(
	actor: ReadActor & { accessToken: string },
	projectRowId: string,
	reference: string | null,
): Promise<{ id: string | null } | WriteRefusal> {
	if (!reference) return { id: null };

	const org = orgDb(actor);
	const base = org.from("users_public").select("user_id, username");
	const { data, error } = UUID_RE.test(reference)
		? await base.eq("user_id", reference).maybeSingle()
		: await base.eq("username", reference).maybeSingle();
	if (error) return refusalFrom(error.message, "ownerId");

	const found = data as { user_id?: string } | null;
	if (!found?.user_id) {
		return {
			status: 422,
			message: "That person is not on this project.",
			errors: { ownerId: "unknown_owner" },
		};
	}

	// Membership, checked against the project rather than assumed from the reference resolving.
	const { data: participant } = await projectsDb(actor)
		.from("project_participants")
		.select("id")
		.eq("project_id", projectRowId)
		.eq("profile_id", found.user_id)
		.maybeSingle();
	const { data: owned } = await projectsDb(actor)
		.from("projects")
		.select("id")
		.eq("id", projectRowId)
		.eq("owner_user_id", found.user_id)
		.maybeSingle();
	if (!participant && !owned) {
		return {
			status: 422,
			message: "That person is not on this project.",
			errors: { ownerId: "not_a_member" },
		};
	}
	return { id: found.user_id };
}

/**
 * Resolve the ticket's stage set against the project, and derive the rate the ticket is priced at.
 *
 * Two jobs in one read because they need the same rows and must not disagree.
 *
 * **The stage set is VALIDATED, not trusted.** `current_stage_id` and `required_stages` were written
 * from the payload verbatim, so a ticket could be pointed at a stage belonging to somebody else's
 * project: the board read then drops the unresolvable stage and shows a card with no stage, while
 * `fn_hold_ticket_escrow` reads `current_stage_id` directly and would price the escrow against the
 * foreign stage. `move_ticket` has exactly this check and is skipped for a backlog create.
 *
 * **The rate is RESOLVED, not accepted.** `costCents` is a client field, and the column it fed —
 * `tickets.unit_price_cents` — is the first term of `COALESCE(t.unit_price_cents, ps.unit_price_cents)`
 * in `finance.fn_hold_ticket_escrow`, so the buyer was choosing their own escrow amount. Worse, the
 * value written was the ticket TOTAL while both the board read and `get_ticket_finance` treat the
 * column as a PER-STAGE rate, so a three-stage ticket priced itself at three times its own total.
 *
 * So the rate comes from `project_stages`, and only when every stage of the ticket carries the SAME
 * one — which is the only thing a single column can honestly say about a multi-stage ticket. Anything
 * else resolves to `null`, and each stage is then priced at its own rate on the read.
 *
 * **What that costs, stated:** the rate is no longer CAPTURED at agreement, so re-pricing a stage
 * restates every existing ticket that runs through it (root CLAUDE.md §8 Decision #65 wanted the
 * opposite). A column per ticket cannot hold a rate per stage, and letting the client supply the
 * number is not a way to buy that back — it is the money hole this replaces.
 */
async function resolveTicketStages(
	actor: ReadActor & { accessToken: string },
	projectRowId: string,
	stages: CommitTicket["stages"],
	currentStageId: string | null,
): Promise<{ rate: number | null } | WriteRefusal> {
	if (stages.length === 0 && currentStageId === null) return { rate: null };

	const { data, error } = await projectsDb(actor)
		.from("project_stages")
		.select("id, unit_price_cents")
		.eq("project_id", projectRowId);
	if (error) return refusalFrom(error.message, "stages");

	const rates = new Map<string, number | null>();
	for (const row of (data ?? []) as Array<{ id: string; unit_price_cents: number | null }>) {
		rates.set(row.id, row.unit_price_cents);
	}

	// The lane the card lands in is checked alongside the run it declares. It is a separate field, it
	// is what `fn_hold_ticket_escrow` actually prices against, and a ticket can carry one without the
	// other — so validating only `stages` would leave the escrow-bearing column unchecked.
	const referenced = [...stages.map((s) => s.stageId), ...(currentStageId ? [currentStageId] : [])];
	if (referenced.some((id) => !rates.has(id))) {
		return {
			status: 422,
			message: "That stage is not part of this project.",
			errors: { stages: "stage_not_in_project" },
		};
	}

	if (stages.length === 0) return { rate: null };
	const distinct = new Set(stages.map((s) => rates.get(s.stageId) ?? null));
	return { rate: distinct.size === 1 ? [...distinct][0] : null };
}

/**
 * Create or update one ticket, and return its id.
 *
 * The id rather than a card: composing a {@link BoardCard} needs the ticket's history, submissions,
 * attachments and money trail, all of which the board read already assembles. Re-reading the board
 * after the write is therefore both simpler and safer than a second assembler that could disagree
 * with the first.
 *
 * Status is NEVER written as a column here. A ticket is INSERTed in `backlog` and then moved with
 * `projects.move_ticket`, and an existing ticket's status change is the same call — because
 * `trg_ticket_escrow_sync` fires on a status write and releases escrow, and `move_ticket` is where
 * the delivery-authority check and the audit row live.
 */
export async function commitTicketRow(
	actor: ReadActor & { accessToken: string },
	input: CommitTicket,
): Promise<WriteOutcome<string>> {
	const project = await fetchTicketProject(actor, input.projectId);
	if (!project) return null;

	// `fn_enforce_ticket_due_date` RAISES when a due date is set on a project that has not agreed to
	// deadline bonus terms. Refusing here, with the reason, is the difference between a form the owner
	// can correct and an aborted save they cannot explain.
	if (input.dueDate && !project.allowDeadlines) {
		return {
			refusal: {
				status: 422,
				message: "Turn on deadline bonuses for this project before setting a ticket due date.",
				errors: { dueDate: "deadline_bonuses_disabled" },
			},
		};
	}

	// The purchasing gate (PRODUCT_SPEC §Creation & Purchasing Gate). `fn_enforce_ticket_checkout_desc`
	// enforces it, but only fires when `description IS NULL OR = '{}'` — and writing `{"html": ""}`, as
	// this did, satisfies neither, so the trigger never saw an empty description and a ticket could be
	// bought with none. Refused here with the reason, and the empty case is written as a real NULL
	// below so the database's own guard is armed rather than bypassed.
	const html = clamp(input.description, RICH_TEXT_MAX);
	const descriptionText = flattenRichText(html);
	if (input.status !== "backlog" && descriptionText.trim().length === 0) {
		return {
			refusal: {
				status: 422,
				message: "A ticket needs a description before it can be purchased or claimed.",
				errors: { description: "description_required" },
			},
		};
	}

	const owner = await resolveTicketOwner(actor, project.id, input.ownerId);
	if ("status" in owner) return { refusal: owner };

	const stageSet = await resolveTicketStages(actor, project.id, input.stages, input.stageId);
	if ("status" in stageSet) return { refusal: stageSet };

	const db = projectsDb(actor);
	const columns: Record<string, unknown> = {
		title: clamp(input.title, 200),
		// NULL rather than `{"html": ""}` when there is nothing in it — see the gate above.
		description: descriptionText.trim().length === 0 ? null : { html },
		text_description: descriptionText,
		current_stage_id: input.stageId,
		owner_user_id: owner.id,
		priority: input.priority,
		workload_intensity: ticketWorkload(input.stages),
		required_stages: requiredStages(input.stages),
		tasks: ticketTasks(input.tasks),
		due_date: input.dueDate,
		unit_price_cents: stageSet.rate,
	};

	const editing = UUID_RE.test(input.clientId);
	let ticketId = input.clientId;
	if (editing) {
		const { error } = await db.from("tickets").update(columns).eq("id", input.clientId);
		// `fn_ticket_immutability_guard` locks a claimed ticket's client-owned content to everybody but
		// its assignee, so this is a real refusal a reviewer can act on rather than a fault.
		if (error) return { refusal: refusalFrom(error.message, "title") };
	} else {
		const { data, error } = await db
			.from("tickets")
			.insert({ ...columns, project_id: project.id, status: "backlog" })
			.select("id")
			.maybeSingle();
		if (error) return { refusal: refusalFrom(error.message, "title") };
		const created = (data as { id?: string } | null)?.id;
		if (!created) return { refusal: refusalFrom("tickets insert returned no id", "title") };
		ticketId = created;
	}

	if (input.status !== "backlog" || editing) {
		const { error } = await db.rpc("move_ticket", {
			p_ticket_id: ticketId,
			p_to_status: input.status,
			p_to_stage_id: input.stageId,
			p_sort_order: null,
		});
		if (error) return { refusal: refusalFrom(error.message, "status") };
	}
	return { data: ticketId };
}

/**
 * Move one ticket, and return its id.
 *
 * The whole move goes through `projects.move_ticket` — never a column write. That function checks
 * delivery authority (only the client/owner may drop a card into Done, which is what releases
 * escrow), writes the audit row, and applies `sort_order` only for the backlog lane, where
 * `fn_ticket_ordering_guard` permits it.
 */
export async function moveTicketRow(
	actor: ReadActor & { accessToken: string },
	input: MoveTicket,
): Promise<WriteOutcome<string>> {
	if (!UUID_RE.test(input.ticketId)) return null;
	const { error } = await projectsDb(actor).rpc("move_ticket", {
		p_ticket_id: input.ticketId,
		p_to_status: input.status,
		p_to_stage_id: input.stageId,
		p_sort_order: input.sortOrder,
	});
	if (error) return { refusal: refusalFrom(error.message, "status") };
	return { data: input.ticketId };
}
// #endregion

// #region Messages
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/**
 * A `h:mm AM` clock in UTC.
 *
 * UTC and fixed English names, never `Intl`: the label is produced here and re-produced by the feed
 * on its next refetch, so anything reading a local zone or a locale makes the sent bubble and the
 * fetched one disagree about when it was sent.
 */
function clockLabel(iso: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const d = new Date(at);
	const hh = d.getUTCHours();
	const h12 = hh % 12 === 0 ? 12 : hh % 12;
	return `${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** `Today` / `Yesterday` / `Mon, Jul 14`, in UTC for the same reason as {@link clockLabel}. */
function dayLabel(iso: string, now: number): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const days = Math.floor(now / DAY_MS) - Math.floor(at / DAY_MS);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	const d = new Date(at);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Post one message into a project channel and return the row as the feed renders it.
 *
 * Attachments are registered in BOTH places the schema keeps them, and the two speak different
 * vocabularies: `comms.message_attachments.message_table` is schema-qualified
 * (`'comms.project_messages'`) while `comms.channel_files.channel_type` is the bare `'project'`.
 * Matching the wrong one returns zero rows and raises nothing, so the file would simply never appear
 * in the channel's Files tab and nothing would say why.
 *
 * A failed attachment link does NOT fail the send. The message is already committed at that point,
 * and refusing the whole call would report a failure for something the reader can see in the channel.
 */
export async function insertProjectMessage(
	actor: ReadActor & { accessToken: string },
	input: SendProjectMessage,
	now: number = Date.now(),
): Promise<WriteOutcome<ChatMessage>> {
	if (!UUID_RE.test(input.channelId)) return null;
	const db = commsDb(actor);

	const { data: channel, error: channelError } = await db
		.from("project_channels")
		.select("id, project_id")
		.eq("id", input.channelId)
		.maybeSingle();
	if (channelError) throw new Error(`comms.project_channels read failed: ${channelError.message}`);
	if (!channel) return null;

	const attachmentIds = input.attachmentIds.filter((id) => UUID_RE.test(id));
	const { data, error } = await db
		.from("project_messages")
		.insert({
			channel_id: input.channelId,
			// Pinned to the caller rather than taken from the payload. The INSERT policy asserts the
			// same thing, so a mismatch would be refused — but sending a value the policy has to reject
			// is how a client comes to believe it may choose an author.
			sender_user_id: actor.userId,
			body: clamp(input.text, RICH_TEXT_MAX),
			has_attachments: attachmentIds.length > 0,
			is_audio: input.audio !== null,
		})
		.select("id, created_at")
		.maybeSingle();
	if (error) return { refusal: refusalFrom(error.message, "text") };
	const row = data as { id?: string; created_at?: string } | null;
	if (!row?.id) return { refusal: refusalFrom("project_messages insert returned no id", "text") };

	if (attachmentIds.length > 0) {
		await db.from("message_attachments").insert(
			attachmentIds.map((attachmentId) => ({
				message_table: "comms.project_messages",
				message_id: row.id,
				attachment_id: attachmentId,
			})),
		);
		await db.from("channel_files").insert(
			attachmentIds.map((attachmentId) => ({
				channel_type: "project",
				channel_id: input.channelId,
				attachment_id: attachmentId,
			})),
		);
	}

	const createdAt = row.created_at ?? new Date(now).toISOString();
	const parties = await fetchParties(actor, [actor.userId]);
	return {
		data: {
			id: row.id,
			type: "user",
			createdAt,
			timeLabel: clockLabel(createdAt),
			dayLabel: dayLabel(createdAt, now),
			sender: senderOf(actor.userId, parties.get(actor.userId)),
			isOwn: true,
			text: clamp(input.text, 4000),
			// The attachment projection needs the `files.items` rows the ids point at, which the feed's
			// own read already assembles. Returning them empty here and letting the next page fill them
			// in is one assembler rather than two that can disagree about what a file is called.
			attachments: [],
			audio: input.audio,
			system: null,
			reactions: [],
			pinned: false,
			favorited: false,
		},
	};
}
// #endregion

// #region Create
/**
 * Create one engagement, and return the two identifiers it can be addressed by.
 *
 * The whole write is ONE call to `projects.create_project`, and that is a deliberate departure from
 * every other write in this module, which goes straight at a table under the caller's own RLS. Three
 * reasons, in order of weight:
 *
 * 1. **It has to be atomic.** A create touches `projects`, `project_stages`, `stage_staffing_roles`
 *    and `project_participants`. PostgREST gives us one statement per round trip and no transaction
 *    around them, so a failure on the third leaves an engagement the client has already navigated to
 *    holding half of what they typed.
 * 2. **`update_entity_project_counts` is an INVOKER trigger** on `projects.projects` that writes
 *    `org.users_public`. Inside a `SECURITY DEFINER` function it runs in the definer's context, which
 *    is where a bookkeeping counter belongs; a direct insert makes it the caller's problem.
 * 3. **The slug needs a retry loop.** Two people naming a project the same thing in the same instant
 *    both see the address free; only the unique index resolves it, and only a loop that catches the
 *    violation can pick a new one and try again.
 *
 * The payload is snake_cased here because the function reads columns, not camelCase fields. Nothing
 * authoritative travels in it: `owner_user_id`, `status` and `visibility` are all set by the function
 * itself, so a caller who hand-rolls this request cannot name somebody else as owner or publish a
 * project in the act of creating it.
 */
export async function insertProject(
	actor: ReadActor & { accessToken: string },
	input: CreateProject,
): Promise<WriteOutcome<CreatedProject>> {
	const { format, structure } = createFormatToColumns(input.format);
	const html = clamp(input.scope, RICH_TEXT_MAX);
	const title = clamp(input.title, TITLE_MAX);

	// The owning workspace is derived from the ACTOR, never from the payload.
	//
	// Not a precaution — the payload's two scope fields contradict each other on every request from a
	// non-personal context: the modal hardcodes `scopeType: "personal"` while passing the viewer's real
	// active-context id as `scopeId`. Trusting the type files every project personally; trusting the id
	// writes a scope the payload denies. Neither errors, and both silently mis-file the project so the
	// feed's own scope filter never surfaces it.
	//
	// `actor.contextType` / `actor.contextId` come off the verified session, which is the same source
	// the READ path resolves a project's scope from — so what a create files under and what the feed
	// groups by cannot disagree. The columns are the exact inverse of the read's `scopeOf`: one typed
	// column per workspace kind, and personal scope is the ABSENCE of all three.
	//
	// A scope id that is not a uuid names no workspace row (a personal context reports the user's own
	// id, which is not a workspace at all), so it maps to personal rather than into a foreign key.
	const scopeId = actor.contextId.trim();
	const scoped = scopeId.length > 0 && UUID_RE.test(scopeId);
	const scopeType = scoped ? actor.contextType : "personal";

	const payload: Record<string, unknown> = {
		title,
		slug: projectSlugFrom(input.title),
		format,
		structure_variation: structure,
		description: { html },
		description_text: flattenRichText(html),
		client_business_id: scopeType === "business" ? scopeId : null,
		owner_team_id: scopeType === "team" ? scopeId : null,
		owner_organisation_id: scopeType === "organisation" ? scopeId : null,
		budget_type: input.budget?.budgetType ?? "fixed_price",
		// Sent as a STRING because the function reads it with `->>` and casts; a JSON number would
		// arrive the same way, but the string keeps the wire shape uniform with every other field and
		// leaves no room for a float to appear in a minor-unit column.
		budget_amount_cents: input.budget ? String(input.budget.amountCents) : null,
		currency: input.budget?.currency ?? "USD",
		stages: input.stages.map((stage) => ({
			name: clamp(stage.name, NAME_MAX),
			description: { html: clamp(stage.description, RICH_TEXT_MAX) },
			description_text: flattenRichText(clamp(stage.description, RICH_TEXT_MAX)),
			unit_price_cents: stage.unitPriceCents === null ? null : String(stage.unitPriceCents),
			milestone: clamp(stage.milestone, 240),
		})),
		roles: input.roles.map((role) => ({
			name: clamp(role.name, NAME_MAX),
			skills: role.skills.map((skill) => clamp(skill, 60)).filter((skill) => skill.length > 0),
		})),
	};

	const { data, error } = await projectsDb(actor).rpc("create_project", { payload });
	if (error) return { refusal: refusalFrom(error.message, "title") };

	const created = data as { id?: string; slug?: string } | null;
	if (!created?.id || !created.slug) {
		return { refusal: refusalFrom("create_project returned no identifier", "title") };
	}
	return { data: { id: created.id, slug: created.slug } };
}
// #endregion

// #region Submissions
/**
 * Create one submission unit and return it as the explorer renders it.
 *
 * `submit` is the whole difference between two write paths. Sending for review goes through
 * `projects.submit_deliverable`, which numbers the submission, links its files and moves the ticket
 * into Review in one transaction. A DRAFT cannot use it — the function hard-codes `pending_review`,
 * which is a delivery claim the freelancer has not made — so a draft is a direct INSERT under the
 * caller's own policy.
 *
 * `projects.stage_submissions.ticket_id` is `NOT NULL`, so a submission with no ticket is not
 * representable at all. It is refused with a field error rather than being attached to an arbitrary
 * ticket, which would file somebody's work against work they were not doing.
 */
export async function insertSubmission(
	actor: ReadActor & { accessToken: string },
	input: CreateSubmission,
	now: number = Date.now(),
): Promise<WriteOutcome<SubmissionUnit>> {
	if (!input.ticketId || !UUID_RE.test(input.ticketId)) {
		return {
			refusal: {
				status: 422,
				message: "Pick the ticket this submission delivers against.",
				errors: { ticketId: "ticket_required" },
			},
		};
	}
	if (!UUID_RE.test(input.stageId)) return null;

	const db = projectsDb(actor);
	const html = clamp(input.description, RICH_TEXT_MAX);
	const fileIds = input.fileIds.filter((id) => UUID_RE.test(id));
	const title = clampOr(input.title, 200, "Submission");

	let submissionId: string | null = null;
	let status: string = input.submit ? "pending_review" : "draft";

	if (input.submit && input.submissionId && UUID_RE.test(input.submissionId)) {
		// SENDING an existing draft — a status transition, not a create. `submit_deliverable` always
		// inserts, so routing here through it would file the same delivery a second time; the policy
		// (`Submit own draft submissions`) bounds this to the caller's own row while it is still a draft
		// and to `pending_review` as the only reachable post-image.
		const { data, error } = await db
			.from("stage_submissions")
			.update({ status: "pending_review", checked_item_ids: input.checkedItemIds })
			.eq("id", input.submissionId)
			.select("id")
			.maybeSingle();
		if (error) return { refusal: refusalFrom(error.message, "title") };
		// No row came back: the draft is gone, already sent, or was never the caller's. RLS reports all
		// three the same way, so it is refused rather than guessed at.
		if (!data) {
			return {
				refusal: {
					status: 409,
					message: "That draft can no longer be submitted.",
					errors: { title: "not_draft" },
				},
			};
		}
		submissionId = input.submissionId;
		if (fileIds.length > 0) {
			await db.from("submission_files").insert(
				fileIds.map((fileId) => ({ submission_id: submissionId, file_id: fileId })),
			);
		}
	} else if (input.submit) {
		const { data, error } = await db.rpc("submit_deliverable", {
			p_ticket_id: input.ticketId,
			p_stage_id: input.stageId,
			p_title: title,
			p_description: { html },
			p_checked_item_ids: input.checkedItemIds,
			p_file_ids: fileIds,
		});
		if (error) return { refusal: refusalFrom(error.message, "title") };
		const payload = data as { id?: string; status?: string } | null;
		submissionId = payload?.id ?? null;
		status = payload?.status ?? "pending_review";
	} else {
		const { data, error } = await db
			.from("stage_submissions")
			.insert({
				project_stage_id: input.stageId,
				ticket_id: input.ticketId,
				// Pinned to the caller for the same reason the message sender is: the INSERT policy
				// asserts it, and sending anything else is a value the policy exists to reject.
				submitted_by: actor.userId,
				title,
				description: { html },
				checked_item_ids: input.checkedItemIds,
				status: "draft",
			})
			.select("id, created_at")
			.maybeSingle();
		if (error) return { refusal: refusalFrom(error.message, "title") };
		submissionId = (data as { id?: string } | null)?.id ?? null;
		if (submissionId && fileIds.length > 0) {
			await db.from("submission_files").insert(
				fileIds.map((fileId) => ({ submission_id: submissionId, file_id: fileId })),
			);
		}
	}

	if (!submissionId) {
		return { refusal: refusalFrom("stage_submissions insert returned no id", "title") };
	}

	const [stage, parties] = await Promise.all([
		fetchStageName(actor, input.stageId),
		fetchParties(actor, [actor.userId]),
	]);
	const createdAt = new Date(now).toISOString();

	return {
		data: {
			// The explorer builds a unit's path as stage → submitter → submission, each segment an id
			// (`live-submissions.ts`). The UNCOLLAPSED chain is returned: whether the submitter level
			// collapses depends on staffing counts this write does not read, and the explorer's own next
			// read resolves the authoritative path either way.
			path: input.channelId
				? [actor.userId, submissionId]
				: [input.stageId, actor.userId, submissionId],
			name: title,
			kind: "custom",
			status: toSubmissionStatus(status),
			submitter: senderOf(actor.userId, parties.get(actor.userId)),
			stageId: input.stageId,
			stageName: stage,
			ticketId: input.ticketId,
			// The ticket's title needs its own read, and the explorer resolves it on the next page. A
			// label invented here could disagree with the one the tree draws a moment later.
			ticketTitle: null,
			createdAt,
			dateLabel: dayLabel(createdAt, now),
			fileCount: fileIds.length,
			noteCount: 0,
		},
	};
}

/** The stage's display name, or `null` when the row is withheld. */
async function fetchStageName(
	actor: ReadActor & { accessToken: string },
	stageId: string,
): Promise<string | null> {
	const { data, error } = await projectsDb(actor)
		.from("project_stages")
		.select("name")
		.eq("id", stageId)
		.maybeSingle();
	if (error || !data) return null;
	return clamp((data as { name?: string }).name, NAME_MAX) || null;
}
// #endregion
