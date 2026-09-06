import { computed, type ReadonlySignal, signal } from "@preact/signals";
import {
	type ProjectRules,
	type ProjectSetup,
	type ProjectSetupPatch,
	reconcileSetup,
	STAGE_ITEM_LABEL,
	type UpdateProject,
} from "../types/projects-types.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { useToast } from "@projective/ui/feedback";
import { ProjectSidebarService } from "./ProjectSidebarService.ts";
import { resetFieldValidation } from "./setup-validation.ts";
// `readDevSeam` is the shipping-safe contract in `@web/utils`; `watchDevSeam` is the subscription
// half, which lives beside the projects feature's own seam consumers rather than in that module.
import { readDevSeam } from "@web/utils/dev-seam.ts";
import { watchDevSeam } from "./submission-access.ts";

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

/**
 * Save · publish · archive outcomes are reported as TOASTS, not as a banner in the form.
 *
 * The two `setupError`/`setupNotice` signals this replaces rendered into a report block at the top of
 * the body, which is the wrong place for the outcome of a press made in the FOOTER band: with
 * auto-save on, a blur near the bottom of a long form reported itself in a region that had scrolled
 * out of view, so the one channel saying whether an edit had survived was routinely invisible. A
 * toast is anchored to the viewport, so it reaches the owner wherever they are standing.
 *
 * Reporting lives HERE rather than in an island because all three hydration roots — header, body and
 * footer — reach the same intents, and an outcome raised per-island would either be missed by the
 * roots that did not raise it or announced once per root.
 */
const toast = useToast();

/**
 * The outcome currently on screen, so a new one REPLACES it instead of stacking beneath it.
 *
 * Auto-save fires on every blur, so tabbing through a section would otherwise leave a column of
 * near-identical "Changes saved" toasts obscuring the form they refer to.
 *
 * The previous toast is removed by ID and the replacement is given a FRESH one. Reusing a stable id
 * would look equivalent and is not: both writes land in one batch, so Preact reconciles by key and
 * sees the same element — the row would never remount, so its countdown timer and its progress-bar
 * animation would both carry on from wherever the previous outcome had got to.
 */
let outcomeToastId: string | null = null;

/** Success/failure lifetimes. A refusal is longer because it has to be read and acted on, not noticed. */
const OUTCOME_LIFE_MS = 4000;
const REFUSAL_LIFE_MS = 6000;

/** Raise the one outcome toast, retiring whichever one it supersedes. */
function report(severity: "success" | "danger", summary: string): void {
	if (outcomeToastId) toast.remove(outcomeToastId);
	outcomeToastId = toast.show({
		severity,
		summary,
		life: severity === "danger" ? REFUSAL_LIFE_MS : OUTCOME_LIFE_MS,
	});
}

/**
 * Report a refused write. Also the reveal trigger's companion — the toast says WHAT was refused and
 * the field's own verdict says WHERE, so neither has to carry both jobs.
 */
function reportError(message: string): void {
	report("danger", message);
}

/** Drop the outcome on screen — the next edit supersedes it, so a stale "Saved" cannot linger. */
function clearOutcome(): void {
	if (!outcomeToastId) return;
	toast.remove(outcomeToastId);
	outcomeToastId = null;
}

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
			s.startsWithId,
			s.delayDays,
			s.deliveryDate,
			s.capacity,
			s.seatCount,
			s.roles.map((r) => [r.id, r.name, r.quantity, r.description, r.budgetCents]),
			s.allowedFileKinds,
			s.ndaRequired,
		]),
		setup.roles.map((r) => [r.id, r.name, r.budgetCents, r.skills, r.description]),
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
	clearOutcome();
	setupReveal.value = false;
}

// #region Onboarding simulation (development only)
/**
 * The Dev Context Switcher's onboarding override, or `undefined` when it is at `auto`.
 *
 * Read at the moment of each request rather than captured once, because the switcher writes a
 * `data-dev-*` attribute without reloading — a value snapshotted at module load would describe
 * whatever the panel happened to say when the page first painted.
 *
 * It reaches the SERVER rather than being applied locally, and that is the whole design. The counts
 * decide what may still be edited, and the same guard runs on the write; simulating them only on the
 * client would draw an unlocked control the save then refuses, which is a control that reaches
 * nothing (root CLAUDE.md §3 gate 11). The server discards the parameter outside development.
 */
