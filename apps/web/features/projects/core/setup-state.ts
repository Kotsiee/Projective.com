import { computed, type ReadonlySignal, signal } from "@preact/signals";
import {
	type ProjectSetup,
	type ProjectSetupPatch,
	reconcileSetup,
	STAGE_ITEM_LABEL,
	type UpdateProject,
} from "../types/projects-types.ts";
import { ProjectSidebarService } from "./ProjectSidebarService.ts";

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

/** Which slug the store currently holds, so a second island's seed cannot overwrite live edits. */
let seededSlug: string | null = null;

/**
 * The data fields, serialised in a fixed key order.
 *
 * `JSON.stringify` over the draft itself would fold in `steps`/`completeness`/`previewReady`, which
 * are derived — so a change that leaves the ladder alone and a change that moves it would compare
 * differently for the wrong reason. Order is fixed by construction rather than by object literal
 * order, because two objects carrying the same values in a different insertion order are the same
 * configuration and must produce the same fingerprint.
 */
function fingerprint(setup: ProjectSetup): string {
	return JSON.stringify([
		setup.title,
		setup.format,
		setup.structure,
		setup.sessionKind,
		setup.description,
		[setup.budget.budgetType, setup.budget.amountCents, setup.budget.currency],
		[
			setup.rules.visibility,
			setup.rules.ipOwnershipMode,
			setup.rules.ndaRequired,
			setup.rules.portfolioDisplayRights,
			setup.rules.timelinePreset,
			setup.rules.allowDeadlineBonuses,
			setup.rules.locationRestriction,
			setup.rules.languageRequirement,
		],
		setup.stages.map((s) => [
			s.id,
			s.name,
			s.description,
			s.unitPriceCents,
			s.milestone,
			s.skills,
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
 * Idempotent per slug: the header, the body and the footer all hold the same SSR copy and all mount
 * independently, so a second seed of the same engagement must not discard whichever island got there
 * first and the edits made since.
 */
export function seedSetup(setup: ProjectSetup): void {
	if (seededSlug === setup.slug) return;
	seededSlug = setup.slug;
	setupDraft.value = setup;
	setupBaseline.value = setup;
	setupError.value = null;
	setupNotice.value = null;
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
}

/** Clear every signal (the body island calls this on unmount). */
export function resetSetupState(): void {
	seededSlug = null;
	setupDraft.value = null;
	setupBaseline.value = null;
	setupSaving.value = false;
	setupError.value = null;
	setupNotice.value = null;
}
// #endregion

// #region Persistence
/**
 * The first reason this draft cannot be persisted, in the owner's words, or `null`.
 *
 * These are the three places the wire schema is STRICTER than the working copy: `title`, a stage
 * `name` and a role `name` are all `min(1)`, so an emptied one would come back as a 422 naming a
 * field path rather than a section. Refusing here — rather than blanking the value or omitting the
 * key — keeps the emptied field on screen where the owner can see what they cleared.
 */
function firstBlocker(setup: ProjectSetup): string | null {
	if (setup.title.trim().length === 0) return "Give the project a name before saving.";
	if (setup.stages.some((s) => s.name.trim().length === 0)) {
		return `Every ${STAGE_ITEM_LABEL[setup.format]} needs a name.`;
	}
	if (setup.roles.some((r) => r.name.trim().length === 0)) return "Every team role needs a name.";
	return null;
}

/**
 * The whole form as a wire payload.
 *
 * A PATCH route that accepts a full body is deliberate (`UpdateProjectSchema` makes every field
 * optional so one schema serves both verbs): reconciling a stage list is an identity question the fat
 * service answers against the database, so a client-side diff of two arrays could only ever guess at
 * it. Positions are re-indexed from the rendered order, because the drag reordered the array and
 * `order` is what the server persists.
 */
function toPayload(setup: ProjectSetup): UpdateProject {
	return {
		title: setup.title,
		format: setup.format,
		structure: setup.structure,
		sessionKind: setup.sessionKind,
		description: setup.description,
		budget: setup.budget,
		rules: setup.rules,
		stages: setup.stages.map((stage, index) => ({ ...stage, order: index })),
		roles: setup.roles,
	};
}

/** Send a payload, adopt the server's re-derived setup, and report in one place. */
async function commit(slug: string, payload: UpdateProject, notice: string): Promise<boolean> {
	setupSaving.value = true;
	setupError.value = null;
	const res = await ProjectSidebarService.update(slug, payload);
	setupSaving.value = false;
	if (!res.ok || !res.data) {
		setupError.value = res.message ?? "That did not save — please try again.";
		return false;
	}
	setupDraft.value = res.data.setup;
	setupBaseline.value = res.data.setup;
	setupNotice.value = notice;
	return true;
}

/** Persist the draft. Resolves `true` when the server acknowledged it. */
export async function saveSetup(): Promise<boolean> {
	const draft = setupDraft.value;
	if (!draft || setupSaving.value) return false;
	const blocker = firstBlocker(draft);
	if (blocker) {
		setupError.value = blocker;
		return false;
	}
	return await commit(draft.slug, toPayload(draft), "Saved.");
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
	if (!draft.previewReady) {
		setupError.value = "Finish the required steps before publishing.";
		return false;
	}
	const blocker = firstBlocker(draft);
	if (blocker) {
		setupError.value = blocker;
		return false;
	}
	return await commit(draft.slug, { ...toPayload(draft), status: "active" }, "Published.");
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
	setupSaving.value = true;
	setupError.value = null;
	const res = await ProjectSidebarService.archive(draft.slug);
	setupSaving.value = false;
	if (!res.ok) {
		setupError.value = res.message ?? "That did not archive — please try again.";
		return false;
	}
	globalThis.location.href = "/projects";
	return true;
}
// #endregion
