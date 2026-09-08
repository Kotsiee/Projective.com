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
import { markSetupCommitted, setupBaseline, setupDraft } from "./setup-store.ts";
import { resetFieldValidation } from "./setup-validation.ts";
import { isOnline, markReachable, watchNetwork } from "@web/utils/network.ts";
import {
	dequeueWrite,
	enqueueWrite,
	listWrites,
	peekWrite,
	type QueuedWrite,
} from "./offline-queue.ts";
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
/**
 * The working copy and the clean baseline, re-exported from the leaf that declares them.
 *
 * They live in `core/setup-store.ts` so the middle-nav LANE can read the draft — it renders on every
 * `/projects/{slug}/…` route, most of which edit nothing — without importing this module's save
 * serialiser, offline queue, toast channel and thin client service along with it.
 */
export { setupBaseline, setupDraft };

/** A save/publish/archive is in flight; the rig blocks a second press against the same draft. */
export const setupSaving = signal<boolean>(false);

/**
 * When this device last watched a save land, as epoch milliseconds, or `null`.
 *
 * The auto-save presentation replaces Save · Discard with a "last updated" line, and this is the
 * only honest source for it: `ProjectSetup` carries no `updatedAt`, so there is nothing on the
 * server projection to render. It therefore says what it means — the last save THIS BROWSER saw —
 * and is not offered as the project's modification time, which a second device editing the same
 * project would contradict.
 *
 * Persisted per {@link LocalKeys.PROJECT_SAVED_AT} so it survives a reload, and scoped to the
 * project id so opening a different engagement cannot inherit this one's timestamp.
 */
export const setupSavedAt = signal<number | null>(null);

/**
 * This project has an edit held on this device that the server has not accepted.
 *
 * Distinct from {@link setupDirty}, and the difference is what the surface reports. Dirty means "not
 * sent yet" — the ordinary state of a form somebody is typing into. Queued means "sent, refused by
 * the absence of a network, and stored", which is a promise that it will go out by itself. Only the
 * second one licenses telling the owner they can safely close the tab.
 */
export const setupQueued = signal<boolean>(false);

/**
 * Save · publish · archive outcomes are reported as TOASTS, not as a banner in the form.
 *
 * ## What is announced, and what is not
 *
 * A SUCCESS is announced only when somebody asked for it: the Save or Discard button (which exist
 * only while auto-save is off), `Ctrl+S`, or Publish. An auto-save landing on blur says nothing —
 * it fires on every focus move, and a toast per field turns the one channel that reports real
 * trouble into something the eye learns to skip.
 *
 * REFUSALS are never gated. Whatever ran the write, an edit the server would not take has to
 * interrupt: the alternative is an owner who watches a form look saved and closes the tab. The same
 * goes for the offline/queued notices, which report where the work actually is.
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
 * Auto-save fires on every blur, and a run of them can each have something to say — an offline
 * queue notice, then a refusal — so without this the form would be read through a column of stacked
 * reports. (Their SUCCESS no longer says anything at all; see {@link SaveTrigger}.)
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

/**
 * Raise the one outcome toast, retiring whichever one it supersedes.
 *
 * `info` is a third severity rather than a shade of the other two, and it carries a specific claim:
 * nothing failed and nothing reached the server. A queued offline save reported as `success` would
 * tell the owner their work is safe somewhere it is not; reported as `danger` it would ask them to
 * act on something that is already handled.
 */
function report(severity: "success" | "danger" | "info", summary: string): void {
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
	setupSavedAt.value = readSavedAt(setup.id);
	void restoreQueuedDraft(setup.id);
}

// #region The last-saved stamp
/** The stored `{id, at}` pair, or `null` when it is absent, unparseable, or about another project. */
function readSavedAt(projectId: string): number | null {
	const raw = readStored("local", LocalKeys.PROJECT_SAVED_AT);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as { id?: unknown; at?: unknown };
		if (parsed.id !== projectId || typeof parsed.at !== "number") return null;
		// A timestamp from the future is a clock that has been corrected backwards since it was
		// written. Rendering it would produce "last updated in 3 hours", so it is discarded rather
		// than clamped — there is no honest value to clamp it to.
		return parsed.at <= Date.now() ? parsed.at : null;
	} catch {
		return null;
	}
}

