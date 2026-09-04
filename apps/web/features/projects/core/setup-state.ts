import { computed, type ReadonlySignal, signal } from "@preact/signals";
import {
	type ProjectRules,
	type ProjectSetup,
	type ProjectSetupPatch,
	reconcileSetup,
	STAGE_ITEM_LABEL,
	type UpdateProject,
} from "../types/projects-types.ts";
import { ProjectSidebarService } from "./ProjectSidebarService.ts";
import { resetFieldValidation } from "./setup-validation.ts";

/**
 * Setup view-state — the cross-island bridge for the owner's Details surface on
 * `/projects/[projectId]`, and the ONE place its client-side state machine lives.
 *
 * Three hydration roots read the same configuration: the middle-nav HEADER band (the progress bar and
 * the Details ⇄ Preview toggle), the BODY (the section form), and the middle-nav FOOTER band (Save ·
 * Discard · Publish · Archive). They are separate trees, so — exactly like the board's footer↔body
 * bridge — they coordinate through these module-level signals rather than through props.
 *
 * The mutations live HERE rather than in an island because an island is a dumb view (root CLAUDE.md
 * §2): it renders the draft and calls a named intent. That also settles which island owns Save, which
 * would otherwise be answered twice — the footer presses it, the body holds the draft.
 *
 * **`setupBaseline` is adopted from the SERVER's response, never from the SSR prop.** The dirty flag
 * is measured against it, so a successful save moves the baseline forward and the footer's Save ⁄
 * Discard pair disappears; comparing against an immutable prop instead leaves a form permanently
 * dirty after it has just been saved, which is a defect this codebase has shipped twice.
 *
 * The derived trio (`steps` · `completeness` · `previewReady`) is never computed here: every local
 * edit goes through {@link reconcileSetup}, the same function the fat service calls, so the bar the
 * owner watches while typing and the gate the server enforces on save are one implementation.
 */

// #region The working copy
/** The live, possibly-unsaved configuration. `null` until the body island seeds it on mount. */
export const setupDraft = signal<ProjectSetup | null>(null);

/** The last configuration the SERVER acknowledged — the only honest measure of "unchanged". */
export const setupBaseline = signal<ProjectSetup | null>(null);

/** A save/publish/archive is in flight; the rig blocks a second press against the same draft. */
export const setupSaving = signal<boolean>(false);

/** The last failure, in the words the surface shows. `null` = nothing to report. */
export const setupError = signal<string | null>(null);

/** The last success, in the words the surface shows. Cleared by the next edit. */
export const setupNotice = signal<string | null>(null);

/**
 * The form has demanded every field show its verdict — the submit-time reveal channel.
 *
 * It lives in the store rather than in the body island because the control that demands it is in the
 * FOOTER band, a different hydration root: a `useSignal` in the form could never be raised by the
 * press that needs it. Every validated field reads it through `useFieldValidation`'s `reveal`, so a
 * refused save paints the field that refused it even when the owner has never been near it — the one
 * moment an untouched field legitimately paints (DESIGN_SYSTEM §A.7.5).
 */
export const setupReveal = signal<boolean>(false);

/**
 * Which engagement the store currently holds, so a second island's seed cannot overwrite live edits.
 *
 * Keyed on the canonical uuid rather than the slug: a slug is derived from the title and moves on the
 * first rename, so a save that renames the project would make the next seed look like a different
 * engagement and discard everything typed since.
 */
let seededId: string | null = null;

