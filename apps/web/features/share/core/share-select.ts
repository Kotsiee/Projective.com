import type { RankedContact } from "@features/messaging/types/messaging-types.ts";

/**
 * share-select — the share surface's "Send to…" picker as pure functions (Decision #406): pick people
 * first, send once. Each person gets their own direct message — never a group — so a selection is a
 * list of separate sends, capped so one press cannot become a broadcast.
 */

/** The most people one Send reaches. */
export const SHARE_SEND_MAX = 10;

/** What a press on a person did to the selection. */
export interface ToggleResult {
	selected: string[];
	/** Why the person was not added, or `null`. */
	refused: string | null;
}

/** Add or remove one person; adding past {@link SHARE_SEND_MAX} is refused with the reason. */
export function toggleRecipient(
	selected: readonly string[],
	id: string,
	max: number = SHARE_SEND_MAX,
): ToggleResult {
	if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), refused: null };
	if (selected.length >= max) {
		return { selected: [...selected], refused: `Send to up to ${max} people at a time.` };
	}
	return { selected: [...selected, id], refused: null };
}

/**
 * The people a new result set leaves out but the reader has chosen — shown ahead of the results so a
 * selection survives a search. Read only when the results change, so a press never reorders the grid.
 */
export function pinnedPeople(
	results: readonly RankedContact[],
	selected: readonly string[],
	known: ReadonlyMap<string, RankedContact>,
): RankedContact[] {
	const shown = new Set(results.map((r) => r.id));
	return selected
		.filter((id) => !shown.has(id))
		.map((id) => known.get(id))
		.filter((c): c is RankedContact => c !== undefined);
}

/** The commit's label. */
export function sendLabel(count: number): string {
	return `Send to ${count}`;
}

/** Where an arrow key moves focus in a grid of `count` cells, `columns` wide; `null` for other keys. */
export function gridMove(
	index: number,
	key: string,
	count: number,
	columns: number,
): number | null {
	if (count === 0) return null;
	const last = count - 1;
	switch (key) {
		case "ArrowRight":
			return Math.min(last, index + 1);
		case "ArrowLeft":
			return Math.max(0, index - 1);
		case "ArrowDown":
			return Math.min(last, index + columns);
		case "ArrowUp":
			return Math.max(0, index - columns);
		case "Home":
			return 0;
		case "End":
			return last;
		default:
			return null;
	}
}

/** One person's send. */
export interface SendOutcome {
	id: string;
	name: string;
	ok: boolean;
	/** The server's reason when it refused. */
	message: string | null;
}

/** What a send says: a toast once everyone was reached, else the reason and who is left to retry. */
export interface SendSummary {
	sent: string[];
	failed: string[];
	toast: string | null;
	error: string | null;
}

/** Fold the per-person outcomes into what the surface says and keeps. */
export function sendSummary(outcomes: readonly SendOutcome[]): SendSummary {
	const sent = outcomes.filter((o) => o.ok);
	const failed = outcomes.filter((o) => !o.ok);
	const toast = failed.length > 0
		? null
		: sent.length === 1
		? `Sent to ${sent[0].name}`
		: `Sent to ${sent.length} people`;
	const error = failed.length === 0
		? null
		: failed.length === 1
		? failed[0].message ?? `Couldn't reach ${failed[0].name} — try again.`
		: `Couldn't reach ${failed.length} people — try again.`;
	return { sent: sent.map((o) => o.id), failed: failed.map((o) => o.id), toast, error };
}