function onboardingSim(): string | undefined {
	const value = readDevSeam()?.projectOnboarding;
	return value && value !== "auto" ? value : undefined;
}

/**
 * Re-read the configuration from the server and adopt it as a clean baseline.
 *
 * Used by the dev seam watcher below, and deliberately REFUSED while the draft is dirty: a refetch
 * replaces the working copy, so running one over unsaved edits would discard work in response to a
 * developer flipping a switch. A dirty draft simply keeps what the owner typed, and the simulation
 * takes effect on the next clean read.
 */
export async function refreshSetup(): Promise<void> {
	const draft = setupDraft.peek();
	if (!draft || setupSaving.peek() || setupDirty.peek()) return;
	const res = await ProjectSidebarService.setup(draft.slug, onboardingSim());
	if (!res.ok || !res.data) return;
	setupDraft.value = res.data.setup;
	setupBaseline.value = res.data.setup;
}

/**
 * Track the switcher and refetch when the onboarding axis moves.
 *
 * Returns its own unsubscribe, so the island that starts it can stop it on unmount. Only the ONE
 * axis is acted on: `watchDevSeam` fires for every attribute the panel writes, and refetching the
 * whole configuration because somebody changed a messaging filter would be a round trip per
 * unrelated switch.
 */
export function watchOnboardingSim(): () => void {
	let last = onboardingSim();
	return watchDevSeam(() => {
		const next = onboardingSim();
		if (next === last) return;
		last = next;
		void refreshSetup();
	});
}
// #endregion

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
	clearOutcome();
	autoSaveHeld = false;
}