/**
 * The data fields, serialised in a fixed key order.
 *
 * `JSON.stringify` over the draft itself would fold in `steps`/`completeness`/`previewReady`, which
 * are derived — so a change that leaves the ladder alone and a change that moves it would compare
 * differently for the wrong reason. Order is fixed by construction rather than by object literal
 * order, because two objects carrying the same values in a different insertion order are the same
 * configuration and must produce the same fingerprint.
 *
 * **THIS LIST IS HAND-MAINTAINED AND MUST BE EXTENDED WHENEVER `ProjectSetupSchema` GAINS A FIELD.**
 * TypeScript does not police it: a field left out still compiles, still edits correctly on screen and
 * simply never makes the form dirty — so Save never appears and the owner's work is lost on the next
 * navigation, with nothing anywhere reporting a problem. Its twin is {@link toPayload}, which fails
 * the same way one step later, and the two are always changed together.
 */
function fingerprint(setup: ProjectSetup): string {
	return JSON.stringify([
		setup.title,
		setup.format,
		setup.structure,
		setup.sessionKind,
		setup.description,
		setup.attachments.map((a) => [a.id, a.name, a.sizeBytes]),
		[setup.budget.budgetType, setup.budget.amountCents, setup.budget.currency],
		[
			setup.rules.visibility,
			setup.rules.ipOwnershipMode,
			setup.rules.ndaRequired,
			setup.rules.ndaSource,
			setup.rules.ndaDocumentId,
			setup.rules.portfolioDisplayRights,
			setup.rules.timelinePreset,
			setup.rules.allowDeadlineBonuses,
			setup.rules.locationRestriction,
			setup.rules.languageRequirement,
		],
		setup.stages.map((s) => [
			s.id,
			s.name,
			s.order,
			s.description,
			s.unitPriceCents,
			s.milestone,
			s.skills,
			s.tasks.map((t) => [t.id, t.text]),
			s.dependency,
			s.durationDays,
			s.capacity,
			s.seatCount,
			s.roles.map((r) => [r.id, r.name, r.quantity, r.budgetCents]),
			s.allowedFileKinds,
			s.ndaRequired,
		]),
		setup.roles.map((r) => [r.id, r.name, r.budgetCents, r.skills]),
	]);
}

/** Whether the draft carries edits the server has not acknowledged. */
export const setupDirty: ReadonlySignal<boolean> = computed(() => {
	const draft = setupDraft.value;
	const base = setupBaseline.value;
	if (!draft || !base) return false;
	return fingerprint(draft) !== fingerprint(base);
});

/** The configuration to render right now — the live draft, or the server's copy before hydration. */
export function currentSetup(fallback: ProjectSetup): ProjectSetup {
	return setupDraft.value ?? fallback;
}
// #endregion

// #region Seeding + local edits
/**
 * Adopt a server-resolved configuration as both the draft and the clean baseline.
 *
 * Idempotent per engagement: the header, the body and the footer all hold the same SSR copy and mount
 * independently, so a second seed of the same engagement must not discard whichever island got there
 * first and the edits made since.
 */
export function seedSetup(setup: ProjectSetup): void {
	if (seededId === setup.id) return;
	seededId = setup.id;
	setupDraft.value = setup;
	setupBaseline.value = setup;
	setupError.value = null;
	setupNotice.value = null;
	setupReveal.value = false;
}

/**
 * Fold a section's edit into the draft and re-derive the ladder.
 *
 * Every edit routes through {@link reconcileSetup}, so the header's percentage moves as the owner
 * types without any island computing a percentage of its own.
 */
export function patchSetup(patch: ProjectSetupPatch): void {
	const draft = setupDraft.value;
	if (!draft) return;
	setupDraft.value = reconcileSetup(draft, patch);
	setupNotice.value = null;
}

/** Throw away every unsaved edit and return to the server's copy. */
export function discardSetup(): void {
	const base = setupBaseline.value;
	if (!base) return;
	setupDraft.value = base;
	setupError.value = null;
	setupNotice.value = null;
	setupReveal.value = false;
}

/**
 * Clear every signal (the body island calls this on unmount).
 *
 * The touched set goes with it: its keys carry stage and role ids, so a second engagement opened in
 * the same session would otherwise inherit the first one's and mark a brand new stage's name as an
 * omission the moment it was added.
 */
