import {
	type BoardStageRef,
	DEFAULT_PROJECT_BUDGET,
	DEFAULT_PROJECT_RULES,
	type ProjectDetail,
	type ProjectFormat,
	type ProjectRoleSetup,
	type ProjectSessionKind,
	type ProjectSetup,
	type ProjectStructure,
	type ProjectSummary,
	reconcileSetup,
	type StageSetup,
} from "@projective/types/projects";
import { findProject } from "./query.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findBoardPage } from "./board-fixtures.ts";

/**
 * projects setup fixtures — the owner's editable configuration, derived from the existing corpus.
 *
 * The sibling of {@link ./overview-fixtures.ts}: the same slug resolved through the same three
 * builders, projected onto the other half of `/projects/[projectId]`. A project's title, format and
 * status come from the feed row, its scope from the detail projection, and its stage list from the
 * BOARD — deliberately the board rather than the detail's channel tree, because the board is where a
 * stage's price and order already live, so the Details form and the Kanban column it configures are
 * two views of one list rather than two derivations that can disagree about what a stage costs.
 *
 * Nothing here is random. Every derived field is a pure function of the slug or of a corpus value, so
 * an SSR render and the client refetch that follows it produce the identical projection — the
 * hydration contract every fixture module in this package keeps.
 *
 * The ladder itself is NOT computed here. {@link reconcileSetup} owns it, and is called at the one
 * point this module returns, so the percentage the fixtures report and the percentage a live row
 * reports are computed by the same code (`live-writes.ts` calls it too).
 */

// #region Deterministic helpers
/**
 * A stable 32-bit hash.
 *
 * `>>> 0` rather than `>> 0`: a signed shift leaves the high-bit case negative, and a negative
 * modulo indexes off the front of an array to `undefined` — the recurring defect this repository has
 * shipped more than once (root CLAUDE.md §8 Decisions #32/#48).
 */
