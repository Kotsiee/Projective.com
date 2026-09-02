import {
	type ArchiveProject,
	type ChatMessage,
	type CommitTicket,
	type CreatedProject,
	createFormatToColumns,
	type CreateProject,
	type CreateProjectStage,
	type CreateSubmission,
	effectiveVisibility,
	type MoveTicket,
	ndaDocumentFor,
	type NdaMode,
	ndaRequiredFor,
	type ProjectFormat,
	type ProjectRoleSetup,
	type ProjectRules,
	type ProjectSetup,
	projectSlugFrom,
	type ProjectStructure,
	type ProjectVisibility,
	reconcileSetup,
	type SendProjectMessage,
	type StageDurationMode,
	type StageSetup,
	type SubmissionUnit,
	type UpdateProject,
	workloadIntensity,
} from "@projective/types/projects";
import { FileCategory } from "@projective/types/files";
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
	nda_mode: string;
	nda_document_id: string | null;
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
	/** The checklist a ticket is seeded from — a jsonb array whose elements may be labels or objects. */
	default_tasks: unknown;
	file_upload_required: boolean;
	/** `NULL` is UNLIMITED, not "unset" — the column's own nullable-as-unbounded convention. */
	seat_limit: number | null;
	parallel: boolean;
	nda_override: boolean;
	/** `NULL` or empty means every category; the column stores `files.file_category` literals. */
	allowed_file_categories: string[] | null;
	allowed_file_extensions: string[] | null;
	/** The stage this one waits on, by id. The projection reports it as an ORDERED INDEX instead. */
	start_dependency_stage_id: string | null;
	start_dependency_lag_days: number | null;
	/** `NULL` is a stage whose owner has not chosen a timing model; it reads as `no_due_date`. */
	file_duration_mode: string | null;
	file_duration_days: number | null;
	file_due_date: string | null;
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
	"nda_mode",
	"nda_document_id",
	"portfolio_display_rights",
	"timeline_preset",
	"allow_deadline_bonuses",
	"location_restriction",
	"language_requirement",
	"owner_user_id",
	"archived_at",
].join(", ");

/** The stage columns the setup form reads and writes. */
const SETUP_STAGE_COLUMNS = [
	"id",
	"name",
	"sort_order",
	"description",
	"description_text",
	"unit_price_cents",
	"milestone",
	"skills",
	"default_tasks",
	"file_upload_required",
	"seat_limit",
	"parallel",
	"nda_override",
	"allowed_file_categories",
	"allowed_file_extensions",
	"start_dependency_stage_id",
	"start_dependency_lag_days",
	"file_duration_mode",
	"file_duration_days",
	"file_due_date",
].join(", ");
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

/** A stored string list, clamped to the projection's own bounds. Anything empty is dropped. */
function textList(values: readonly string[] | null, max: number, itemMax: number): string[] {
	return (values ?? [])
		.map((value) => clamp(value, itemMax))
		.filter((value) => value.length > 0)
		.slice(0, max);
}

/**
 * The checklist labels out of `project_stages.default_tasks`.
 *
 * The column is `jsonb` with no shape enforced, so an element may be a bare label or an object a
 * later ticket-seeding write chose to store. Both are read, and anything else is DROPPED rather than
 * stringified: `[object Object]` in a checklist is worse than a missing row, because it looks like
 * something the owner typed.
 */
function taskLabels(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			const label = clamp(entry, 240);
			if (label.length > 0) out.push(label);
			continue;
		}
		if (entry && typeof entry === "object") {
			const record = entry as Record<string, unknown>;
			const raw = record.label ?? record.text ?? record.title;
			if (typeof raw === "string") {
				const label = clamp(raw, 240);
				if (label.length > 0) out.push(label);
			}
		}
	}
	return out.slice(0, 50);
}

/**
 * The stage's timing model.
 *
 * `NULL` reads as `no_due_date` because the projection has no third state for "the owner has not
 * chosen": the column is NULL-tolerant on purpose, and a reader that had to treat NULL and
 * `'no_due_date'` as the same answer would be carrying two representations of one state. An
 * unrecognised value lands there too — the CHECK makes it unreachable, and inventing a fourth mode
 * for a row that predates the CHECK would put a timing model on the form nobody selected.
 */