/** Record that a save landed, for this project, now. */
function stampSavedAt(projectId: string): void {
	const at = Date.now();
	setupSavedAt.value = at;
	writeStored("local", LocalKeys.PROJECT_SAVED_AT, JSON.stringify({ id: projectId, at }));
}
// #endregion

// #region Offline restore
/**
 * Adopt an edit this device made offline and has not managed to send.
 *
 * The SSR copy stays the BASELINE — it is genuinely what the server holds — while the stored working
 * copy becomes the draft, so the form reopens exactly as the owner left it and reads as dirty, which
 * it is. Adopting the stored copy as both would report the outage's edits as saved.
 *
 * Only ever runs on a fresh seed, and only writes if the draft is still the one it was seeded with:
 * the read is asynchronous, and an owner who started typing during it must not have their first
 * keystrokes overwritten by a restore they have already moved past.
 */
async function restoreQueuedDraft(projectId: string): Promise<void> {
	const queued = await peekWrite(projectId);
	if (!queued || seededId !== projectId) return;
	setupQueued.value = true;
	if (setupDraft.peek()?.id === projectId && !setupDirty.peek()) {
		setupDraft.value = queued.draft;
	}
	// Back online with something owed: send it without waiting to be asked. The owner queued this
	// edit deliberately, and making them press Save again for work they have already done is asking
	// them to repeat a decision.
	if (isOnline.peek()) void flushQueuedWrites();
}
// #endregion

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

/**
 * Throw away every unsaved edit and return to the server's copy.
 *
 * Also drops whatever this project had QUEUED, and that is the whole point rather than a tidy-up.
 * Discard is the owner saying these edits should not exist; leaving the queued copy behind would
 * send them the next time the connection came back, silently undoing the discard hours later with no
 * press anywhere to explain it.
 */
