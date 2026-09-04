import {
	type ArchiveProject,
	type ChatMessage,
	type CommitTicket,
	CREATED_PUBLISH_VISIBILITY,
	type CreatedProject,
	type CreateProject,
	type CreateSubmission,
	liveVisibilityFor,
	MAX_PROJECT_ATTACHMENTS,
	MAX_STAGE_SKILLS,
	MILESTONE_MAX,
	type MoveTicket,
	normaliseSeats,
	type ProjectAttachment,
	type ProjectCreateFormat,
	type ProjectFormat,
	type ProjectRoleSetup,
	type ProjectRules,
	type ProjectSetup,
	type ProjectStatus,
	type ProjectStructure,
	reconcileSetup,
	type SendProjectMessage,
	SKILL_LABEL_MAX,
	type StageDependency,
	type StageSetup,
	type StageStaffingRole,
	type StageTask,
	type SubmissionUnit,
	type UpdateProject,
	workloadIntensity,
} from "@projective/types/projects";
import type { SupabaseClient } from "supabaseClient";
import type { FieldErrors } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	filesDb,
	orgDb,
	projectsDb,
	senderOf,
	toSubmissionStatus,
} from "./live-support.ts";
import { UUID_RE } from "./project-identity.ts";

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
/**
 * ## Why several row fields below are declared OPTIONAL
 *
 * `projects.nda_source` / `nda_document_id` and the six per-stage configuration terms are declared in
 * `00000015_tables_projects.sql`, but this repository authors migrations without applying them (root
 * CLAUDE.md §8 Decision #67(a)) — so a live database can legitimately be a schema behind the file.
 *
 * They are still SELECTed. A projection that never asks for a column can never return it, which would
 * make the Stage-2 surface permanently blank rather than temporarily degraded; and PostgREST answers
 * a request for a missing column with `42703`, which this module turns into a thrown read, which
 * `ProjectBackendService.setup` catches and answers from the fixtures. So the page still renders.
 *
 * The optional declarations cover the narrower case the throw does not: a row that RESOLVED but
 * carries less than the interface claims. There, a field with no column comes back NEUTRAL and is
 * never invented — the precedent every live module in this folder already follows, where
 * `categoryWeight` returns 1 and presence returns `offline` rather than a plausible guess.
 */

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
	/** The owner's intent; optional so a row written before the column existed still parses. */
	publish_visibility?: string | null;
	ip_ownership_mode: string;
	nda_required: boolean;
	/** Which NDA binds the parties — optional for the reason at the head of this region. */
	nda_source?: string | null;
	nda_document_id?: string | null;
	portfolio_display_rights: string;
	timeline_preset: string;
	allow_deadline_bonuses: boolean;
	location_restriction: string[] | null;
	language_requirement: string[] | null;
	owner_user_id: string;
	archived_at: string | null;
}

/**
 * The `projects.project_stages` columns the setup form edits.
 *
 * Everything from `default_tasks` down is OPTIONAL, for the reason at the head of this region.
 */
interface SetupStageRow {
	id: string;
	name: string;
	sort_order: number;
	description: unknown;
	description_text: string;
	unit_price_cents: number | null;
	milestone: string | null;
	skills: string[] | null;
	default_tasks?: unknown;
	start_trigger_type?: string | null;
	file_duration_days?: number | null;
	capacity?: string | null;
	seat_count?: number | null;
	allowed_file_kinds?: string[] | null;
	nda_required?: boolean | null;
}

/**
 * The `projects.stage_staffing_roles` columns the setup form reads.
 *
 * `quantity` is selected as well as the budget, because a stage role and a Direct Deliverable's role
 * are two different SSOT shapes read from one table: {@link StageStaffingRole} carries how many
 * providers the role takes, and {@link ProjectRoleSetup} does not.
 */
interface StaffingRoleRow {
	id: string;
	project_stage_id: string;
	role_title: string;
	quantity: number | null;
	/**
	 * NULL is "unpriced", which is a different fact from zero — the column is nullable for the same
	 * reason `projects.budget_amount_cents` is, and the setup ladder counts a number somebody supplied.
	 */
	budget_amount_cents: number | null;
	/** The freeform tags this seat needs; `project_stages.skills` one level down, not a join table. */
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
	"publish_visibility",
	"ip_ownership_mode",
	"nda_required",
	"nda_source",
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
	"start_trigger_type",
	"file_duration_days",
	"capacity",
	"seat_count",
	"allowed_file_kinds",
	"nda_required",
].join(", ");

/** The staffing-role columns, named once for the same reason the two lists above are. */
const STAFFING_ROLE_COLUMNS =
	"id, project_stage_id, role_title, quantity, budget_amount_cents, skills";

/**
 * The `files.items` columns a project attachment is NAMED and SIZED from.
 *
 * Read through `filesDb` as a second request rather than as a PostgREST embed, matching how this
 * module already reaches `org` for parties: `project_attachments` is a bare join table in `projects`
 * and the file lives in `files`, and a cross-schema embed depends on a relationship the schema cache
 * exposes rather than on one this module can see. Two requests that each fail legibly beat one that
 * fails as "could not find a relationship".
 *
 * The attachment is carried BY REFERENCE and never copied (`ProjectAttachmentSchema`): an asset here
 * is one row with one owner and one privacy scope, and a project attachment is a second surface onto
 * it. Copying the name would let the two disagree the moment the owner renames the file.
 */
const ATTACHMENT_FILE_COLUMNS = "id, display_name, size_bytes";

/** One `files.items` row as selected by {@link ATTACHMENT_FILE_COLUMNS}. */
interface FileRow {
	id: string;
	display_name: string;
	size_bytes: number | null;
}
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

/**
 * The default checklist a ticket on this stage is seeded from.
 *
 * `project_stages.default_tasks` is `jsonb` with no shape constraint, so the column can hold anything
 * that ever parsed as JSON. Each entry is validated to the SSOT's `{ id, text }` and anything that
 * does not fit is DROPPED rather than coerced: a task rendered from a malformed row would put a
 * checklist item in front of a freelancer that the client never wrote.
 */