export function resetSetupState(): void {
	seededId = null;
	setupDraft.value = null;
	setupBaseline.value = null;
	setupSaving.value = false;
	setupError.value = null;
	setupNotice.value = null;
	resetFieldValidation();
}
// #endregion

// #region Persistence
/**
 * The first reason this draft cannot be persisted, in the owner's words, or `null`.
 *
 * These are the places the wire schema is STRICTER than the working copy — `title`, a stage `name`, a
 * stage task's `text`, a stage role's `name` and a project role's `name` are all `min(1)` — so an
 * emptied one would come back as a 422 naming a field path rather than a section. Refusing here,
 * rather than blanking the value or omitting the key, keeps the emptied field on screen where the
 * owner can see what they cleared.
 *
 * A blank task and a blank stage role are reachable by design: both are added EMPTY, so an owner who
 * presses "Add step" and then Save without typing has produced exactly this state.
 */
function firstBlocker(setup: ProjectSetup): string | null {
	const item = STAGE_ITEM_LABEL[setup.format];
	if (setup.title.trim().length === 0) return "Give the project a name before saving.";
	if (setup.stages.some((s) => s.name.trim().length === 0)) return `Every ${item} needs a name.`;
	if (setup.stages.some((s) => s.tasks.some((t) => t.text.trim().length === 0))) {
		return `Every step on a ${item}'s task list needs some text — or remove the empty one.`;
	}
	if (setup.stages.some((s) => s.roles.some((r) => r.name.trim().length === 0))) {
		return `Every named role on a ${item} needs a name — or remove the empty one.`;
	}
	if (setup.roles.some((r) => r.name.trim().length === 0)) return "Every team role needs a name.";
	return null;
}

/**
 * The engagement terms, with the two pairs the database refuses to store inconsistently resolved.
 *
 * `nda_document_id` is permitted only alongside `nda_source = 'custom'` (`ck_projects_nda_document`),
 * while `allow_deadline_bonuses` is permitted only on a pipeline (`ck_projects_deadline_bonus_format`).
 * The form already normalises each of them at the moment the control changes; doing it again on the
 * way out is what makes it impossible for this client to post a body Postgres will answer with a
 * `23514` the owner cannot act on — a stored row that predates either constraint reaches the draft the
 * same way an edit does.
 */
function normalisedRules(setup: ProjectSetup): ProjectRules {
	const rules = setup.rules;
	return {
		...rules,
		ndaDocumentId: rules.ndaSource === "custom" ? rules.ndaDocumentId : null,
		allowDeadlineBonuses: setup.format === "pipeline" && rules.allowDeadlineBonuses,
	};
}

/**
 * The whole form as a wire payload.
 *
 * A PATCH route that accepts a full body is deliberate (`UpdateProjectSchema` makes every field
 * optional so one schema serves both verbs): reconciling a stage list is an identity question the fat
 * service answers against the database, so a client-side diff of two arrays could only ever guess at
 * it. Positions are re-indexed from the rendered order, because the drag reordered the array and
 * `order` is what the server persists.
 *
 * **THIS LIST IS HAND-MAINTAINED AND MUST BE EXTENDED WHENEVER `UpdateProjectSchema` GAINS A FIELD.**
 * A field left out compiles, edits correctly, marks the form dirty and then simply never reaches the
 * wire — so Save reports success and the edit is gone on the next load, which is the worst available
 * failure because the surface says the opposite of what happened. Its twin is {@link fingerprint};
 * the two are always changed together.
 *
 * `stages` and `roles` are spread WHOLE rather than field-by-field on purpose: every nested field the
 * form edits is already on the object, so a stage that grows a column is carried without this
 * function having to learn about it. The project-level keys are the ones that need adding by hand.
 */