export function discardSetup(): void {
	const base = setupBaseline.value;
	if (!base) return;
	// Read BEFORE the draft is replaced — `setupDirty` is computed from draft-vs-baseline, so after
	// the assignment it is false by construction and would report every discard as a no-op.
	const discarded = setupDirty.peek();
	setupDraft.value = base;
	clearOutcome();
	setupReveal.value = false;
	setupQueued.value = false;
	void dequeueWrite(base.id);
	/*
	 * Discard is announced, and it is the one outcome on this surface with nothing else to show for
	 * itself. A save moves the status line and the ladder; a discard's whole effect is that the form
	 * goes back to what the server already had, which on a long form can be entirely off-screen — the
	 * owner presses a button and, from where they are standing, nothing happens.
	 *
	 * Guarded on there having been something to throw away rather than trusting the caller: the rig
	 * only renders Discard while the draft is dirty, but "changes discarded" over a form that had no
	 * changes is a claim about work that never existed.
	 */
	if (discarded) report("success", "Changes discarded");
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
	announceSave = false;
	autoSaveHeld = false;
	setupDraft.value = null;
	setupBaseline.value = null;
	setupSaving.value = false;
	setupSavedAt.value = null;
	// The QUEUE is deliberately not cleared — it is durable by design and survives this surface. Only
	// the in-memory flag is reset, and the next seed re-derives it from the store.
	setupQueued.value = false;
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
	notice: string | null,
): Promise<boolean> {
	const draft = setupDraft.peek();

	/*
	 * Offline: store it and say so, rather than sending into the dark.
	 *
	 * Checked BEFORE the request rather than reading the failure afterwards, because the two are not
	 * the same event. A transport failure could be an outage or a server that is down, and the two
	 * want opposite handling — one is worth replaying automatically, the other would replay a payload
	 * something has already refused, forever. `navigator.onLine === false` is the one signal that
	 * distinguishes them, and it is only trusted in this direction (see `utils/network.ts`).
	 *
	 * The BASELINE deliberately does not move. Advancing it would make the form clean, retire the
	 * Save control and leave the owner with no way to act if the flush later failed permanently — the
	 * server does not have this configuration, and the surface must not imply that it does.
	 */
	if (draft && !isOnline.peek()) {
		await enqueueWrite({
			projectId: draft.id,
			slug: draft.slug,
			payload,
			draft,
			queuedAt: Date.now(),
			title: draft.title,
		});
		setupQueued.value = true;
		report("info", "You are offline — saved on this device and queued to sync.");
		return false;
	}

	setupSaving.value = true;
	clearOutcome();
	// The exact object the payload was built from. `patchSetup` replaces the draft rather than mutating
	// it, so identity is an exact answer to "has the owner typed since this request left".
	// `draft` is the exact object the payload was built from. `patchSetup` replaces the draft rather
	// than mutating it, so identity is an exact answer to "has the owner typed since this request
	// left" — and it is peeked before the request, with no `await` between, so it names the state
	// that was sent.
	const sent = draft;
	// The simulation rides the save as well as the read, or the two disagree: the form would be
	// drawing locks computed from a simulated projection while the guard judged the payload against
	// the real one, and a control the form disabled would be the only one the server allowed.
	const res = await ProjectSidebarService.update(projectRef, payload, onboardingSim());
	setupSaving.value = false;
	if (!res.ok || !res.data) {
		/*
		 * The connection may have dropped DURING the request, which `navigator.onLine` now reports and
		 * the pre-flight check could not have seen. Re-testing here rather than inferring an outage
		 * from the failure keeps the distinction the pre-flight check draws: a refusal by a reachable
		 * server is reported and dropped, and only an actual absence of network is queued.
		 */
		if (sent && !isOnline.peek()) {
			await enqueueWrite({
				projectId: sent.id,
				slug: sent.slug,
				payload,
				draft: sent,
				queuedAt: Date.now(),
				title: sent.title,
			});
			setupQueued.value = true;
			report("info", "You went offline mid-save — it is stored here and queued to sync.");
			return false;
		}
		reportError(res.message ?? "That did not save — please try again.");
		return false;
	}
	markReachable();
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
	// A `null` notice means this write's success is announced by its caller, or not at all. Ordinary
	// saves take that path so an auto-save on blur can land in silence; publish still names itself
	// here, because there is exactly one publish per press and no batch for it to be announced by.
	if (notice !== null) report("success", notice);
	setupReveal.value = false;
	autoSaveHeld = false;
	// Whatever this project owed is now on the server — this payload is a superset of it, since every
	// save sends the whole form. Clearing it here rather than only in the flush is what stops a
	// queued entry outliving the edit it described and being replayed over newer work.
	setupQueued.value = false;
	void dequeueWrite(res.data.setup.id);
	stampSavedAt(res.data.setup.id);
	/*
	 * Announce the acknowledgement to the middle-nav lane, LAST — after the baseline, the draft and
	 * the queue have all settled, so a reader woken by it sees the finished state rather than a
	 * half-applied one.
	 *
	 * It carries no payload: the lane keeps drawing the draft, which is ahead of this response
	 * whenever the owner has typed since. What it says is only that a server round trip has landed,
	 * which is the moment a stage created in this form can first have a channel to link to.
	 */
	markSetupCommitted();
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
	// `null`: an ordinary save never announces itself from here. Whether this one is worth a toast
	// depends on WHY it ran, which this function cannot see — {@link runSaves} owns that answer.
	return await commit(draft.slug, toPayload(draft), null);
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
 * Why a save ran — and therefore whether its SUCCESS is worth a toast.
 *
 * `explicit` is a deliberate press: the Save button, or `Ctrl+S`. The owner asked a question and is
 * owed an answer. `implicit` is the auto-save on blur, which fires on every focus move — announcing
 * those turned "your work is safe" into wallpaper, one toast per field tabbed past, sitting over the
 * form it referred to.
 *
 * Only SUCCESS is gated. A refusal, and the offline/queued notices, are reported whatever triggered
 * them: an auto-save that failed silently is an owner who closes the tab believing work is stored
 * that is not, which is the one outcome this channel exists to prevent.
 */
export type SaveTrigger = "explicit" | "implicit";

/**
 * Some requester in the current batch was a deliberate press, so the batch announces when it lands.
 *
 * A flag on the BATCH rather than a parameter carried down to the write, because
 * {@link requestSave} collapses overlapping requests: a Save pressed while an auto-save is in flight
 * is served by that save's promise, and if the trigger travelled with the write instead, the press
 * would inherit the blur's silence and look broken. OR-ing it upward means one deliberate requester
 * anywhere in the batch is enough.
 */
let announceSave = false;

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
export function requestSave(trigger: SaveTrigger = "explicit"): Promise<boolean> {
	// Nothing to send is not a failure: the server already holds this configuration, so the promise
	// this returns is honestly `true`. The guard is here rather than only on the blur path because
	// EVERY trigger reaches this function — measured before it was added, one Ctrl+S on an untouched
	// form sent a full PATCH that rewrote the row, re-derived the ladder and re-indexed the project
	// to arrive at exactly what was already stored.
	//
	// It also returns before `announceSave` is touched, so a no-op request cannot arm an announcement
	// for a batch that never runs — nor leave one armed for the NEXT batch, which would hand an
	// auto-save a toast it did not earn.
	if (!inFlight && !setupDirty.peek()) return Promise.resolve(true);
	if (inFlight) {
		// OR, never assign: a deliberate press joining a batch must not be silenced by a blur that
		// joins after it.
		announceSave = announceSave || trigger === "explicit";
		pending = true;
		return inFlight;
	}
	announceSave = trigger === "explicit";
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
	/*
	 * One announcement per BATCH, not per write.
	 *
	 * Read and cleared here rather than inside the loop because a batch is one answer to one press:
	 * a Save that collapses three queued payloads into two round trips is still one "did that work?"
	 * and deserves one reply. Failures are already reported by `commit` as they happen, with the
	 * specific reason attached — this only ever adds the success case the write no longer claims.
	 */
	const announce = announceSave;
	announceSave = false;
	if (ok && announce) report("success", "Changes saved successfully");
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
	// `implicit`: a blur is the owner moving through the form, not asking a question, so a save that
	// lands says nothing. One that is REFUSED still reports itself — `commit` does that regardless of
	// trigger, because an edit that silently failed to persist is the failure worth interrupting for.
	void requestSave("implicit").then((ok) => {
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
	/*
	 * Publishing is NOT queued offline, unlike an ordinary edit.
	 *
	 * An edit queued and applied later arrives at the same configuration the owner intended, whenever
	 * it lands. Publishing is a lifecycle transition with consequences the owner was asked to confirm
	 * on screen — the engagement becomes visible, applications open, and the onboarding locks begin to
	 * bite — so it must happen while they are watching it, not silently at whatever moment their train
	 * comes out of a tunnel.
	 */
	if (!isOnline.peek()) {
		reportError("Publishing needs a connection — your edits are saved here in the meantime.");
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
	// Not queued offline, for the reason publishing is not: a lifecycle transition happens while the
	// person who chose it is watching. It also navigates away on success, which is not something to
	// do to somebody hours after they pressed the button.
	if (!isOnline.peek()) {
		reportError("Archiving needs a connection.");
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

// #region Offline flush
/**
 * A flush is running. Concurrency is refused rather than queued: the entries supersede in place, so
 * two flushes racing would send the same payload twice and the second would either duplicate a write
 * that has already landed or resurrect an entry the first has just dequeued.
 */
let flushing = false;

/**
 * Send every write this device is holding, oldest first.
 *
 * Ordered across PROJECTS because that is the order the owner made them in and it is the only
 * ordering that is meaningful — within one project there is never more than one entry (see
 * `offline-queue.ts`), so nothing here has to reason about superseding.
 *
 * ## A failed entry is never dropped
 *
 * The tempting rule is "a refusal means this payload will never be accepted, so discard it" — and it
 * is wrong here, because this layer cannot tell a refusal from an outage. `api.ts` folds a transport
 * failure into the same soft `{ ok: false }` a 422 produces, so a server that is unreachable while
 * `navigator.onLine` still reads `true` (a captive portal, a dropped VPN tunnel — the exact case
 * `utils/network.ts` documents) is indistinguishable from a configuration the server has genuinely
 * rejected. Discarding on that ambiguity would silently destroy work the owner believes is safe,
 * which is the worst outcome this whole feature exists to prevent.
 *
 * So the entry STAYS and the flush stops. The retry is bounded rather than continuous — a flush runs
 * only on the offline→online edge and when a setup surface mounts, never on a timer — so a payload
 * the server really will not accept is retried once per reconnect and once per page open, not in a
 * loop. And it stays visible: opening that project restores the queued draft into the form, where
 * pressing Save produces the server's actual refusal in words the owner can act on.
 *
 * Stopping rather than continuing past a failure is deliberate too. The most likely single cause is
 * that the connection has gone again, and walking the rest of the list into the same wall would
 * spend a round trip per project to report one outage several times.
 */
export async function flushQueuedWrites(): Promise<void> {
	if (flushing || !isOnline.peek()) return;
	flushing = true;
	try {
		const queued = await listWrites();
		if (queued.length === 0) {
			setupQueued.value = false;
			return;
		}

		const active = setupDraft.peek();
		let sent = 0;
		let stalled: QueuedWrite | null = null;

		for (const entry of queued) {
			if (!isOnline.peek()) break;
			const res = await ProjectSidebarService.update(entry.slug, entry.payload, onboardingSim());

			if (!res.ok || !res.data) {
				stalled = entry;
				break;
			}

			markReachable();
			await dequeueWrite(entry.projectId);
			stampSavedAt(entry.projectId);
			sent += 1;

			/*
			 * Adopt the response only for the project currently on screen, and only if the owner has not
			 * typed since. The other entries belong to projects no island is rendering, so there is
			 * nothing to adopt into — writing their setup into these signals would put another project's
			 * configuration in front of the person editing this one.
			 */
			if (active && active.id === entry.projectId) {
				setupBaseline.value = res.data.setup;
				if (setupDraft.peek() === active) setupDraft.value = res.data.setup;
				// Only for the project on screen: the lane is rendering THIS engagement, and an epoch
				// bumped by another project's queued write would send it to re-read for a change that
				// happened somewhere it is not looking.
				markSetupCommitted();
			}
		}

		const remaining = await listWrites();
		setupQueued.value = remaining.length > 0;

		if (stalled) {
			// Named, because the entry that stalled may belong to a project the reader is not looking at
			// — "an edit could not sync" with no subject is a sentence nobody can act on.
			reportError(
				`"${
					stalled.title || "An offline edit"
				}" could not sync yet — it is still saved on this device.`,
			);
		} else if (sent > 0) {
			report(
				"success",
				sent === 1 ? "Your offline edit has synced." : `${sent} offline edits synced.`,
			);
		}
	} finally {
		flushing = false;
	}
}

/**
 * Track the connection, and drain the queue the moment there is one. Returns its own unsubscribe.
 *
 * Started by the body island rather than globally, because a flush adopts a server response into
 * these signals and those only mean anything while a setup surface is mounted. The consequence is
 * stated plainly: an edit queued for project A and never returned to syncs the next time ANY project
 * setup surface is opened online, not the instant the machine reconnects. That is the honest limit
 * of a queue drained by a page rather than by the service worker's Background Sync, which is not
 * available on every engine this app supports.
 */
export function watchOfflineFlush(): () => void {
	const stopNetwork = watchNetwork();
	let wasOnline = isOnline.peek();

	const unsubscribe = isOnline.subscribe((online) => {
		// Only the FALSE → TRUE edge. `subscribe` fires immediately with the current value and on every
		// write, and a flush per write would run on any redundant `online` event the browser emits.
		if (online && !wasOnline) void flushQueuedWrites();
		wasOnline = online;
	});

	if (isOnline.peek()) void flushQueuedWrites();

	return () => {
		unsubscribe();
		stopNetwork();
	};
}

/**
 * Re-exported so the two footer bands have ONE import for the whole save story.
 *
 * They already read six signals from this module to decide what to render; reaching past it into
 * `utils/network.ts` for the seventh would make the connection look like a separate concern from
 * whether the draft is saved, when on this surface it is the same question.
 */
export { isOnline };
// #endregion
