import type { CohortListingOffer, SessionOffer } from "@projective/types/catalogue";
import { type BlueprintSessionPlanEntry, SESSION_PLAN_MAX } from "@projective/types/explore";

/**
 * plan-model — the pure rules under the session plan (`/catalogue/[id]/plan`, Decision #525): one
 * row per sitting, positional (row 1 is session 1), added, removed, reordered and written without
 * ever letting a description slide onto another sitting. The offer's `count` is the number of rows;
 * its `plan` is what was written for them, cut to the count when it is saved (`normaliseSessionPlan`).
 */

/** A session offer, one-to-one or group. */
export type TimedOffer = SessionOffer | CohortListingOffer;

const BLANK: BlueprintSessionPlanEntry = { title: "", description: "" };

/** The fewest sittings a booking holds. */
export const SESSIONS_MIN = 1;

/** Whether the offer has a plan at all: an ongoing one-to-one listing is booked a sitting at a time. */
export function hasPlan(offer: TimedOffer): boolean {
	return !(offer.archetype === "session" && offer.rolling);
}

/** One entry per sitting, blank where nothing has been written yet. */
export function planRows(offer: Pick<TimedOffer, "count" | "plan">): BlueprintSessionPlanEntry[] {
	return Array.from({ length: offer.count }, (_, i) => offer.plan[i] ?? BLANK);
}

/** Whether another sitting fits. */
export function canAddSession(offer: Pick<TimedOffer, "count">): boolean {
	return offer.count < SESSION_PLAN_MAX;
}

/** The offer with one more sitting at the end, blank. */
export function withSessionAdded<T extends TimedOffer>(offer: T): T {
	if (!canAddSession(offer)) return offer;
	return { ...offer, count: offer.count + 1, plan: planRows(offer) };
}

/** The offer without sitting `index`; the ones after it move up. The last sitting stays. */
export function withSessionRemoved<T extends TimedOffer>(offer: T, index: number): T {
	if (offer.count <= SESSIONS_MIN || index < 0 || index >= offer.count) return offer;
	const rows = planRows(offer);
	rows.splice(index, 1);
	return { ...offer, count: offer.count - 1, plan: rows };
}

/** The offer with sitting `from` moved to position `to`, its title and description with it. */
export function withSessionMoved<T extends TimedOffer>(offer: T, from: number, to: number): T {
	if (from === to || from < 0 || to < 0 || from >= offer.count || to >= offer.count) return offer;
	const rows = planRows(offer);
	const [moved] = rows.splice(from, 1);
	rows.splice(to, 0, moved);
	return { ...offer, plan: rows };
}

/** The offer with sitting `index`'s title or description changed. */
export function withSessionEntry<T extends TimedOffer>(
	offer: T,
	index: number,
	patch: Partial<BlueprintSessionPlanEntry>,
): T {
	if (index < 0 || index >= offer.count) return offer;
	const rows = planRows(offer);
	rows[index] = { ...rows[index], ...patch };
	return { ...offer, plan: rows };
}

/**
 * The plan as one meta line's parts, for the Offer section's summary: the sitting count, then how
 * many of them say what they cover (`["4 sessions", "3 planned"]`), or that none does yet.
 */
export function planSummary(offer: Pick<TimedOffer, "count" | "plan">): string[] {
	const sittings = `${offer.count} ${offer.count === 1 ? "session" : "sessions"}`;
	const planned = planRows(offer).filter((r) => r.title.trim() || r.description.trim()).length;
	if (planned === 0) return [sittings, "Not planned yet"];
	if (planned === offer.count) return [sittings, "Each one planned"];
	return [sittings, `${planned} planned`];
}