function toPayload(setup: ProjectSetup): UpdateProject {
	return {
		title: setup.title,
		format: setup.format,
		structure: setup.structure,
		sessionKind: setup.sessionKind,
		description: setup.description,
		attachments: setup.attachments,
		budget: setup.budget,
		rules: normalisedRules(setup),
		stages: setup.stages.map((stage, index) => ({
			...stage,
			order: index,
			// A checklist row is an `{ id, text }` pair, not a bare string: the id is what lets a reorder
			// or a rename address the row it moved rather than the position it used to sit at. Only the
			// text is trimmed, and a row trimmed to nothing is dropped rather than sent — `min(1)` would
			// refuse the whole save with a field path instead of a sentence.
			tasks: stage.tasks
				.map((task) => ({ ...task, text: task.text.trim() }))
				.filter((task) => task.text.length > 0),
		})),
		roles: setup.roles,
	};
}

/**
 * Send a payload, adopt the server's re-derived setup, and report in one place.
 *
 * `projectRef` is the CANONICAL uuid rather than the slug. The write resolver accepts either, and the
 * uuid is the one that survives the write it is being used for: renaming the project regenerates its
 * slug, so a second save in the same session keyed on the slug the page loaded with would address a
 * row that no longer answers to it.
 */
async function commit(
	projectRef: string,
	payload: UpdateProject,
	notice: string,
): Promise<boolean> {
	setupSaving.value = true;
	setupError.value = null;
	const res = await ProjectSidebarService.update(projectRef, payload);
	setupSaving.value = false;
	if (!res.ok || !res.data) {
		setupError.value = res.message ?? "That did not save — please try again.";
		return false;
	}
	setupDraft.value = res.data.setup;
	setupBaseline.value = res.data.setup;
	setupNotice.value = notice;
	setupReveal.value = false;
	return true;
}

/** Persist the draft. Resolves `true` when the server acknowledged it. */
export async function saveSetup(): Promise<boolean> {
	const draft = setupDraft.value;
	if (!draft || setupSaving.value) return false;
	const blocker = firstBlocker(draft);
	if (blocker) {
		setupError.value = blocker;
		setupReveal.value = true;
		return false;
	}
	return await commit(draft.id, toPayload(draft), "Saved.");
}

/**
 * Publish the engagement.
 *
 * The status rides along with the whole form rather than going out as a bare `{ status }`: publishing
 * a draft that still holds unsaved edits would put the server's OLDER configuration in front of
 * freelancers, which is the one moment the difference matters.
 */
export async function publishSetup(): Promise<boolean> {
	const draft = setupDraft.value;
	if (!draft || setupSaving.value) return false;
	// Ordered so the more specific answer wins: "give the project a name" and "this project is
	// archived" both name the thing to do about it, where "finish the required steps" only says that
	// one of five is outstanding.
	const blocker = firstBlocker(draft);
	if (blocker) {
		setupError.value = blocker;
		setupReveal.value = true;
		return false;
	}
	if (!draft.previewReady) {
		setupError.value = "Finish the required steps before publishing.";
		setupReveal.value = true;
		return false;
	}
	return await commit(draft.id, { ...toPayload(draft), status: "active" }, "Published.");
}

/**
 * Archive the engagement — a soft archive, so the row and its history survive (root CLAUDE.md §5).
 *
 * On success the surface leaves for the feed rather than re-rendering: the page the owner is standing
 * on is the configuration of a project that is no longer in circulation, and every control on it
 * would now be editing something nobody can reach.
 */
export async function archiveSetup(): Promise<boolean> {
	const draft = setupDraft.value;
	if (!draft || setupSaving.value) return false;
	if (draft.archivedAt !== null) {
		setupError.value = "This project is already archived.";
		return false;
	}
	setupSaving.value = true;
	setupError.value = null;
	const res = await ProjectSidebarService.archive(draft.id);
	setupSaving.value = false;
	if (!res.ok) {
		setupError.value = res.message ?? "That did not archive — please try again.";
		return false;
	}
	globalThis.location.href = "/projects";
	return true;
}
// #endregion