function toStageTasks(raw: unknown): StageTask[] {
	if (!Array.isArray(raw)) return [];
	const tasks: StageTask[] = [];
	for (const [index, entry] of raw.entries()) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const record = entry as Record<string, unknown>;
		const text = typeof record.text === "string" ? record.text.trim() : "";
		if (text.length === 0) continue;
		const id = typeof record.id === "string" && record.id.length > 0
			? record.id
			: `task-${index + 1}`;
		tasks.push({ id: clamp(id, 80), text: clamp(text, 240) });
		if (tasks.length >= 50) break;
	}
	return tasks;
}

/**
 * How a stage starts, from the column's fuller vocabulary.
 *
 * `start_trigger_type` carries more members than the setup form asks about, and only one of them is
 * "runs alongside the project": `on_project_start`. Everything else — a fixed date, a dependency on
 * another stage — waits for something, which is what `sequential` means to a reader of this form. A
 * missing column reads `sequential`, matching the SSOT's own `blankStage` default, so a stage on a
 * database that predates the column is described the way a freshly created one would be.
 */
function toStageDependency(raw: string | null | undefined): StageDependency {
	return raw === "on_project_start" ? "parallel" : "sequential";
}

/**
 * The column value a dependency choice writes back.
 *
 * The inverse of {@link toStageDependency}, and deliberately NOT a total inverse: the column has four
 * members and the form asks about one distinction, so `sequential` writes `dependent_on_stage` — the
 * member that means "waits for the stage before it". It cannot round-trip a `fixed_date` or an
 * `on_hire_confirmed` stage, which is why the write below only ever sends this when the form actually
 * carried a dependency, rather than restating a value the owner never touched.
 */
function fromStageDependency(dependency: StageDependency): string {
	return dependency === "parallel" ? "on_project_start" : "dependent_on_stage";
}

/**
 * Project a stage row onto the setup form's stage shape.
 *
 * `roles` arrives pre-grouped rather than being looked up here, because `stage_staffing_roles` is one
 * read for the whole project and a per-stage query would be N round trips for a form that renders
 * them all at once.
 */
function toStageSetup(row: SetupStageRow, roles: readonly StaffingRoleRow[]): StageSetup {
	// The seat pair is normalised through the SSOT rather than read field-by-field, so a row that
	// somehow carries `unlimited` WITH a count — which the bidirectional CHECK forbids but an
	// unmigrated database has no CHECK to forbid — is reported the way the form would store it.
	const seats = normaliseSeats(
		row.capacity === "limited" ? "limited" : "unlimited",
		row.seat_count ?? null,
	);
	return {
		id: row.id,
		name: clampOr(row.name, NAME_MAX, "Stage"),
		order: row.sort_order,
		description: richTextOf(row.description, row.description_text),
		unitPriceCents: row.unit_price_cents,
		milestone: clamp(row.milestone ?? "", MILESTONE_MAX),
		skills: (row.skills ?? []).map((skill) => clamp(skill, SKILL_LABEL_MAX).trim())
			.filter((s) => s.length > 0)
			.slice(0, MAX_STAGE_SKILLS),
		tasks: toStageTasks(row.default_tasks),
		dependency: toStageDependency(row.start_trigger_type),
		durationDays: row.file_duration_days ?? null,
		capacity: seats.capacity,
		seatCount: seats.seatCount,
		roles: roles.map(toStageStaffingRole),
		// Empty means ANY, which is the permissive answer and also what a database without the column
		// has to report — so the degraded read and the unconfigured stage agree, and neither silently
		// refuses a deliverable.
		allowedFileKinds: (row.allowed_file_kinds ?? []).map((kind) => clamp(kind, 32))
			.filter((kind) => kind.length > 0).slice(0, 20),
		// `null` INHERITS the project's term, and is also the honest answer on a row whose column does
		// not exist yet: "this stage says nothing" is true either way, where `false` would assert a
		// deliberate exemption nobody granted.
		ndaRequired: row.nda_required ?? null,
	};
}

/**
 * Bucket a flat staffing-role read by the stage each row hangs off.
 *
 * `stage_staffing_roles` is read once for a whole project — a per-stage query would be N round trips
 * for a form that renders every stage at once — so both the projection and the write below have to
 * group the same list the same way. One function, because two would be two answers to "which stage
 * owns this role" and the write would eventually disagree with the read it is reconciling against.
 */
function groupRolesByStage(
	roles: readonly StaffingRoleRow[],
): Map<string, StaffingRoleRow[]> {
	const byStage = new Map<string, StaffingRoleRow[]>();
	for (const role of roles) {
		const bucket = byStage.get(role.project_stage_id);
		if (bucket) bucket.push(role);
		else byStage.set(role.project_stage_id, [role]);
	}
	return byStage;
}

/**
 * Project a staffing-role row onto the STAGE's role shape.
 *
 * Distinct from {@link toRoleSetup} below, which reads the same table into the stage-LESS engagement's
 * role shape. The two differ in exactly the fields their surfaces need — a stage role carries how many
 * providers it takes, a Direct Deliverable's role carries the skills it asks for — which is why the
 * SSOT declares them separately rather than sharing one shape that is half-empty on both sides.
 */
function toStageStaffingRole(row: StaffingRoleRow): StageStaffingRole {
	return {
		id: row.id,
		name: clampOr(row.role_title, NAME_MAX, "Role"),
		// The column defaults to 1 and is NOT NULL, so the fallback only ever covers a read that did
		// not select it. One seat is the honest floor: a role nobody can fill is not a role.
		quantity: Math.min(Math.max(row.quantity ?? 1, 1), 99),
		budgetCents: row.budget_amount_cents,
	};
}

/** Project a staffing-role row onto the stage-less engagement's role shape. */
function toRoleSetup(row: StaffingRoleRow): ProjectRoleSetup {
	return {
		id: row.id,
		name: clampOr(row.role_title, NAME_MAX, "Role"),
		skills: (row.skills ?? []).map((skill) => clamp(skill, 60)).filter((s) => s.length > 0),
		budgetCents: row.budget_amount_cents,
	};
}