function durationModeOf(value: string | null): StageDurationMode {
	if (value === "fixed_deadline" || value === "relative_duration") return value;
	return "no_due_date";
}

/** The categories a submission may carry, filtered to the vocabulary both sides actually share. */
function fileCategoriesOf(values: readonly string[] | null): StageSetup["allowedFileCategories"] {
	const allowed = new Set<string>(FileCategory.options);
	return (values ?? []).filter((value): value is StageSetup["allowedFileCategories"][number] =>
		allowed.has(value)
	).slice(0, 28);
}

/** A stored integer, held inside the projection's bounds; anything outside them reads as absent. */
function boundedInt(value: number | null, min: number, max: number): number | null {
	if (value === null || !Number.isFinite(value)) return null;
	const rounded = Math.round(value);
	if (rounded < min || rounded > max) return null;
	return rounded;
}

/**
 * Project a stage row onto the setup form's stage shape.
 *
 * `orderIndex` maps a stage id onto its position in the ORDERED list, because
 * {@link StageSetup.dependsOnStageIndex} is an index and the column is a uuid. The index is what the
 * wizard edits — a stage being sketched has no durable identity yet — so the two ends of the round
 * trip speak the same language and the form never has to resolve a uuid it was not given.
 *
 * A dependency the map cannot resolve reads as `null`: `project_stages.start_dependency_stage_id`
 * carries a foreign key to the TABLE rather than to this project, and a reference this list cannot
 * place is one the form has no row to point at.
 */