function hash(value: string): number {
	let h = 2166136261;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Pick from a list by hash — total for any non-empty list, so a caller can never read a hole. */
function pick<T>(list: readonly T[], seed: string): T {
	return list[hash(seed) % list.length];
}
// #endregion

// #region Structure
/**
 * The finer shape within a format.
 *
 * A straight mapping with no inference. It would be easy to read "a one-off with no stages" as a
 * Direct Deliverable and set `single_task`, and it would be wrong: that also describes a one-off
 * whose owner has simply not added a stage yet, and the two answers put a DIFFERENT required step on
 * the ladder (`roles` instead of `stages`), so the guess would tell such an owner to go and staff
 * roles the form does not render for them.
 */
const STRUCTURE_FOR_FORMAT: Record<ProjectFormat, ProjectStructure> = {
	pipeline: "standard",
	one_off: "one_off",
	session: "single_stage",
};

/**
 * The engagements this corpus DECLARES to be Direct Deliverables.
 *
 * `ProjectSummary` carries no structure — it is a feed projection, and which sections a setup form
 * renders is not a feed concern — while `projects.projects.structure_variation` carries it on the live
 * path. Rather than widen the feed shape for one surface, the fixtures name the rows the same way the
 * profile corpus names its organisations: an explicit set, so the branch is reachable and reachable
 * for a stated reason.
 *
 * It matters that this is a declaration and not a derivation. `single_task` swaps the ladder's
 * required step from `stages` to `roles` and swaps the form's whole staffing section with it, so a
 * heuristic that guessed wrong would show an owner a section their engagement does not have and hold
 * their publish gate against it.
 */
const DIRECT_DELIVERABLE_SLUGS: ReadonlySet<string> = new Set(["monarch-launch-teardown"]);

/** The structure for a row: its format's shape, unless the corpus declares it a Direct Deliverable. */
function structureOf(slug: string, format: ProjectFormat): ProjectStructure {
	if (format === "one_off" && DIRECT_DELIVERABLE_SLUGS.has(slug)) return "single_task";
	return STRUCTURE_FOR_FORMAT[format];
}

/**
 * 1-1 versus group, for a session engagement.
 *
 * Read from a structural fact rather than seeded from the slug: a group session is the one that
 * organises its cohort into sub-groups, so the presence of team channels IS the distinction. A hash
 * would answer the same question with a coin toss, and the sidebar renders a genuinely different
 * panel on each branch (root CLAUDE.md §8 Decision #48).
 */
function sessionKindOf(format: ProjectFormat, detail: ProjectDetail): ProjectSessionKind {
	if (format !== "session") return "none";
	return detail.channels.teams.length > 0 ? "group" : "normal";
}
// #endregion

// #region Budget
/** The vocabulary a derived stage delivery note is drawn from. */
const MILESTONES = ["1 week", "2 weeks", "3 weeks", "10 working days", "1 month"] as const;

/** The vocabulary derived stage skills are drawn from. */
const SKILLS = [
	["Brand strategy", "Art direction"],
	["UI design", "Design systems"],
	["Copywriting", "Content design"],
	["Frontend", "Accessibility"],
	["Motion", "Illustration"],
	["Research", "Testing"],
] as const;

/**
 * Read a project budget out of the feed row's pre-formatted label.
 *
 * The label is the only budget the corpus carries, and it is display text, so this is deliberately
 * narrow. Two rules do the work:
 *
 * A label carrying a RATE suffix (`$320 / session`, `$6,000 / mo`) is not a project budget and
 * returns `null`. Writing a per-session rate into a fixed project total would report a £320 project
 * on the setup form and tick the pricing step off against a number nobody agreed to; the pricing
 * step is still satisfied honestly, by the stage prices that ARE totals.
 *
 * Anything that is not a plain `$` amount also returns `null`, rather than being coerced. `null`
 * means "not set", which is a true statement about a project whose budget this module cannot read,
 * where a zero would be a false one.
 */
function budgetFromLabel(label: string | null): number | null {
	if (!label) return null;
	const match = /^\$([\d,]+)$/.exec(label.trim());
	if (!match) return null;
	const amount = Number(match[1].replaceAll(",", ""));
	if (!Number.isFinite(amount)) return null;
	return Math.round(amount * 100);
}
// #endregion

// #region Stages and roles
/**
 * Project a board stage onto its setup row.
 *
 * `unitPriceCents` and `description` are carried across unchanged — they are the same columns the
 * board reads — while `milestone` and `skills` are derived, because the board projection has no
 * counterpart for either. Both are seeded on the stage ID, so a stage keeps its delivery note across
 * every render rather than acquiring a new one each time the page is drawn.
 */
function toStageSetup(stage: BoardStageRef): StageSetup {
	return {
		id: stage.id,
		name: stage.name,
		order: stage.order,
		description: stage.description,
		unitPriceCents: stage.unitPriceCents,
		milestone: pick(MILESTONES, `${stage.id}:milestone`),
		skills: [...pick(SKILLS, `${stage.id}:skills`)],
	};
}

/**
 * The stage list a setup form should show for a row.
 *
 * The board is the source, but not unconditionally, because the board answers a different question.
 * It exists to draw COLUMNS, so it derives a plausible pipeline for any project it is asked about;
 * the setup form has to report what the engagement actually has, and those two diverge in exactly the
 * two cases that matter most here:
 *
 *   • A **Direct Deliverable** takes no stages at all — roles are its staffing model — so carrying
 *     the board's columns across would put priced stages on an engagement whose form has no section
 *     to show them in, and quietly satisfy a pricing step against amounts nobody set.
 *   • A **draft with `totalStages: 0`** is a project nobody has structured yet. That empty state is
 *     the entire reason the setup ladder exists, and a form that opened it already showing stages and
 *     prices would be describing work its owner never did — and would report the ladder as nearly
 *     complete on a project that has not been started.
 *
 * The row's own `totalStages` is the corpus's statement about itself, so it is what decides.
 */
function stagesFor(
	structure: ProjectStructure,
	row: ProjectSummary,
	stages: readonly BoardStageRef[],
): StageSetup[] {
	if (structure === "single_task" || row.totalStages === 0) return [];
	return stages.map(toStageSetup);
}

/** The vocabulary a derived Direct Deliverable role name is drawn from. */
const ROLE_NAMES = [
	"Lead designer",
	"Art director",
	"Copywriter",
	"Frontend engineer",
	"Motion designer",
	"Researcher",
] as const;

/**
 * The staffing roles of a stage-less engagement.
 *
 * Empty for every structure but `single_task`, and that is not a placeholder: roles are the Direct
 * Deliverable's staffing model and a staged engagement genuinely has none, so returning a fabricated
 * one would put a section on the form that the engagement does not have and hold the ladder's staffing
 * step against invented rows.
 *
 * The roles a Direct Deliverable DOES get are derived from its own slug, so the same engagement
 * resolves the same team every time — the corpus has no roles table to read, and a shape that changed
 * between two reads of one project would make the form look like it had lost the owner's work.
 */
function rolesFor(structure: ProjectStructure, slug: string): ProjectRoleSetup[] {
	if (structure !== "single_task") return [];
	return SKILLS.slice(0, 2).map((skills, index) => ({
		id: `role-${slug}-${index + 1}`,
		name: ROLE_NAMES[(hash(slug) + index) % ROLE_NAMES.length],
		skills: [...skills],
		// Unpriced on purpose: a role budget is a decision the owner has not taken, and the pricing
		// ladder step must be able to read as outstanding on an engagement nobody has priced.
		budgetCents: null,
	}));
}
// #endregion

// #region Public builder
/**
 * Resolve the owner's editable configuration for a slug, or `null` when no such engagement (→ 404).
 *
 * The three sources are resolved once each and every derived field reads from them, so the form, the
 * progress bar and the board agree by construction. A slug with no board page still resolves: a
 * project whose stages have not been created yet is exactly the state the setup ladder exists to
 * describe, and refusing it would make the Details surface unreachable for a project that has only
 * just been drafted.
 */
export function findProjectSetup(slug: string): ProjectSetup | null {
	const row: ProjectSummary | undefined = findProject(slug);
	const detail = findProjectDetail(slug);
	if (!row || !detail) return null;

	const board = findBoardPage({ projectId: slug, view: "stages" });
	const structure = structureOf(row.slug, row.format);

	return reconcileSetup({
		slug: row.slug,
		title: row.title,
		format: row.format,
		structure,
		sessionKind: sessionKindOf(row.format, detail),
		status: row.status,
		description: detail.description,
		budget: {
			...DEFAULT_PROJECT_BUDGET,
			amountCents: budgetFromLabel(row.budgetLabel),
		},
		rules: {
			...DEFAULT_PROJECT_RULES,
			// A published engagement is one somebody could find, so its visibility is read from the
			// lifecycle rather than left at the create-time default — a live project rendering as
			// "invite only" would describe the wrong project back to its own owner.
			visibility: row.status === "draft" ? DEFAULT_PROJECT_RULES.visibility : "public",
		},
		stages: stagesFor(structure, row, board?.stages ?? []),
		roles: rolesFor(structure, row.slug),
		viewerIsClient: detail.viewerIsClient,
	});
}
// #endregion
