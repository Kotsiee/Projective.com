import type { ConversationSummary } from "../types/messaging-types.ts";
import { RELATION_LABEL } from "./conversation-model.ts";

/**
 * inbox-model — the pure, DOM-free model behind the `/messages` body inbox. It owns the day-bucket
 * grouping that gives the list vertical landmarks, and the context line that finally renders the
 * engagement data every conversation already carries (`serviceName` / `productName` / `entityName` /
 * `relation`) but which the 234px lane row had no room to show.
 *
 * Kept side-effect-free so SSR and the hydrated island bucket identically — the row's own timestamp
 * label is pre-formatted server-side (`lastActivityLabel`), and the bucket boundary is computed from
 * the raw ISO `updatedAt` against a caller-supplied "now", never `Date.now()` inside a render.
 */

// #region Day buckets
/** A labelled run of conversations sharing one day bucket. */
export interface InboxGroup {
	key: string;
	label: string;
	items: ConversationSummary[];
}

const DAY_MS = 86_400_000;

/** Midnight (local) for a date, as an epoch — the bucket boundary. */
function startOfDay(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Bucket a recency-sorted list into Today · Yesterday · This week · Earlier. Four buckets, not one per
 * calendar day: a landmark the eye can count beats a header above every second row.
 */
export function groupByDay(
	list: readonly ConversationSummary[],
	now: Date = new Date(),
): InboxGroup[] {
	const today = startOfDay(now);
	const buckets: InboxGroup[] = [
		{ key: "today", label: "Today", items: [] },
		{ key: "yesterday", label: "Yesterday", items: [] },
		{ key: "week", label: "Earlier this week", items: [] },
		{ key: "older", label: "Older", items: [] },
	];

	for (const c of list) {
		const t = Date.parse(c.updatedAt);
		if (Number.isNaN(t)) {
			buckets[3].items.push(c);
			continue;
		}
		const day = startOfDay(new Date(t));
		if (day >= today) buckets[0].items.push(c);
		else if (day >= today - DAY_MS) buckets[1].items.push(c);
		else if (day > today - 7 * DAY_MS) buckets[2].items.push(c);
		else buckets[3].items.push(c);
	}

	return buckets.filter((b) => b.items.length > 0);
}
// #endregion

// #region Context line
/**
 * The one-line engagement context for a row — what the conversation is *about*, which is the column
 * the narrow lane row could never afford. Prefers the most specific reference (a service or product
 * inquiry), falls back to the owning team/business, then to the bare relation.
 */
export function contextLabel(c: ConversationSummary): string | null {
	if (c.serviceName) return c.serviceName;
	if (c.productName) return c.productName;
	if (c.entityName) return c.entityName;
	const relation = RELATION_LABEL[c.relation];
	return relation === "Direct message" ? null : relation;
}

/** Whether the context line points at a specific offering (styled as a reference, not a role). */
export function contextIsOffering(c: ConversationSummary): boolean {
	return Boolean(c.serviceName || c.productName);
}
// #endregion

// #region Preview
/**
 * Split a preview into its speaker prefix and the message itself. The fixtures prefix `"You: "` or
 * `"Name: "`, and at lane width that prefix was consuming most of the visible characters — separating
 * it lets the body de-emphasise the speaker and give the full width to the words that differ.
 */
export function splitPreview(preview: string): { speaker: string | null; body: string } {
	const at = preview.indexOf(": ");
	if (at > 0 && at <= 24) {
		return { speaker: preview.slice(0, at), body: preview.slice(at + 2) };
	}
	return { speaker: null, body: preview };
}
// #endregion