/**
 * The engagement rules, read straight off the columns they map 1:1 onto.
 *
 * The confidentiality triple is read as ONE answer, not three independent columns. `nda_required`
 * says whether an NDA governs at all, `nda_source` says which instrument, and `nda_document_id` is
 * meaningful only under `custom` — so the document is masked by the source here rather than reported
 * verbatim, and a projection can never name an instrument the engagement is not offered under.
 */
function toRules(row: SetupProjectRow): ProjectRules {
	return {
		// The INTENT column, not the live one. A missing value reads as the LIVE state rather than as
		// the column default: on a row written before this column existed, what the project is doing
		// today is the only evidence of what its owner asked for, and defaulting to `public` there
		// would hand a half-configured legacy draft an intent nobody ever stated.
		visibility: (row.publish_visibility ?? row.visibility) as ProjectRules["visibility"],
		ipOwnershipMode: row.ip_ownership_mode as ProjectRules["ipOwnershipMode"],
		ndaRequired: row.nda_required,
		// `platform` for anything that is not literally `custom`, including a missing column. Both the
		// SSOT and the column default agree that the platform's standard mutual NDA is what applies
		// when nobody has said otherwise — and reading an unknown value as `custom` would tell the
		// parties they are bound by a document the project does not have.
		ndaSource: row.nda_source === "custom" ? "custom" : "platform",
		// Only meaningful alongside `custom`, and the column's own CHECK is one-directional: `custom`
		// with no document is the legitimate "meant to upload, has not yet" state the form warns on.
		ndaDocumentId: row.nda_source === "custom" ? row.nda_document_id ?? null : null,
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
	attachments: readonly ProjectAttachment[],
	viewerId: string,
): ProjectSetup {
	const rolesByStage = groupRolesByStage(roles);
	return reconcileSetup({
		// The canonical address. Carried explicitly rather than left to `reconcileSetup`'s `?? ""`
		// fallback, which would produce a projection that fails its own schema's `min(1)` — and would
		// leave the Stage-2 surface with nothing stable to key its re-seed guard on.
		id: row.id,
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
		attachments: [...attachments],
		budget: {
			budgetType: row.budget_type as ProjectSetup["budget"]["budgetType"],
			amountCents: row.budget_amount_cents,
			currency: clampOr(row.currency, 8, "USD"),
		},
		rules: toRules(row),
		stages: [...stages]
			.sort((a, b) => a.sort_order - b.sort_order)
			.map((stage) => toStageSetup(stage, rolesByStage.get(stage.id) ?? [])),
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
		.select(STAFFING_ROLE_COLUMNS)
		.in("project_stage_id", stageIds);
	if (error) return [];
	return (data ?? []) as unknown as StaffingRoleRow[];
}

/**
 * The reference files hung off the project, named and sized from `files.items`.
 *
 * Two reads across two schemas, and both degrade to an empty list rather than throwing: an attachment
 * list is an annotation on a configuration, so a withheld join should cost a section and not the page
 * (the failure split this module's docblock states).
 *
 * A join row whose file did not come back is DROPPED. `files.items` has its own RLS, so an attachment
 * the viewer may not read is a real outcome — and a row rendered from the join alone would be an
 * unnamed, unsized entry that no reader can act on, which is worse than an absence.
 */
async function fetchProjectAttachments(
	actor: ReadActor & { accessToken: string },
	projectRowId: string,
): Promise<ProjectAttachment[]> {
	const { data, error } = await projectsDb(actor)
		.from("project_attachments")
		.select("attachment_id")
		.eq("project_id", projectRowId)
		.limit(MAX_PROJECT_ATTACHMENTS);
	if (error) return [];

	const ids = (data ?? [])
		.map((row) => (row as { attachment_id?: unknown }).attachment_id)
		.filter((id): id is string => typeof id === "string" && UUID_RE.test(id));
	if (ids.length === 0) return [];

	const files = await filesDb(actor).from("items").select(ATTACHMENT_FILE_COLUMNS).in("id", ids);
	if (files.error) return [];

	return ((files.data ?? []) as unknown as FileRow[]).map((file) => ({
		id: file.id,
		name: clampOr(file.display_name, 240, "Attachment"),
		// `null` is "the store has not reported one", which is what a missing column or a withheld
		// value means. Zero would claim an empty file.
		sizeBytes: typeof file.size_bytes === "number" ? file.size_bytes : null,
	}));
}

/**
 * The owner's configuration projection for one engagement, or `null` when it does not exist or is
 * not visible.
 *
 * THROWS only when the PRIMARY project read fails, with the table named, so the calling service can
 * log it and fall back to fixtures. Stages, roles and attachments degrade to empty lists instead: a
 * withheld join should cost a section, not the page.
 */
export async function fetchProjectSetup(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<ProjectSetup | null> {
	const row = await fetchSetupProject(actor, projectId);
	if (!row) return null;
	const stages = await fetchSetupStages(actor, row.id);
	// Sequential because the role read is keyed on the stage ids the previous read returned; the
	// attachment read is independent, so it runs alongside it rather than after it.
	const [roles, attachments] = await Promise.all([
		fetchStaffingRoles(actor, stages.map((s) => s.id)),
		fetchProjectAttachments(actor, row.id),
	]);
	return toSetup(row, stages, roles, attachments, actor.userId);
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

	// AN ACCOUNT WITH NO PROJECTIVE PROFILE is the one foreign-key failure on this path that is about
	// the CALLER rather than about the data, so it is answered before the generic constraint handling
	// below can bury it in "a fault on our side".
	//
	// `projects.projects.owner_user_id` references `org.users_public(user_id)`, and this module never
	// takes that column from a payload — it is always the session's own id. So this constraint has
	// exactly one cause: the signed-in identity has no profile row. That is a real, reachable state,
	// not a corrupt one: an OAuth sign-up is authenticated the moment Google returns and stays
	// profile-less until `/join` calls `complete_onboarding`, because GoTrue hands
	// `public.handle_new_user` neither a username nor a dob and both columns are NOT NULL.
	//
	// Matched on the CONSTRAINT NAME, not on "violates foreign key": the generic form also catches
	// `tickets_owner_user_id_fkey`, whose owner IS caller-supplied and whose cause is therefore a bad
	// id rather than a missing profile. Two causes reported as one sentence is how a reader is sent to
	// fix the wrong thing.
	//
	// 403 rather than 401: the credential is fine and refreshing it changes nothing, so `apiFetch`
	// must not spend a refresh on it. No field errors either — nothing they typed is wrong, and
	// pinning this to whichever column the writer happened to name would put "write blocked" under a
	// title that is perfectly good.
	if (message.includes("projects_owner_user_id_fkey")) {
		return {
			status: 403,
			message: "Finish setting up your account before creating a project — head to /join to " +
				"pick a username and confirm your date of birth.",
		};
	}

	// An EXPIRED OR UNVERIFIABLE TOKEN is a 401, and getting this wrong makes the session unable to
	// heal itself. PostgREST answers a stale bearer with `PGRST301` — "JWT expired", or "No suitable
	// key or wrong key type" — and supabase-js surfaces that as an ordinary error whose message
	// matches nothing above, so it used to fall through to the 502 below. That is the one status that
	// breaks the recovery path: `apiFetch` refreshes and retries on a 401 from our own routes and does
	// nothing at all on a 502, so an hour-old session got a permanent, unexplained failure on every
	// write while holding a refresh token that would have fixed it instantly.
	//
	// Passing the 401 through is what re-arms that interceptor. Nothing here is a decision about
	// ACCESS — RLS has not been consulted yet at this point — so it says only that the credential
	// needs renewing, in words a reader can act on.
	const stale = message.includes("JWT expired") ||
		message.includes("JWSError") ||
		message.includes("PGRST301") ||
		message.includes("No suitable key") ||
		message.includes("invalid claim") ||
		message.includes("jwt malformed");
	if (stale) {
		return {
			status: 401,
			message: "Your session expired. Sign in again to continue.",
			errors: field ? { [field]: "session_expired" } : undefined,
		};
	}

	// A message that reaches here is one this function does not recognise, and the caller is about to
	// be handed a generic sentence. LOG THE ORIGINAL. Without this the single fact that explains the
	// failure — a missing grant, a dropped column, a stale PostgREST schema cache, a violated
	// constraint — is discarded at the one point it was in hand, and all that survives is a 502 that
	// looks identical for every cause. Server-side only; the reader still gets nothing internal.
	console.error(
		`[projects.write] unmapped database failure${field ? ` on ${field}` : ""}: ${message}`,
	);

	// A schema or privilege fault is PERMANENT — retrying reproduces it exactly. The wording stays
	// generic either way, because these messages name internal tables, but the two must not make the
	// same promise about what happens next: this file already refuses to tell someone to repeat
	// something that can never succeed, and that reasoning does not stop at rule violations.
	const permanent = message.includes("permission denied") ||
		message.includes("does not exist") ||
		message.includes("schema cache") ||
		message.includes("violates not-null") ||
		message.includes("violates foreign key");
	if (permanent) {
		return {
			status: 500,
			message: "That could not be saved. This is a fault on our side, not something to retry.",
			errors: field ? { [field]: "write_blocked" } : undefined,
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
 * Build the `projects.projects` column patch from the validated payload.
 *
 * `visibility` is deliberately NOT here. It is the one rule whose stored value is a FUNCTION of the
 * project's completeness rather than of what the caller asked for, and the completeness is only
 * knowable once the stages and roles in this same payload have landed — so it is resolved after
 * them, by {@link resolveVisibility}, against the ladder the write actually produced.
 */
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
	if (input.budget?.currency !== undefined) {
		const currency = normalisedCurrency(input.budget.currency);
		if (currency) patch.currency = currency;
	}
	const rules = input.rules;
	// The INTENT column. `visibility` is deliberately absent from every patch this function builds:
	// it is server-derived by `liveVisibilityFor` and reconciled AFTER the status transition, so an
	// ordinary save cannot publish a draft and a refused transition cannot leave a public row behind
	// it.
	if (rules?.visibility !== undefined) patch.publish_visibility = rules.visibility;
	if (rules?.ipOwnershipMode !== undefined) patch.ip_ownership_mode = rules.ipOwnershipMode;
	if (rules?.ndaRequired !== undefined) patch.nda_required = rules.ndaRequired;
	// `ck_projects_nda_document` allows a document only alongside `custom`, so switching BACK to the
	// platform NDA must clear the reference in the same statement — two statements would leave a
	// window in which the row violates its own CHECK, and the first of them would simply abort.
	if (rules?.ndaSource !== undefined) {
		patch.nda_source = rules.ndaSource;
		if (rules.ndaSource === "platform") patch.nda_document_id = null;
	}
	// Only ever written alongside `custom`. A document sent with `platform` is a payload that
	// contradicts itself, and the honest answer is to keep the source the caller asked for rather than
	// to infer that they meant the other one.
	if (rules?.ndaDocumentId !== undefined) {
		const source = rules.ndaSource ?? (rules.ndaDocumentId === null ? null : "custom");
		if (source === "custom") {
			patch.nda_source = "custom";
			patch.nda_document_id = rules.ndaDocumentId;
		} else if (rules.ndaDocumentId === null) {
			patch.nda_document_id = null;
		}
	}
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
 * The Stage-2 per-stage terms, as a column patch.
 *
 * Every field is written only when the payload actually CARRIED it. A PATCH sends the section that
 * changed, so restating an absent field would overwrite a term the owner never touched — and for the
 * dependency in particular it would flatten a `fixed_date` or `on_hire_confirmed` stage onto one of
 * the two members this form knows about.
 *
 * The seat pair is the one exception to field-by-field independence: `ck_project_stages_seat_count`
 * is bidirectional, so writing `capacity` without `seat_count` aborts the statement. They are
 * normalised together through the SSOT's own {@link normaliseSeats} and sent as a pair or not at all,
 * which is also why a payload that carries only `seatCount` still resolves a capacity to send with it.
 *
 * Shared by the update and create branches deliberately: `projects.create_stage` is `SECURITY DEFINER`
 * and takes five arguments, none of them these, so a new stage's terms are a follow-up write. One
 * function for both branches is what stops a term from being savable on an existing stage and silently
 * dropped on a new one.
 */
export function stageTermsPatch(
	stage: NonNullable<UpdateProject["stages"]>[number],
): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	if (stage.tasks !== undefined) {
		patch.default_tasks = stage.tasks.map((task) => ({ id: task.id, text: task.text }));
	}
	if (stage.dependency !== undefined) {
		patch.start_trigger_type = fromStageDependency(stage.dependency);
	}
	if (stage.durationDays !== undefined) patch.file_duration_days = stage.durationDays;
	if (stage.allowedFileKinds !== undefined) patch.allowed_file_kinds = stage.allowedFileKinds;
	if (stage.ndaRequired !== undefined) patch.nda_required = stage.ndaRequired;
	// Clamped per entry and emptied of blanks, matching what `toStage` reads back — a `Chips` control
	// yields whatever was typed, and a skill that is whitespace is a row nobody can match against.
	if (stage.skills !== undefined) {
		patch.skills = stage.skills
			.map((skill) => clamp(skill, SKILL_LABEL_MAX).trim())
			.filter((skill) => skill.length > 0);
	}
	// `NOT NULL DEFAULT ''` on the column, so an emptied field is the empty string rather than null:
	// writing null aborts the statement, and the read already treats `''` as "no milestone named".
	if (stage.milestone !== undefined) {
		patch.milestone = clamp(stage.milestone ?? "", MILESTONE_MAX);
	}
	if (stage.capacity !== undefined || stage.seatCount !== undefined) {
		const seats = normaliseSeats(
			stage.capacity ?? (stage.seatCount === null ? "unlimited" : "limited"),
			stage.seatCount ?? null,
		);
		patch.capacity = seats.capacity;
		patch.seat_count = seats.seatCount;
	}
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
	// ONE read for every stored role on the project, grouped once, rather than a read per stage: the
	// per-stage reconciliation below needs the ids that are CURRENTLY stored, and a query inside the
	// loop would be N round trips on a form that submits its whole stage list at a time. Skipped
	// outright when no stage in the payload carries a role list, because then nothing consults it.
	const rolesByStage = stages.some((stage) => stage.roles !== undefined)
		? groupRolesByStage(await fetchStaffingRoles(actor, existing.map((row) => row.id)))
		: new Map<string, StaffingRoleRow[]>();
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
			Object.assign(patch, stageTermsPatch(stage));
			const { data: touched, error } = await db
				.from("project_stages")
				.update(patch)
				.eq("id", stage.id)
				.select("id");
			if (error) return refusalFrom(error.message, "stages");
			if (!touched || touched.length === 0) return notWritten("stages");
			// After the stage's own columns, so a save that the stage write was going to refuse cannot
			// leave its roles rewritten behind it.
			if (stage.roles !== undefined) {
				const refusal = await reconcileStageRoles(
					db,
					stage.id,
					stage.roles,
					rolesByStage.get(stage.id) ?? [],
				);
				if (refusal) return refusal;
			}
			keep.add(stage.id);
			ordered.push(stage.id);
			continue;
		}

		// `create_stage` provisions the stage's room in the same transaction. That is not a
		// convenience: a stage with no channel is omitted from the channel tree, so a stage inserted
		// directly would be invisible in the sidebar that is supposed to show it.
		//
		// Its optional `p_payload` is deliberately not used: that argument reads the stage's OLD column
		// vocabulary (`seat_limit`, `allowed_file_categories`, `nda_override`), and the setup form now
		// speaks the renamed one — a patch sent through it would be silently ignored and the save would
		// look like it had landed. The terms follow as their own statement instead.
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
		const extras: Record<string, unknown> = { ...stageTermsPatch(stage) };
		if (stage.skills?.length) extras.skills = stage.skills;
		if (stage.milestone) extras.milestone = clamp(stage.milestone, 240);
		if (Object.keys(extras).length > 0) {
			const { error: extraError } = await db
				.from("project_stages")
				.update(extras)
				.eq("id", newId);
			if (extraError) return refusalFrom(extraError.message, "stages");
		}
		// Only now, and this is the whole reason the call sits inside the loop rather than after it: a
		// role is keyed to `project_stage_id`, so it has nowhere to point until `create_stage` has
		// returned the id it will hang off. A stage minted in this pass has no stored roles, so the plan
		// is resolved against an empty set rather than against a read that can only come back empty.
		if (stage.roles !== undefined) {
			const refusal = await reconcileStageRoles(db, newId, stage.roles, []);
			if (refusal) return refusal;
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

// #region Stage staffing roles
/**
 * What a stage's role list asks for, resolved WITHOUT touching the database.
 *
 * Separated from the write because the RULE is the only half of a reconciliation that can be
 * asserted. Everything in {@link reconcileStageRoles} below is RLS-scoped PostgREST I/O, which this
 * repository cannot exercise (root CLAUDE.md §8 Decision #67(a) — no Docker, no psql), so the part
 * that decides create-versus-update-versus-remove is pinned by unit test and the statements are
 * reviewed at the site that issues them.
 */
export interface StageRolePlan {
	/** Roles with no stored row behind them — an INSERT each. */
	create: StageStaffingRole[];
	/** Roles whose id already names a row — an UPDATE each. */
	update: StageStaffingRole[];
	/** Stored ids the payload no longer names — a DELETE each. */
	remove: string[];
}

/**
 * Resolve a stage's submitted role list against what is stored.
 *
 * The same three-way rule {@link UpdateProjectSchema} documents and {@link reconcileStages} already
 * applies to stages: an id that is absent, `role-draft-` prefixed, or not a uuid is a CREATE; a real
 * id is an UPDATE; a stored id the payload does not name is a REMOVE.
 *
 * A uuid-shaped id that names nothing is deliberately still an UPDATE rather than being re-classified
 * as a create. It affects zero rows and is reported through {@link notWritten}, which refuses the
 * save — where treating it as a create would answer a stale client by silently duplicating the role
 * it thought it was editing, and a duplicate role is a second seat somebody can be hired into.
 *
 * A repeated id inside one payload is folded to a single update: the client has one editor per row,
 * so two entries claiming one id is a client fault, and issuing both statements would race them.
 */
export function planStageRoles(
	existingIds: readonly string[],
	roles: readonly StageStaffingRole[],
): StageRolePlan {
	const plan: StageRolePlan = { create: [], update: [], remove: [] };
	const named = new Set<string>();
	for (const role of roles) {
		if (!isExistingId(role.id, DRAFT_ROLE_PREFIX)) {
			plan.create.push(role);
			continue;
		}
		if (named.has(role.id)) continue;
		named.add(role.id);
		plan.update.push(role);
	}
	for (const id of existingIds) {
		if (!named.has(id) && !plan.remove.includes(id)) plan.remove.push(id);
	}
	return plan;
}

/**
 * The refusal an unpriced role earns, for the STAGE-scoped table.
 *
 * `stage_staffing_roles.budget_amount_cents` is `bigint NOT NULL CHECK (>= 0)` while
 * {@link StageStaffingRoleSchema} declares `budgetCents` nullable and documents `null` as UNPRICED.
 * A deliberately unpriced role is therefore not expressible in the column at all, and the two ways to
 * make it fit are both dishonest: writing `0` collapses "nobody has priced this yet" onto "this role
 * is free", which is the exact distinction the nullable field exists to hold and which the setup
 * ladder counts — a defaulted zero would satisfy the pricing step with a number nobody typed. Dropping
 * the role instead would answer "Saved" over a seat that is not there.
 *
 * So it is refused, in the same words and with the same status {@link reconcileRoles} already uses for
 * the identical column on a Direct Deliverable's roles. Relaxing the column is the real fix and it is
 * a schema decision this layer may not take.
 */
function unpricedStageRole(): WriteRefusal {
	return {
		status: 422,
		message: "Give every stage role a budget.",
		errors: { stages: "role_budget_required" },
	};
}

/**
 * Write one stage's staffing roles.
 *
 * Takes the client rather than an actor because its caller has already built one, and takes `existing`
 * rather than reading it because {@link reconcileStages} fetches every stage's roles in a single
 * request — a read here would be one round trip per stage on a form that submits all of them.
 *
 * There is no `replace` flag, and its absence is deliberate. The flag exists on stages and on the
 * project's roles because an omitted entry there might mean "unchanged", and a stage deleted by
 * mistake releases escrow. Here the payload's shape settles it: `StageSetup.roles` is a whole array
 * or nothing at all, so a stage that carries the key is stating its complete list, and a stage that
 * omits it is skipped by the caller before this function is reached. Nothing else in the schema
 * references `stage_staffing_roles` — no foreign key, no function, no trigger — so removing one
 * strands no assignment and moves no money.
 */
async function reconcileStageRoles(
	db: SupabaseClient,
	stageId: string,
	roles: readonly StageStaffingRole[],
	existing: readonly StaffingRoleRow[],
): Promise<WriteRefusal | null> {
	const plan = planStageRoles(existing.map((row) => row.id), roles);

	for (const role of plan.update) {
		// Re-checked here as well as in {@link validateUpdate}, rather than trusting the pre-check and
		// falling back to `?? 0`. The pre-check exists to stop a half-commit, not to be the rule; a
		// caller that reaches this function by another route must still be refused rather than quietly
		// storing an unpriced role as a free one.
		if (role.budgetCents === null || role.budgetCents === undefined) return unpricedStageRole();
		const { data: touched, error } = await db
			.from("stage_staffing_roles")
			.update({
				role_title: clampOr(role.name, NAME_MAX, "Role"),
				quantity: Math.min(Math.max(role.quantity, 1), 99),
				budget_amount_cents: role.budgetCents,
			})
			.eq("id", role.id)
			.select("id");
		if (error) return refusalFrom(error.message, "stages");
		// The {@link notWritten} case: an UPDATE the policy filters out affects zero rows and raises
		// nothing, so without reading the ids back a stranger's write reports "Saved".
		if (!touched || touched.length === 0) return notWritten("stages");
	}

	for (const role of plan.create) {
		if (role.budgetCents === null || role.budgetCents === undefined) return unpricedStageRole();
		const { data, error } = await db
			.from("stage_staffing_roles")
			.insert({
				project_stage_id: stageId,
				role_title: clampOr(role.name, NAME_MAX, "Role"),
				quantity: Math.min(Math.max(role.quantity, 1), 99),
				budget_amount_cents: role.budgetCents,
			})
			.select("id")
			.maybeSingle();
		if (error) return refusalFrom(error.message, "stages");
		if (!data) return notWritten("stages");
	}

	for (const id of plan.remove) {
		const { error } = await db.from("stage_staffing_roles").delete().eq("id", id);
		if (error) return refusalFrom(error.message, "stages");
	}
	return null;
}
// #endregion

// #region Project attachments
/** Which links a desired attachment set adds and which it drops. */
export interface AttachmentPlan {
	/** `files.items` ids with no link row yet. */
	attach: string[];
	/** Linked ids the desired set no longer names. */
	detach: string[];
}

/**
 * Resolve the submitted attachment list against the links that are stored.
 *
 * A set difference rather than the three-way create/update/remove the stages use, because
 * `project_attachments` has no updatable column: every column is part of its primary key, so
 * re-pointing a link is a delete and an insert. That is also why its policies are split into INSERT
 * and DELETE rather than written `FOR ALL`.
 *
 * A repeated id folds to ONE link. The primary key is `(project_id, attachment_id)`, so sending the
 * same file twice is not two attachments — it is one row and a duplicate-key error on the insert that
 * would abort a save the owner has no way to correct from the form.
 */
export function planAttachments(
	existingIds: readonly string[],
	desired: readonly ProjectAttachment[],
): AttachmentPlan {
	const stored = new Set(existingIds);
	const want = new Set<string>();
	const attach: string[] = [];
	for (const attachment of desired) {
		if (want.has(attachment.id)) continue;
		want.add(attachment.id);
		if (!stored.has(attachment.id)) attach.push(attachment.id);
	}
	const detach: string[] = [];
	for (const id of stored) {
		if (!want.has(id)) detach.push(id);
	}
	return { attach, detach };
}

/**
 * Reconcile the project's reference files.
 *
 * ## Detaching removes the ASSOCIATION and never the asset
 *
 * Nothing here touches `files.items`. An attachment is carried BY REFERENCE
 * ({@link ProjectAttachmentSchema}): the row is one asset with one owner and one privacy scope, and a
 * project attachment is a SECOND surface onto it — the same file may simultaneously be a submission
 * deliverable, a message attachment and a profile banner. Deleting the asset because one project
 * stopped citing it would remove it from every other surface that still does, and from the owner's
 * own library. So this deletes the join row and stops, which is the same reasoning the
 * "Owner detaches project references" policy is written with, and it is why detaching is not the hard
 * deletion root CLAUDE.md §5 forbids.
 *
 * ## The incoming list is the DESIRED SET, on both verbs
 *
 * There is no `replace` flag here for the reason {@link reconcileStageRoles} has none: `attachments`
 * is a whole array or an absent key, so a payload that carries it is stating the complete list. The
 * flag guards `reconcileStages` because deleting a stage releases escrow and an omitted stage might
 * only mean "unchanged"; neither is true of a link row that owns nothing.
 */
async function reconcileAttachments(
	db: SupabaseClient,
	projectRowId: string,
	attachments: readonly ProjectAttachment[],
): Promise<WriteRefusal | null> {
	// Deliberately UNLIMITED, where the read projection caps at {@link MAX_PROJECT_ATTACHMENTS}. That
	// cap is a display rule; a limited read here would leave any row past the tenth invisible to the
	// difference below and therefore permanently attached.
	const { data, error } = await db
		.from("project_attachments")
		.select("attachment_id")
		.eq("project_id", projectRowId);
	if (error) return refusalFrom(error.message, "attachments");

	const existingIds = (data ?? [])
		.map((row) => (row as { attachment_id?: unknown }).attachment_id)
		.filter((id): id is string => typeof id === "string");
	const plan = planAttachments(existingIds, attachments);

	if (plan.attach.length > 0) {
		const { data: inserted, error: insertError } = await db
			.from("project_attachments")
			.insert(plan.attach.map((id) => ({ project_id: projectRowId, attachment_id: id })))
			.select("attachment_id");
		if (insertError) return refusalFrom(insertError.message, "attachments");
		// An INSERT the policy refuses RAISES rather than returning nothing, so this is the narrower
		// case: a partially applied batch, which would otherwise report "Saved" over a file that is not
		// attached.
		if (!inserted || inserted.length < plan.attach.length) return notWritten("attachments");
	}

	if (plan.detach.length > 0) {
		const { data: removed, error: deleteError } = await db
			.from("project_attachments")
			.delete()
			.eq("project_id", projectRowId)
			.in("attachment_id", plan.detach)
			.select("attachment_id");
		if (deleteError) return refusalFrom(deleteError.message, "attachments");
		// The {@link notWritten} case again, and load-bearing here: a DELETE the policy filters out
		// removes zero rows and raises nothing, so a caller who may read the project but not edit it
		// would be told the file was detached while it is still on the brief the work is judged against.
		if (!removed || removed.length < plan.detach.length) return notWritten("attachments");
	}
	return null;
}
// #endregion

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
	// The same column, on the stage-scoped table. Hoisted here rather than left to the reconciler for
	// the reason above: the stage loop runs after the project columns have already committed, so a
	// role the write was always going to refuse would otherwise leave the owner's title edit stored
	// under a 422 that told them nothing had been saved.
	for (const stage of input.stages ?? []) {
		if (
			stage.roles?.some((role) => role.budgetCents === null || role.budgetCents === undefined)
		) {
			return unpricedStageRole();
		}
	}
	// `project_attachments.attachment_id` is `uuid`, and PostgREST CASTS the operand rather than
	// missing: a non-uuid id raises `22P02` in the middle of a save. It is refused instead of being
	// filtered out, because dropping it silently would report "Saved" over a file the owner can see
	// listed in the form and that is not attached to anything.
	if (input.attachments?.some((attachment) => !UUID_RE.test(attachment.id))) {
		return {
			status: 422,
			message: "One of those attachments is not a stored file.",
			errors: { attachments: "unknown_file" },
		};
	}
	return null;
}

/** The outcome of a write: the new projection, a refusal, or `null` for "no such project". */
export type WriteOutcome<T> = { data: T } | { refusal: WriteRefusal } | null;

// #region Project create
/**
 * The name the auto-provisioned root stage takes, per format.
 *
 * A pipeline is numbered because more stages follow it; a one-off is named for what it IS, because
 * "Stage 1" on an engagement that will only ever have one stage describes a sequence that does not
 * exist. Neither is a placeholder the owner has to clear: both are the honest first entry on a stage
 * list, and the Stage-2 surface renames them in place.
 */
const ROOT_STAGE_NAME: Record<ProjectCreateFormat, string> = {
	one_off: "Delivery",
	pipeline: "Stage 1",
};

/**
 * Mint the draft and its one root stage.
 *
 * ## Why this does NOT call `projects.create_project`
 *
 * The RPC exists and is unusable for this flow, in four independent ways. It reads the row id out of
 * its own payload with no fallback, so `gen_random_uuid()` never fires and the insert has no id. It
 * defaults `visibility` to PUBLIC, which would put a project nobody has configured onto Explore — the
 * exact default `DEFAULT_PROJECT_RULES` refuses to take. It supplies neither `slug`, `status` nor the
 * budget pair, so the row lands on the opaque `p-xxxx…` fallback address with no price. And its
 * nested stage insert carries neither `unit_price_cents` nor `milestone`, so the one figure the modal
 * collected would be discarded on the way in.
 *
 * A direct insert through the RLS-scoped client is what the sibling writes in this module already do,
 * and RLS permits it: `"Users can create projects"` is `WITH CHECK (auth.uid() = owner_user_id)`.
 *
 * ## There is no transaction across the two statements
 *
 * PostgREST gives one statement per request (module docblock), so the stage insert is a second
 * commit and can fail after the project row has landed. It is NOT compensated by deleting the
 * project: a delete is a destructive statement issued in response to a failure whose cause is
 * unknown, and if THAT fails the owner is left with a row nobody told them about. Instead the create
 * SUCCEEDS with the project, because the project is the thing the client is about to navigate to and
 * a stage-less draft is a legitimate, editable state the Stage-2 surface already renders — its stage
 * list is simply empty, and the setup ladder already exists to say so. The stage is a convenience,
 * not a correctness requirement, and it can be added by the one control that adds stages.
 */
export async function insertProject(
	actor: ReadActor & { accessToken: string },
	input: CreateProject,
	slug: string,
): Promise<WriteOutcome<CreatedProject>> {
	const db = projectsDb(actor);
	const title = clamp(input.title.trim(), TITLE_MAX);

	const { data, error } = await db
		.from("projects")
		.insert({
			owner_user_id: actor.userId,
			title,
			slug,
			// The identity map. `ProjectCreateFormat` was narrowed to the two members `project_format`
			// also carries, so there is no bridge here to go stale.
			format: input.format,
			currency: input.currency,
			// A draft that nobody can discover, deliberately: the cost of getting this default wrong is
			// a half-written engagement on Explore, and the Rules section is where an owner opens it up.
			//
			// The pair is the two-column model in miniature. `visibility` is derived — and derived by
			// the same function the update path promotes with, so the state a project is minted in and
			// the state it is later reconciled to cannot come from two different rules. The INTENT is
			// `public`, which is what somebody creating a project to hire against is asking for, and it
			// is safe to default precisely because it is not yet in effect.
			status: "draft",
			visibility: liveVisibilityFor("draft", CREATED_PUBLISH_VISIBILITY),
			publish_visibility: CREATED_PUBLISH_VISIBILITY,
			budget_type: "fixed_price",
			// The project-level budget is the ONE-OFF's whole escrow figure. A pipeline's baseline is a
			// per-ticket RATE, which belongs on the stage below and would read as a project total here —
			// so it is deliberately left null rather than copied into a column that means something else.
			budget_amount_cents: input.format === "one_off" ? input.baselineAmountCents : null,
		})
		.select("id, slug")
		.maybeSingle();

	if (error) return { refusal: refusalFrom(error.message, "title") };
	// Under RLS an insert the policy refuses returns no row rather than raising, so the absence IS the
	// refusal — reporting success here would tell the client to navigate to a project that never
	// existed (the `notWritten` reasoning, on the one statement that has no id to select back).
	if (!data) return { refusal: notWritten("title") };

	const created = data as unknown as { id: string; slug: string };

	// Through `create_stage` rather than a direct insert, because it provisions the stage's channel in
	// the same transaction. A stage with no room is omitted from the channel tree, so a directly
	// inserted one would be invisible in the sidebar that exists to show it.
	const { error: stageError } = await db.rpc("create_stage", {
		p_project_id: created.id,
		p_name: ROOT_STAGE_NAME[input.format],
		p_description: { html: "" },
		p_description_text: "",
		p_unit_price_cents: input.baselineAmountCents,
	});
	if (stageError) {
		// Warned, not raised — see the docblock. The owner gets their project; the stage list is the one
		// thing they arrive able to fix.
		console.warn(
			`[insertProject] project ${created.id} created without its root stage: ${stageError.message}`,
		);
	}

	return { data: { id: created.id, slug: created.slug } };
}
// #endregion

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
	const invalid = validateUpdate(input);
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

	// AFTER the transition, deliberately, and this ordering is the whole safety property.
	//
	// `projectColumnPatch` never writes `visibility` — it writes the INTENT. Promoting the intent to
	// the live column has to happen after `set_project_status` has actually succeeded, because that
	// function owns whether a transition is legal at all: folding the promotion into the earlier
	// column patch would publish the row first and then discover the transition was refused, leaving a
	// public project that is still a draft and that nothing later corrects.
	//
	// It runs on every save, not only on a transition, so an ALREADY-live project's visibility change
	// takes effect immediately — a project that is published is past the moment intent and state were
	// separate facts, and making its owner perform a status change to hide it would be absurd. On a
	// draft the same call is a no-op that re-asserts `unlisted`, which is also the repair path for any
	// row whose two columns have fallen out of step.
	const effectiveStatus = (input.status ?? row.status) as ProjectStatus;
	const effectiveIntent = (input.rules?.visibility ??
		row.publish_visibility ?? row.visibility) as ProjectRules["visibility"];
	const live = liveVisibilityFor(effectiveStatus, effectiveIntent);
	if (live !== row.visibility) {
		// No `.select()` guard here, unlike every other write in this function. The caller has already
		// proven write access through the column patch or the status RPC above, and a zero-row result
		// means the live column was concurrently set to the value we were going to set — which is the
		// outcome we wanted. Refusing on it would fail a save that had in fact converged.
		const { error } = await db
			.from("projects")
			.update({ visibility: live })
			.eq("id", row.id);
		if (error) return { refusal: refusalFrom(error.message, "rules") };
	}

	// Before the stages, deliberately. Two join-table statements own nothing and undo cleanly, where
	// the stage reconciliation provisions channels and can release escrow on a delete — so the part of
	// a save that cannot be taken back runs last, and a refusal there leaves less behind it.
	if (input.attachments) {
		const refusal = await reconcileAttachments(db, row.id, input.attachments);
		if (refusal) return { refusal };
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
