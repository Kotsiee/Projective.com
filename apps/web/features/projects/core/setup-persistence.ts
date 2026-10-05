import { signal } from "@preact/signals";
import type { ProjectRules, ProjectSetup, UpdateProject } from "../types/projects-types.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { ProjectSidebarService } from "./ProjectSidebarService.ts";
import { markSetupCommitted, setupBaseline, setupDraft } from "./setup-store.ts";
import { firstBlocker } from "./setup-validation.ts";
import { isOnline, markReachable, watchNetwork } from "@web/utils/network.ts";
import { dequeueWrite, enqueueWrite, listWrites, type QueuedWrite } from "./offline-queue.ts";
import {
	bindQueueFlush,
	clearOutcome,
	onboardingSim,
	report,
	reportError,
	saveSession,
	setupDirty,
	setupQueued,
	setupReveal,
	setupSaving,
	stampSavedAt,
} from "./setup-signals.ts";

/**
 * Setup persistence — every write the Details surface makes: the payload, the save serialiser,
 * auto-save on blur, publish, archive and the offline drain. It imports `setup-signals.ts`, never the
 * reverse, so the store and the toast channel initialise once, before anything here runs.
 */

// #region The payload
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
 * failure because the surface says the opposite of what happened. Its twin is `fingerprint` in
 * `setup-signals.ts`; the two are always changed together.
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
// #endregion

// #region The write
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
	saveSession.autoSaveHeld = false;
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
// #endregion

// #region The save serialiser
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
	// It also returns before `announce` is touched, so a no-op request cannot arm an announcement
	// for a batch that never runs — nor leave one armed for the NEXT batch, which would hand an
	// auto-save a toast it did not earn.
	if (!saveSession.inFlight && !setupDirty.peek()) return Promise.resolve(true);
	if (saveSession.inFlight) {
		// OR, never assign: a deliberate press joining a batch must not be silenced by a blur that
		// joins after it.
		saveSession.announce = saveSession.announce || trigger === "explicit";
		saveSession.pending = true;
		return saveSession.inFlight;
	}
	saveSession.announce = trigger === "explicit";
	const run = runSaves();
	saveSession.inFlight = run;
	return run;
}

async function runSaves(): Promise<boolean> {
	let ok = false;
	try {
		do {
			saveSession.pending = false;
			ok = await saveSetup();
			// `peek`, not `.value`: this runs outside a reactive context, and subscribing a module-level
			// async function to a signal it does not re-run for is a leak with no reader.
		} while (ok && saveSession.pending && setupDirty.peek());
	} finally {
		saveSession.inFlight = null;
		saveSession.pending = false;
	}
	/*
	 * One announcement per BATCH, not per write.
	 *
	 * Read and cleared here rather than inside the loop because a batch is one answer to one press:
	 * a Save that collapses three queued payloads into two round trips is still one "did that work?"
	 * and deserves one reply. Failures are already reported by `commit` as they happen, with the
	 * specific reason attached — this only ever adds the success case the write no longer claims.
	 */
	const announce = saveSession.announce;
	saveSession.announce = false;
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
	while (saveSession.inFlight) await saveSession.inFlight;
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

/** Set the preference and remember it for this device. */
export function setAutoSave(enabled: boolean): void {
	autoSaveEnabled.value = enabled;
	// Switching it back on is an explicit "try again".
	if (enabled) saveSession.autoSaveHeld = false;
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
	if (!autoSaveEnabled.peek() || saveSession.autoSaveHeld) return;
	if (!setupDirty.peek()) return;
	const draft = setupDraft.peek();
	// An archived project refuses every write, and firstBlocker's refusals are for a deliberate press
	// to answer — an auto-save must never paint the form red for a field the owner is walking past.
	if (!draft || draft.archivedAt !== null || firstBlocker(draft) !== null) return;
	// `implicit`: a blur is the owner moving through the form, not asking a question, so a save that
	// lands says nothing. One that is REFUSED still reports itself — `commit` does that regardless of
	// trigger, because an edit that silently failed to persist is the failure worth interrupting for.
	void requestSave("implicit").then((ok) => {
		if (!ok) saveSession.autoSaveHeld = true;
	});
}
// #endregion

// #region Lifecycle transitions
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

// Handed to the signals module, which cannot import this one, so a restoring seed can drain at once.
bindQueueFlush(flushQueuedWrites);

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
// #endregion
