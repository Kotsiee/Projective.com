import { computed, type ReadonlySignal, signal } from "@preact/signals";
import {
	type ProjectSetup,
	type ProjectSetupPatch,
	reconcileSetup,
} from "../types/projects-types.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { useToast } from "@projective/ui/feedback";
import { ProjectSidebarService } from "./ProjectSidebarService.ts";
import { setupBaseline, setupDraft } from "./setup-store.ts";
import { resetFieldValidation } from "./setup-validation.ts";
import { isOnline } from "@web/utils/network.ts";
import { dequeueWrite, peekWrite } from "./offline-queue.ts";
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
 *
 * This module holds the working copy, the outcome channel and the local edits. The writes — the
 * payload, the save serialiser, auto-save, publish, archive and the offline flush — live in
 * `setup-persistence.ts`, which imports this module and is never imported by it. Consumers reach
 * both through the `setup-state.ts` barrel.
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
// #endregion

// #region Outcome reporting
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
 * reports. (Their SUCCESS no longer says anything at all; see `SaveTrigger` in
 * `setup-persistence.ts`.)
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
export function report(severity: "success" | "danger" | "info", summary: string): void {
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
export function reportError(message: string): void {
	report("danger", message);
}

/** Drop the outcome on screen — the next edit supersedes it, so a stale "Saved" cannot linger. */
export function clearOutcome(): void {
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
// #endregion

// #region Save session bookkeeping
/**
 * Which engagement the store currently holds, so a second island's seed cannot overwrite live edits.
 *
 * Keyed on the canonical uuid rather than the slug: a slug is derived from the title and moves on the
 * first rename, so a save that renames the project would make the next seed look like a different
 * engagement and discard everything typed since.
 */
let seededId: string | null = null;

/**
 * The save serialiser's non-reactive bookkeeping.
 *
 * Declared here rather than beside the serialiser in `setup-persistence.ts` because the local edits
 * below have to reach it — {@link patchSetup} releases the auto-save hold and
 * {@link resetSetupState} drops the chain — and this module must not import the one that imports it.
 * Plain fields rather than signals: nothing renders from them, and a subscription to any of them
 * would be a reader that never re-runs.
 */
export const saveSession: {
	/**
	 * The one in-flight save, or `null`. Every trigger — the footer button, `Ctrl+S`, an auto-save on
	 * blur — goes through it, so there is never more than one PATCH against this draft at a time.
	 */
	inFlight: Promise<boolean> | null;
	/** A save was asked for while one was already running, and has not been served yet. */
	pending: boolean;
	/**
	 * Some requester in the current batch was a deliberate press, so the batch announces when it lands.
	 *
	 * A flag on the BATCH rather than a parameter carried down to the write, because `requestSave`
	 * collapses overlapping requests: a Save pressed while an auto-save is in flight is served by that
	 * save's promise, and if the trigger travelled with the write instead, the press would inherit the
	 * blur's silence and look broken. OR-ing it upward means one deliberate requester anywhere in the
	 * batch is enough.
	 */
	announce: boolean;
	/**
	 * An auto-save has failed, and blur alone will not try that same payload again.
	 *
	 * Cleared by the next local edit, by a successful write, and by an explicit re-enable. Without it a
	 * refused save leaves the draft dirty, so every subsequent focus move retries the identical body and
	 * repaints the identical error — one failure becomes one per field the owner tabs past. Retries
	 * should be proportional to EDITS, which are new payloads worth trying, not to focus movements,
	 * which are not.
	 */
	autoSaveHeld: boolean;
} = { inFlight: null, pending: false, announce: false, autoSaveHeld: false };

/**
 * The offline-queue drain, bound by `setup-persistence.ts` as it loads.
 *
 * Restoring a queued draft wants to send it at once, but the drain lives in the persistence module,
 * which imports this one; importing it back would make the pair a cycle whose evaluation order
 * depends on which module an island happened to reach first. The persistence module binds itself here
 * instead, and every consumer reaches both through the `setup-state.ts` barrel, so the drain is bound
 * before any island can seed.
 */
let flushQueue: (() => Promise<void>) | null = null;

/** Bind the offline-queue drain {@link seedSetup} starts when it restores a queued draft. */
export function bindQueueFlush(flush: () => Promise<void>): void {
	flushQueue = flush;
}
// #endregion

// #region Dirtiness
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
 * navigation, with nothing anywhere reporting a problem. Its twin is `toPayload` in
 * `setup-persistence.ts`, which fails the same way one step later, and the two are always changed
 * together.
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
export function stampSavedAt(projectId: string): void {
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
	if (isOnline.peek()) void flushQueue?.();
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
export function onboardingSim(): string | undefined {
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
	saveSession.autoSaveHeld = false;
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
	saveSession.inFlight = null;
	saveSession.pending = false;
	saveSession.announce = false;
	saveSession.autoSaveHeld = false;
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