/** Throw away every unsaved edit and return to the server's copy. */
export function discardSetup(): void {
	const base = setupBaseline.value;
	if (!base) return;
	setupDraft.value = base;
	clearOutcome();
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
	// The chain is deliberately NOT awaited or cancelled: its request is already on the wire and its
	// `commit` writes to signals this call is about to clear. Dropping the references is what stops a
	// pending follow-up from firing against an engagement that is no longer on screen.
	inFlight = null;
	pending = false;
	autoSaveHeld = false;
	setupDraft.value = null;
	setupBaseline.value = null;
	setupSaving.value = false;
	clearOutcome();
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
 * Send a payload, adopt the server's re-derived setup, and report the outcome in one place.
 *
 * `projectRef` is the SLUG, which is now the only thing that routes.
 *
 * It used to be the uuid, on the reasoning that a rename regenerates the slug and a second save in
 * the same session would address a row that no longer answers to it. Decision #88 retired both halves
 * of that: a slug is minted opaque (`prj-…`) rather than derived from the title, and a `BEFORE UPDATE`
 * trigger RAISES on any statement that would move one — so it survives a rename, while every resolver
 * dropped its uuid arm and `/api/projects/{uuid}` now 404s.
 *
 * Measured before it was changed: every save and every publish from this surface answered `404`, with
 * the write landing nowhere and the owner told only that it "did not save". That decision's own sweep
 * could not have seen it — it audited rendered `a[href^="/projects/"]`, and this is a `fetch`.
 */
async function commit(
	projectRef: string,
	payload: UpdateProject,
	notice: string,
): Promise<boolean> {
	setupSaving.value = true;
	clearOutcome();
	// The exact object the payload was built from. `patchSetup` replaces the draft rather than mutating
	// it, so identity is an exact answer to "has the owner typed since this request left".
	const sent = setupDraft.peek();
	// The simulation rides the save as well as the read, or the two disagree: the form would be
	// drawing locks computed from a simulated projection while the guard judged the payload against
	// the real one, and a control the form disabled would be the only one the server allowed.
	const res = await ProjectSidebarService.update(projectRef, payload, onboardingSim());
	setupSaving.value = false;
	if (!res.ok || !res.data) {
		reportError(res.message ?? "That did not save — please try again.");
		return false;
	}
	setupBaseline.value = res.data.setup;
	/*
	 * The server's copy replaces the DRAFT only if the owner has not moved on.
	 *
	 * Adopting it unconditionally discards every edit made while the request was in flight — which
	 * before auto-save was a narrow window behind a deliberate button press, and after it is the
	 * ordinary way of working: blur a field, carry on typing in the next one, watch the sentence you
	 * just wrote revert. Measured: three edits across one slow save collapsed to the FIRST one, and
	 * the form then reported itself clean, so nothing on screen said anything had been lost.
	 *
	 * The baseline still advances, because that request genuinely was acknowledged. The newer draft is
	 * then dirty against it by definition, which is what makes the queued follow-up carry the edits
	 * this response is deliberately not overwriting.
	 */
	if (setupDraft.peek() === sent) setupDraft.value = res.data.setup;
	report("success", notice);
	setupReveal.value = false;
	autoSaveHeld = false;
	return true;
}

/**
 * Persist the draft. Resolves `true` when the server acknowledged it.
 *
 * NOT the entry point — {@link requestSave} is. This is the raw write, and calling it directly from a
 * second trigger is how two saves end up in flight against one draft.
 */
async function saveSetup(): Promise<boolean> {
	const draft = setupDraft.value;
	if (!draft || setupSaving.value) return false;
	const blocker = firstBlocker(draft);
	if (blocker) {
		reportError(blocker);
		setupReveal.value = true;
		return false;
	}
	return await commit(draft.slug, toPayload(draft), "Changes saved successfully");
}

// #region The save serialiser
/**
 * The one in-flight save, or `null`. Every trigger — the footer button, `Ctrl+S`, an auto-save on
 * blur — goes through it, so there is never more than one PATCH against this draft at a time.
 */
let inFlight: Promise<boolean> | null = null;

/** A save was asked for while one was already running, and has not been served yet. */
let pending = false;

/**
 * Ask for the draft to be persisted. THE entry point for every save trigger.
 *
 * Overlapping requests COLLAPSE rather than queue, and the difference matters. Each save posts the
 * whole form as it stands at the moment it runs, so two queued saves would send the first payload and
 * then immediately send a superset of it — one wasted round trip, and a window in which the server
 * holds a configuration the owner has already moved past. Collapsing means: whoever asks while a save
 * is running gets that save's promise, and exactly ONE more save runs afterwards if the draft is
 * still dirty. Five fields tabbed through in a second produce two requests, not five.
 *
 * The follow-up is re-checked against {@link setupDirty} rather than assumed: the in-flight save
 * adopts the server's response as the new baseline, so if nothing was typed during it there is
 * genuinely nothing left to send. It also stops on failure — retrying a refused payload in a loop
 * would turn one error the owner can read into a stream of them.
 */
export function requestSave(): Promise<boolean> {
	// Nothing to send is not a failure: the server already holds this configuration, so the promise
	// this returns is honestly `true`. The guard is here rather than only on the blur path because
	// EVERY trigger reaches this function — measured before it was added, one Ctrl+S on an untouched
	// form sent a full PATCH that rewrote the row, re-derived the ladder and re-indexed the project
	// to arrive at exactly what was already stored.
	if (!inFlight && !setupDirty.peek()) return Promise.resolve(true);
	if (inFlight) {
		pending = true;
		return inFlight;
	}
	inFlight = runSaves();
	return inFlight;
}

async function runSaves(): Promise<boolean> {
	let ok = false;
	try {
		do {
			pending = false;
			ok = await saveSetup();
			// `peek`, not `.value`: this runs outside a reactive context, and subscribing a module-level
			// async function to a signal it does not re-run for is a leak with no reader.
		} while (ok && pending && setupDirty.peek());
	} finally {
		inFlight = null;
		pending = false;
	}
	return ok;
}

/**
 * Wait for any in-flight save to settle. Resolves immediately when nothing is running.
 *
 * Publish and Archive take this before they act. Both previously returned `false` on the spot if a
 * save happened to be in flight — silently, with no message — so an owner who pressed Publish a
 * moment after an auto-save fired watched nothing happen and had no way to know why.
 */
export async function settleSaves(): Promise<void> {
	while (inFlight) await inFlight;
}
// #endregion

// #region Auto-save on blur
/**
 * Whether a field losing focus should persist the draft by itself.
 *
 * Lives in the store because the two halves are different hydration roots: the FOOTER band owns the
 * toggle, the BODY owns the blur that acts on it. Seeded from `localStorage` by the rig after
 * hydration — never during render, which would read storage on the server and, on a device that has
 * it disabled, paint a state the client then contradicts.
 */
export const autoSaveEnabled = signal<boolean>(false);

/**
 * An auto-save has failed, and blur alone will not try that same payload again.
 *
 * Cleared by the next local edit, by a successful write, and by an explicit re-enable. Without it a
 * refused save leaves the draft dirty, so every subsequent focus move retries the identical body and
 * repaints the identical error — one failure becomes one per field the owner tabs past. Retries
 * should be proportional to EDITS, which are new payloads worth trying, not to focus movements, which
 * are not.
 */
let autoSaveHeld = false;

/** Set the preference and remember it for this device. */
export function setAutoSave(enabled: boolean): void {
	autoSaveEnabled.value = enabled;
	// Switching it back on is an explicit "try again".
	if (enabled) autoSaveHeld = false;
	writeStored("local", LocalKeys.PROJECT_AUTOSAVE, enabled ? "1" : "0");
}

/** Adopt the stored preference. Safe to call more than once; the rig calls it on mount. */
export function hydrateAutoSave(): void {
	autoSaveEnabled.value = readStored("local", LocalKeys.PROJECT_AUTOSAVE) === "1";
}

/**
 * A field lost focus. Persist only if that is what the owner asked for AND something actually changed.
 *
 * The dirty check is the whole point: tabbing through a form reading it must cost nothing, so this
 * measures the draft against the last configuration the SERVER acknowledged rather than against
 * whether a field was visited. A field that was focused, edited and edited back to its original value
 * is correctly not dirty and correctly does not save.
 */
export function autoSaveOnBlur(): void {
	if (!autoSaveEnabled.peek() || autoSaveHeld) return;
	if (!setupDirty.peek()) return;
	const draft = setupDraft.peek();
	// An archived project refuses every write, and firstBlocker's refusals are for a deliberate press
	// to answer — an auto-save must never paint the form red for a field the owner is walking past.
	if (!draft || draft.archivedAt !== null || firstBlocker(draft) !== null) return;
	void requestSave().then((ok) => {
		if (!ok) autoSaveHeld = true;
	});
}
// #endregion

/**
 * Publish the engagement.
 *
 * The status rides along with the whole form rather than going out as a bare `{ status }`: publishing
 * a draft that still holds unsaved edits would put the server's OLDER configuration in front of
 * freelancers, which is the one moment the difference matters.
 */
export async function publishSetup(): Promise<boolean> {
	await settleSaves();
	const draft = setupDraft.value;
	if (!draft || setupSaving.value) return false;
	// Ordered so the more specific answer wins: "give the project a name" and "this project is
	// archived" both name the thing to do about it, where "finish the required steps" only says that
	// one of five is outstanding.
	const blocker = firstBlocker(draft);
	if (blocker) {
		reportError(blocker);
		setupReveal.value = true;
		return false;
	}
	if (!draft.previewReady) {
		reportError("Finish the required steps before publishing.");
		setupReveal.value = true;
		return false;
	}
	return await commit(
		draft.slug,
		{ ...toPayload(draft), status: "active" },
		"Project published successfully",
	);
}

/**
 * Archive the engagement — a soft archive, so the row and its history survive (root CLAUDE.md §5).
 *
 * On success the surface leaves for the feed rather than re-rendering: the page the owner is standing
 * on is the configuration of a project that is no longer in circulation, and every control on it
 * would now be editing something nobody can reach.
 */
export async function archiveSetup(): Promise<boolean> {
	await settleSaves();
	const draft = setupDraft.value;
	if (!draft || setupSaving.value) return false;
	if (draft.archivedAt !== null) {
		reportError("This project is already archived.");
		return false;
	}
	setupSaving.value = true;
	clearOutcome();
	// The slug, for the reason spelled out on `commit`: the uuid stopped routing (Decision #88), so an
	// archive keyed on it answers 404 and reports a failure over a project that is perfectly archivable.
	const res = await ProjectSidebarService.archive(draft.slug);
	setupSaving.value = false;
	if (!res.ok) {
		reportError(res.message ?? "That did not archive — please try again.");
		return false;
	}
	globalThis.location.href = "/projects";
	return true;
}
// #endregion