function toStageSetup(row: SetupStageRow, orderIndex: ReadonlyMap<string, number>): StageSetup {
	return {
		id: row.id,
		name: clampOr(row.name, NAME_MAX, "Stage"),
		order: row.sort_order,
		description: richTextOf(row.description, row.description_text),
		unitPriceCents: row.unit_price_cents,
		milestone: clamp(row.milestone ?? "", 240),
		skills: textList(row.skills, 20, 60),
		tasks: taskLabels(row.default_tasks),
		requiresFiles: row.file_upload_required,
		seatLimit: boundedInt(row.seat_limit, 1, Number.MAX_SAFE_INTEGER),
		parallel: row.parallel,
		dependsOnStageIndex: row.start_dependency_stage_id
			? orderIndex.get(row.start_dependency_stage_id) ?? null
			: null,
		lagDays: boundedInt(row.start_dependency_lag_days, 0, 365) ?? 0,
		ndaOverride: row.nda_override,
		allowedFileCategories: fileCategoriesOf(row.allowed_file_categories),
		allowedFileExtensions: textList(row.allowed_file_extensions, 50, 16),
		durationMode: durationModeOf(row.file_duration_mode),
		durationDays: boundedInt(row.file_duration_days, 0, 3650),
		dueDate: row.file_due_date ? clamp(row.file_due_date, 40) : null,
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

/** The stored confidentiality mode, defaulting anything unrecognised to `none`. */
function ndaModeOf(value: string | null): NdaMode {
	return value === "platform_standard" || value === "custom" ? value : "none";
}

/**
 * The engagement rules, read straight off the columns they map 1:1 onto.
 *
 * `ndaRequired` is DERIVED from the mode rather than read from its own column. The two are a pair —
 * the enum governs and the boolean is its shadow — and reading each independently is how a row whose
 * halves have drifted comes to answer "is this work confidential?" differently depending on which
 * consumer asks. `ndaDocumentFor` applies the same discipline to the document reference, so a
 * projection can never name an instrument under a mode that does not cite one.
 */
function toRules(row: SetupProjectRow): ProjectRules {
	const ndaMode = ndaModeOf(row.nda_mode);
	return {
		visibility: row.visibility as ProjectRules["visibility"],
		ipOwnershipMode: row.ip_ownership_mode as ProjectRules["ipOwnershipMode"],
		ndaRequired: ndaRequiredFor(ndaMode),
		ndaMode,
		ndaDocumentId: ndaDocumentFor(ndaMode, row.nda_document_id),
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
	const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order);
	// Built BEFORE the projection so a dependency can be reported as the index of the stage it names,
	// including a FORWARD reference — a stage that waits on one below it is legal, and resolving the
	// map row by row would report it as unset.
	const orderIndex = new Map(ordered.map((row, index) => [row.id, index]));
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
		stages: ordered.map((stage) => toStageSetup(stage, orderIndex)),
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
		message.includes("Only the project owner") ||
		// `create_project` raises 42501 with this wording when a caller names a workspace they do not
		// belong to. It is a refusal of THIS caller in the database's own words, which is a 403 — and
		// the errcode does not travel in the message, so the sentence is what there is to match on.
		message.includes("not an active member");
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
		message.includes("not part of this project") ||
		message.includes("A project belongs to one workspace") ||
		message.includes("Name your project") ||
		message.includes("free address for this project") ||
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

/**
 * The currency as `ck_projects_currency` will accept it.
 *
 * `CurrencyCode` already refuses anything else at the parser, so this is the second half of the same
 * rule rather than a new one: the fat service is also called from SSR with a typed value that never
 * passed through Zod, and a lowercase code reaching the column is a `23514` raised in the middle of
 * a save the owner cannot act on. Uppercasing is ISO 4217's own convention, not a decision taken on
 * the caller's behalf; anything that is still not three letters is dropped rather than truncated
 * into a code that means something else.
 *
 * Exported because the STUB create stores a currency too, and `projects.create_project` upper-cases
 * what it is sent — so the two branches have to normalise identically or a project drafted with the
 * gate off reads back in a different case from the same project drafted with it on.
 */
export function normalisedCurrency(value: string): string | null {
	const code = value.trim().toUpperCase();
	return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Write the NDA triple as one coherent answer, or not at all.
 *
 * `nda_mode` governs, `nda_required` is its shadow and `nda_document_id` is only meaningful under
 * `custom`. The database enforces the last of the three (`ck_projects_nda_document`) and NOTHING
 * enforces the first two against each other, so an update that touched one half would leave a row
 * whose columns disagree about whether the work is confidential — and each consumer would get a
 * different answer depending on which one it happens to read.
 *
 * A caller that sends only the legacy boolean is honoured: `true` means the platform's standard
 * terms, because "an NDA governs this and nobody said which" is exactly what `platform_standard`
 * names. That is the same reconciliation `projects.create_project` performs, stated once on each
 * path because the two write through different mechanisms.
 */
function ndaPatch(
	patch: Record<string, unknown>,
	rules: NonNullable<UpdateProject["rules"]>,
	row: SetupProjectRow,
): void {
	const current = ndaModeOf(row.nda_mode);
	const mode = rules.ndaMode ??
		(rules.ndaRequired === undefined
			? current
			: (rules.ndaRequired ? "platform_standard" : "none"));

	const touched = rules.ndaMode !== undefined || rules.ndaRequired !== undefined ||
		rules.ndaDocumentId !== undefined;
	if (!touched) return;

	const document = rules.ndaDocumentId !== undefined ? rules.ndaDocumentId : row.nda_document_id;
	patch.nda_mode = mode;
	patch.nda_required = ndaRequiredFor(mode);
	// Cleared by the mode, not by the caller: switching away from `custom` has to drop the reference
	// in the SAME statement, or the CHECK refuses the write for a document the caller never mentioned.
	patch.nda_document_id = ndaDocumentFor(mode, document ?? null);
}

/**
 * Build the `projects.projects` column patch from the validated payload.
 *
 * `visibility` is deliberately NOT here. It is the one rule whose stored value is a FUNCTION of the
 * project's completeness rather than of what the caller asked for, and the completeness is only
 * knowable once the stages and roles in this same payload have landed — so it is resolved after
 * them, by {@link resolveVisibility}, against the ladder the write actually produced.
 */
function projectColumnPatch(input: UpdateProject, row: SetupProjectRow): Record<string, unknown> {
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
	if (input.budget?.currency !== undefined) {
		const currency = normalisedCurrency(input.budget.currency);
		if (currency) patch.currency = currency;
	}
	const rules = input.rules;
	if (rules) ndaPatch(patch, rules, row);
	if (rules?.ipOwnershipMode !== undefined) patch.ip_ownership_mode = rules.ipOwnershipMode;
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
 * Map a stage's optional configuration onto the snake_case bag BOTH stage writes take.
 *
 * One mapping, used by the UPDATE patch and by `create_stage`'s `p_payload`, because the two write
 * the same columns through different mechanisms and a field folded into one and forgotten in the
 * other is invisible to the type checker: the create succeeds, the value is silently the column's
 * default, and the owner discovers it the next time they open the form.
 *
 * Only keys the caller actually sent are emitted. That is what makes it safe on a PATCH — an absent
 * key means "unchanged" for the update and "take the column default" for the RPC — and it is why
 * `seat_limit` is passed through verbatim rather than defaulted here: absent means the cap stands at
 * three and an explicit `null` means Unlimited, a distinction `create_project` reads with `?` and a
 * `?? 3` at this layer would erase.
 *
 * The three timing fields are written as ONE answer. `durationMode` decides which of the other two
 * is meaningful, so a patch that changed the mode and left a stale absolute date behind would leave
 * a stage claiming a deadline its own mode says it does not have.
 */
function stageColumnBag(
	stage: Partial<StageSetup>,
	current?: SetupStageRow,
): Record<string, unknown> {
	const bag: Record<string, unknown> = {};
	if (stage.milestone !== undefined) bag.milestone = clamp(stage.milestone, 240);
	if (stage.skills !== undefined) bag.skills = textList(stage.skills, 20, 60);
	if (stage.tasks !== undefined) bag.default_tasks = textList(stage.tasks, 50, 240);
	if (stage.requiresFiles !== undefined) bag.file_upload_required = stage.requiresFiles;
	if (stage.seatLimit !== undefined) bag.seat_limit = stage.seatLimit;
	if (stage.parallel !== undefined) bag.parallel = stage.parallel;
	if (stage.lagDays !== undefined) bag.start_dependency_lag_days = stage.lagDays;
	if (stage.ndaOverride !== undefined) bag.nda_override = stage.ndaOverride;
	if (stage.allowedFileCategories !== undefined) {
		// NULL rather than `{}` for an empty list. Both mean "every category" to every reader, and NULL
		// is the one that says the owner never narrowed it, where an empty array reads as a list
		// somebody emptied.
		const categories = fileCategoriesOf(stage.allowedFileCategories);
		bag.allowed_file_categories = categories.length > 0 ? categories : null;
	}
	if (stage.allowedFileExtensions !== undefined) {
		bag.allowed_file_extensions = textList(stage.allowedFileExtensions, 50, 16);
	}

	const timing = stage.durationMode !== undefined || stage.durationDays !== undefined ||
		stage.dueDate !== undefined;
	if (timing) {
		const mode = stage.durationMode ?? durationModeOf(current?.file_duration_mode ?? null);
		bag.file_duration_mode = mode;
		bag.file_duration_days = mode === "relative_duration"
			? stage.durationDays ?? current?.file_duration_days ?? null
			: null;
		bag.file_due_date = mode === "fixed_deadline"
			? stage.dueDate ?? current?.file_due_date ?? null
			: null;
	}
	return bag;
}

/**
 * Resolve every stage's `dependsOnStageIndex` against the ids the pass has just settled.
 *
 * A SECOND pass, mirroring `projects.create_project`'s own: a stage may legitimately wait on one
 * declared after it, so an inline resolution would report a forward reference as unset — and a stage
 * created in this same request has no id until it has been created.
 *
 * A self-reference and an out-of-range index are REFUSED rather than dropped. The foreign key names
 * the table rather than the project, so the database accepts both: a stage waiting on itself never
 * opens, and an index pointing past the list is a schedule the form drew and the row does not have.
 */
async function reconcileDependencies(
	actor: ReadActor & { accessToken: string },
	stages: NonNullable<UpdateProject["stages"]>,
	ordered: readonly string[],
): Promise<WriteRefusal | null> {
	const db = projectsDb(actor);
	for (const [position, stage] of stages.entries()) {
		if (stage.dependsOnStageIndex === undefined) continue;
		const index = stage.dependsOnStageIndex;
		let dependency: string | null = null;
		if (index !== null) {
			if (index === position) {
				return {
					status: 422,
					message: "A stage cannot wait on itself.",
					errors: { stages: "self_dependency" },
				};
			}
			dependency = ordered[index] ?? null;
			if (!dependency) {
				return {
					status: 422,
					message: "That stage waits on a stage this project does not have.",
					errors: { stages: "unknown_dependency" },
				};
			}
		}
		const id = ordered[position];
		if (!id) continue;
		const { error } = await db
			.from("project_stages")
			.update({ start_dependency_stage_id: dependency })
			.eq("id", id);
		if (error) return refusalFrom(error.message, "stages");
	}
	return null;
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
	const byId = new Map(existing.map((row) => [row.id, row]));
	const keep = new Set<string>();
	const ordered: string[] = [];

	for (const [index, stage] of stages.entries()) {
		const html = clamp(stage.description ?? "", RICH_TEXT_MAX);
		const name = clampOr(stage.name, NAME_MAX, `Stage ${index + 1}`);
		if (isExistingId(stage.id, DRAFT_STAGE_PREFIX)) {
			const patch: Record<string, unknown> = {
				name,
				...stageColumnBag(stage, byId.get(stage.id)),
			};
			if (stage.description !== undefined) {
				patch.description = { html };
				patch.description_text = flattenRichText(html);
			}
			if (stage.unitPriceCents !== undefined) patch.unit_price_cents = stage.unitPriceCents;
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
		//
		// The whole configuration travels in `p_payload`, the sixth parameter, so the stage lands in
		// ONE statement. It used to be a create followed by a patch for the fields the signature could
		// not carry, which is two chances to half-write a stage — and the RPC is the only half that
		// opens the channel, so a failure between them left a room with no configuration behind it.
		const { data, error } = await db.rpc("create_stage", {
			p_project_id: projectRowId,
			p_name: name,
			p_description: { html },
			p_description_text: flattenRichText(html),
			p_unit_price_cents: stage.unitPriceCents ?? null,
			p_payload: stageColumnBag(stage),
		});
		if (error) return refusalFrom(error.message, "stages");
		const newId = typeof data === "string" ? data : null;
		if (!newId) return refusalFrom("create_stage returned no id", "stages");
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

	// LAST, because a dependency names a stage by its position in the list this pass has just settled:
	// resolving it earlier would point at the order the project had before the save.
	return await reconcileDependencies(actor, stages, ordered);
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
function validateUpdate(input: UpdateProject, row: SetupProjectRow): WriteRefusal | null {
	if (input.roles?.some((role) => role.budgetCents === null || role.budgetCents === undefined)) {
		return {
			status: 422,
			message: "Give every team role a budget.",
			errors: { roles: "budget_required" },
		};
	}
	// `ck_projects_deadline_bonus_format`. The format may be changing in this same payload, so the
	// pair is evaluated against the post-write shape rather than against the stored one — switching a
	// pipeline that offers bonuses to a one-off has to clear the flag in the same save, and telling
	// the owner which of the two to change is the only thing that makes the refusal actionable.
	const format = input.format ?? (row.format as ProjectFormat);
	const bonuses = input.rules?.allowDeadlineBonuses ?? row.allow_deadline_bonuses;
	if (bonuses && format !== "pipeline") {
		return {
			status: 422,
			message: "A deadline bonus is a per-ticket incentive, so only a pipeline can offer one.",
			errors: { allowDeadlineBonuses: "pipeline_only" },
		};
	}
	if (input.budget?.currency !== undefined && !normalisedCurrency(input.budget.currency)) {
		return {
			status: 422,
			message: "Use a 3-letter currency code, e.g. GBP.",
			errors: { currency: "invalid_currency" },
		};
	}
	for (const stage of input.stages ?? []) {
		if (stage.seatLimit !== undefined && stage.seatLimit !== null && stage.seatLimit < 1) {
			return {
				status: 422,
				message: "A stage seat cap is at least one person, or Unlimited.",
				errors: { stageSeatLimit: "seat_limit_positive" },
			};
		}
		if (
			stage.unitPriceCents !== undefined && stage.unitPriceCents !== null &&
			stage.unitPriceCents < 0
		) {
			// Not decorative: `finance.fn_hold_ticket_escrow` reads this column as an amount to hold, so
			// a negative price inverts the direction the money moves.
			return {
				status: 422,
				message: "A stage price cannot be negative.",
				errors: { stageUnitPrice: "price_negative" },
			};
		}
	}
	return null;
}

/** The outcome of a write: the new projection, a refusal, or `null` for "no such project". */
export type WriteOutcome<T> = { data: T } | { refusal: WriteRefusal } | null;

/**
 * Store the visibility the project has EARNED, given what its owner asked for.
 *
 * The one rule whose written value is not the value the caller sent. A discoverable engagement is a
 * promise to the freelancers who find it, so `effectiveVisibility` honours the request only once
 * every required ladder step is done and stores `unlisted` until then — and the ladder is a function
 * of the stages, roles and budget THIS save has just written, which is why it runs last, against the
 * re-read projection rather than against the payload.
 *
 * It writes only when the answer actually differs from what is stored, so an ordinary save costs no
 * extra statement, and it patches the returned projection rather than re-reading: the value was just
 * written by this function, and a second read would be one more round trip to learn something
 * already known.
 *
 * The gap this leaves is deliberate and worth naming: nothing stores what the owner REQUESTED, only
 * what they earned. A project downgraded to `unlisted` at create stays there until its owner picks
 * `public` again on a save that satisfies the ladder.
 */
async function applyEffectiveVisibility(
	actor: ReadActor & { accessToken: string },
	projectRowId: string,
	requested: ProjectVisibility,
	setup: ProjectSetup,
): Promise<WriteOutcome<ProjectSetup>> {
	const effective = effectiveVisibility(requested, setup.steps);
	if (effective === setup.rules.visibility) return { data: setup };

	const { data: touched, error } = await projectsDb(actor)
		.from("projects")
		.update({ visibility: effective })
		.eq("id", projectRowId)
		.select("id");
	if (error) return { refusal: refusalFrom(error.message, "visibility") };
	if (!touched || touched.length === 0) return { refusal: notWritten("visibility") };
	return { data: { ...setup, rules: { ...setup.rules, visibility: effective } } };
}

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
	const row = await fetchSetupProject(actor, projectId);
	if (!row) return null;
	const db = projectsDb(actor);

	// Before anything is written, so a section that was always going to be refused cannot leave the
	// earlier sections committed behind it. It needs the stored row because two of the refusals are
	// about the POST-write pair — a deadline bonus is legal or not depending on a format this same
	// payload may be changing.
	const invalid = validateUpdate(input, row);
	if (invalid) return { refusal: invalid };

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

	const patch = projectColumnPatch(input, row);
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
	if (input.rules?.visibility === undefined) return { data: setup };
	return await applyEffectiveVisibility(actor, row.id, input.rules.visibility, setup);
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
 * The visibility EVERY newly created engagement is stored under, on both sides of the gate.
 *
 * Re-exported from the Zod SSOT rather than declared here, because the wizard has to DISCLOSE what a
 * create will store and cannot import this module to find out — it performs writes and carries a
 * Supabase client. A second copy of the ceiling on the surface that explains it is how a form comes
 * to promise `public` over a row the database is about to store `unlisted`.
 */
export { CREATED_PROJECT_VISIBILITY } from "@projective/types/projects";

/**
 * A stage's timing triple as the payload carries it.
 *
 * The mode decides which of the other two is meaningful, so all three are emitted together and the
 * irrelevant one is explicitly `null`. Sending a duration alongside `fixed_deadline` would store a
 * stage whose columns describe two different schedules and leave every reader to pick one.
 */
function stageTimingPayload(stage: CreateProjectStage): Record<string, unknown> {
	return {
		file_duration_mode: stage.durationMode,
		file_duration_days: stage.durationMode === "relative_duration" && stage.durationDays !== null
			? String(stage.durationDays)
			: null,
		file_due_date: stage.durationMode === "fixed_deadline" ? stage.dueDate : null,
	};
}

/**
 * Everything about a create payload that can be refused without asking the database.
 *
 * Exported and called by the SERVICE rather than by this module, so the stub branch refuses exactly
 * what the live branch refuses. A rule enforced on one side of a gate is a rule whose violations
 * appear the day the gate flips, in a save that was working the day before.
 *
 * It refuses INVALID values, never incomplete ones. The wizard's whole design is that only a title
 * is mandatory and every other field carries a default, so a half-written draft is a legitimate
 * create and the tier taxonomy gates PUBLISHING, not saving. Everything below is a value the
 * database would refuse (a CHECK, a cast, a cardinality trigger) or a contradiction the row cannot
 * hold — reported against the wizard field that owns it, so the step rail can point at the control
 * rather than showing a sentence with nowhere to go.
 */
export function validateCreate(input: CreateProject): WriteRefusal | null {
	if (clamp(input.title, TITLE_MAX).trim().length === 0) {
		return {
			status: 422,
			message: "Name your project.",
			errors: { title: "title_required" },
		};
	}
	if (!normalisedCurrency(input.currency)) {
		return {
			status: 422,
			message: "Use a 3-letter currency code, e.g. GBP.",
			errors: { currency: "invalid_currency" },
		};
	}
	// `ck_projects_deadline_bonus_format`: a deadline bonus is a per-ticket incentive and only a
	// pipeline has per-ticket work to incentivise.
	if (input.allowDeadlineBonuses && input.format !== "pipeline") {
		return {
			status: 422,
			message: "A deadline bonus is a per-ticket incentive, so only a pipeline can offer one.",
			errors: { allowDeadlineBonuses: "pipeline_only" },
		};
	}
	// Both stage-less structures cap the project at ONE stage
	// (`fn_enforce_structure_variation`), and the cap is a BEFORE INSERT trigger — so a payload with
	// the toggle off and a list behind it aborts the whole transaction on the second stage, and the
	// author is told nothing about which of the two answers to change.
	if (!input.hasStages && input.stages.length > 1) {
		return {
			status: 422,
			message: "Turn stages on, or leave the project with a single stage.",
			errors: { hasStages: "stages_not_allowed" },
		};
	}
	if (input.ndaDocumentId !== null && !UUID_RE.test(input.ndaDocumentId)) {
		return {
			status: 422,
			message: "That NDA document could not be recognised.",
			errors: { ndaMode: "invalid_document" },
		};
	}
	// Each id is cast to `uuid` inside `create_project`'s attachment loop, and a `22P02` raised there
	// aborts a transaction the author has no way to explain. Refused rather than filtered: an
	// attachment dropped in silence is a reference the brief still claims to carry.
	if (input.attachmentIds.some((id) => !UUID_RE.test(id))) {
		return {
			status: 422,
			message: "One of those attachments could not be recognised.",
			errors: { attachmentIds: "invalid_attachment" },
		};
	}

	for (const [index, stage] of input.stages.entries()) {
		if (clamp(stage.name, NAME_MAX).trim().length === 0) {
			return {
				status: 422,
				message: "Give every stage a name.",
				errors: { stageName: "stage_name_required" },
			};
		}
		if (stage.unitPriceCents !== null && stage.unitPriceCents < 0) {
			// `finance.fn_hold_ticket_escrow` reads this column as an amount to hold, so a negative
			// price inverts the direction the money moves.
			return {
				status: 422,
				message: "A stage price cannot be negative.",
				errors: { stageUnitPrice: "price_negative" },
			};
		}
		if (stage.seatLimit !== null && stage.seatLimit < 1) {
			return {
				status: 422,
				message: "A stage seat cap is at least one person, or Unlimited.",
				errors: { stageSeatLimit: "seat_limit_positive" },
			};
		}
		if (stage.dependsOnStageIndex === null) continue;
		if (stage.dependsOnStageIndex === index) {
			return {
				status: 422,
				message: "A stage cannot wait on itself.",
				errors: { stageDependsOn: "self_dependency" },
			};
		}
		if (!input.stages[stage.dependsOnStageIndex]) {
			return {
				status: 422,
				message: "That stage waits on a stage this project does not have.",
				errors: { stageDependsOn: "unknown_dependency" },
			};
		}
	}
	return null;
}

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
 * project in the act of creating it — see {@link CREATED_PROJECT_VISIBILITY}.
 */
export async function insertProject(
	actor: ReadActor & { accessToken: string },
	input: CreateProject,
): Promise<WriteOutcome<CreatedProject>> {
	// `hasStages` is the author's own toggle and it is NOT a column: it folds into the structure here
	// (`hasStagesFor` reads it back out). Resolving the pair without it made the toggle inert — every
	// create resolved to the with-stages structure regardless of what the wizard was showing.
	const { format, structure } = createFormatToColumns(input.format, input.hasStages);
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

	// Stage identity is minted HERE, before the write, and that is what makes a dependency expressible
	// at all. `dependsOnStageIndex` is an index because a stage being sketched in the wizard has no
	// durable identity, while `start_dependency_stage_id` is a uuid — so somebody has to turn one into
	// the other, and the only party that can is the one that decides the ids. `create_project`
	// COALESCEs a supplied stage id, and its dependency pass matches on that same key, so supplying
	// both makes the whole schedule land inside the one transaction.
	const stageIds = input.stages.map(() => crypto.randomUUID());
	const ndaMode = input.ndaMode;

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
		// The TOP-LEVEL currency, not the budget's. They duplicate one value and the schema names this
		// one authoritative; reading the budget's would drop the author's choice for every project that
		// carries no budget, which is most of them at create time.
		currency: input.currency,
		ip_ownership_mode: input.ipOwnershipMode,
		portfolio_display_rights: input.portfolioDisplayRights,
		// The mode alone. `nda_required` is DERIVED by the function from it, so sending the boolean too
		// would be offering a second opinion the function is right to ignore — and would be the value
		// that disagreed if this layer ever computed it differently.
		nda_mode: ndaMode,
		nda_document_id: ndaDocumentFor(ndaMode, input.ndaDocumentId),
		allow_deadline_bonuses: input.allowDeadlineBonuses,
		language_requirement: textList(input.languages, 20, 60),
		location_restriction: textList(input.locations, 20, 60),
		global_attachments: input.attachmentIds,
		stages: input.stages.map((stage, index) => ({
			id: stageIds[index],
			name: clamp(stage.name, NAME_MAX),
			description: { html: clamp(stage.description, RICH_TEXT_MAX) },
			description_text: flattenRichText(clamp(stage.description, RICH_TEXT_MAX)),
			unit_price_cents: stage.unitPriceCents === null ? null : String(stage.unitPriceCents),
			milestone: clamp(stage.milestone, 240),
			default_tasks: textList(stage.tasks, 50, 240),
			skills: textList(stage.skills, 10, 60),
			file_upload_required: stage.requiresFiles,
			// Always present, and `null` when Unlimited. `create_project` reads the KEY with `?` — an
			// absent key takes the column's cap of three and a present `null` clears it — so omitting the
			// key for an unlimited stage would silently cap it instead.
			seat_limit: stage.seatLimit === null ? null : String(stage.seatLimit),
			parallel: stage.parallel,
			nda_override: stage.ndaOverride,
			allowed_file_categories: stage.allowedFileCategories,
			allowed_file_extensions: textList(stage.allowedFileExtensions, 50, 16),
			...stageTimingPayload(stage),
			start_dependency_stage_id: stage.dependsOnStageIndex === null
				? null
				: stageIds[stage.dependsOnStageIndex] ?? null,
			start_dependency_lag_days: String(stage.lagDays),
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
