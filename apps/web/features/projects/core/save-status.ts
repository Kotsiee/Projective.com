/**
 * save-status — the one sentence a setup surface shows about whether the owner's work is safe, and
 * the rule that picks it.
 *
 * TWO footer bands render it: the whole-project rig on `/projects/[projectId]` and the single-stage
 * rig on `/projects/[projectId]/[channelId]/details`. They edit the same draft through the same
 * store, so a reader moving between them must not be told two different things about the same
 * unsaved edit. The rule lives here rather than in either island for the same reason the write path
 * does — a second copy is how the two come to disagree, and the disagreement would be about whether
 * somebody's work exists.
 *
 * Pure and total: no signals, no DOM, no clock of its own. `now` is passed in so the caller controls
 * when the sentence changes, and so this is testable without freezing time.
 */

// #region Shapes
/**
 * Which channel the status belongs to.
 *
 * Rendered as a MARK and a word, never as a colour alone (DESIGN_SYSTEM §A.5) — the tone selects the
 * mark, and the sentence carries the fact on its own for anyone who cannot see either.
 */
export type SaveTone = "saved" | "pending" | "offline" | "archived";

/** What the footer band should say, and how to mark it. */
export interface SaveStatus {
	tone: SaveTone;
	/** The sentence itself, already phrased for display. */
	label: string;
}

/** Everything the sentence depends on. */
export interface SaveStatusInput {
	/** A write is on the wire right now. */
	saving: boolean;
	/** The draft differs from the last configuration the server acknowledged. */
	dirty: boolean;
	/** This device is holding an edit the server has not accepted. */
	queued: boolean;
	/** The browser believes it can reach the network. */
	online: boolean;
	/** The engagement is archived, so every write is refused. */
	archived: boolean;
	/** Auto-save is on, so there is no Save control to point at. */
	autoSave: boolean;
	/** When this device last watched a save land, or `null`. */
	savedAt: number | null;
	/** The current instant. */
	now: number;
}
// #endregion

// #region Relative time
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `at` was, in words — or the local clock time once "ago" stops being useful.
 *
 * The switch to an absolute time at a day old is the point of the function. "3 days ago" is a
 * quantity somebody has to convert before it means anything, where "Tuesday 14:32" is the thing they
 * were going to convert it into. Under a day, the relative form is genuinely easier to read.
 *
 * A future instant is reported as "just now" rather than as a negative interval: the only way to get
 * one is a clock that has been corrected, and "in 4 minutes" describes a save that has not happened.
 */
export function relativeTime(at: number, now: number): string {
	const elapsed = now - at;

	if (elapsed < 45 * 1000) return "just now";
	if (elapsed < HOUR) {
		const minutes = Math.round(elapsed / MINUTE);
		return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	}
	if (elapsed < DAY) {
		const hours = Math.round(elapsed / HOUR);
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}

	// The viewer's own locale and zone, resolved by the platform. A saved-at stamp is a fact about
	// this device, so the device's own formatting is the correct one — unlike a money figure, which
	// is priced in a currency the viewer does not choose.
	try {
		return new Date(at).toLocaleString(undefined, {
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return new Date(at).toISOString().slice(0, 16).replace("T", " ");
	}
}
// #endregion

// #region The rule
/**
 * The sentence for the current state, most specific answer first.
 *
 * The ordering IS the rule, and each step earns its place:
 *
 *  1. **Archived** outranks everything, because nothing below it can happen — reporting "unsaved
 *     changes" on a project whose writes are all refused would name a state the owner cannot leave.
 *  2. **Saving** outranks offline, because a request genuinely is on the wire; the connection may
 *     have dropped since it left, and that is reported when it comes back rather than guessed at.
 *  3. **Queued** outranks plain dirtiness, and this is the distinction the whole module exists for.
 *     "Unsaved changes" asks the owner to do something; "saved on this device" tells them it is
 *     already handled. Getting this the wrong way round either loses work or nags about work that is
 *     safe.
 *  4. **Offline while dirty** is reported as offline rather than as unsaved, because the reason the
 *     edit has not gone is not something the owner can fix by pressing Save.
 *  5. Only then the ordinary pair, and only then the auto-save "last updated" line — which is the
 *     answer for a form with nothing outstanding and no control to press.
 */
export function resolveSaveStatus(input: SaveStatusInput): SaveStatus {
	if (input.archived) {
		return { tone: "archived", label: "Archived — changes can no longer be saved" };
	}
	if (input.saving) return { tone: "pending", label: "Saving…" };
	if (input.queued) {
		return { tone: "offline", label: "Saved on this device — will sync when you reconnect" };
	}
	if (!input.online) {
		return input.dirty
			? { tone: "offline", label: "Offline — your changes are held on this device" }
			: { tone: "offline", label: "Offline" };
	}
	if (input.dirty) return { tone: "pending", label: "Unsaved changes" };

	if (input.autoSave && input.savedAt !== null) {
		return { tone: "saved", label: `Last updated ${relativeTime(input.savedAt, input.now)}` };
	}
	if (input.autoSave) {
		// Auto-save is on and this device has not yet watched a save land — a form opened and not yet
		// touched. There is no timestamp to report and inventing one from the page load would be a
		// claim about the server nothing here can make.
		return { tone: "saved", label: "Auto-save on — edits save as you go" };
	}
	return { tone: "saved", label: "All changes saved" };
}
// #endregion
