import type { CohortListingOffer, SessionOffer } from "@projective/types/catalogue";
import { type BlueprintSessionPlanEntry, SESSION_PLAN_MAX } from "@projective/types/explore";
import type { WeeklySessionTemplate } from "@projective/types/projects";

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

/**
 * The offer with its sittings given lengths of their own (SC10), each starting at the listing's length
 * (at least 15 minutes), or back to one length for all. Lengths of their own are sold by the hour, so
 * switching them on prices the listing per hour; switching them off leaves the unit as it was.
 */
export function withVariableLengths<T extends TimedOffer>(offer: T, on: boolean): T {
	const start = Math.max(15, offer.minutes);
	const plan = planRows(offer).map(({ durationMinutes, ...rest }) =>
		on ? { ...rest, durationMinutes: durationMinutes ?? start } : rest
	);
	return on ? { ...offer, pricingUnit: "per_hour", plan } : { ...offer, plan };
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

// #region Rolling weekly templates (SC11)
/** ISO weekdays in order, Monday first, as the weekday Select offers them. */
export const WEEKDAYS = [
	{ value: 1, label: "Monday" },
	{ value: 2, label: "Tuesday" },
	{ value: 3, label: "Wednesday" },
	{ value: 4, label: "Thursday" },
	{ value: 5, label: "Friday" },
	{ value: 6, label: "Saturday" },
	{ value: 7, label: "Sunday" },
] as const;

/** Where a new listing's first weekly template starts: Monday at 18:00. */
const FIRST_TEMPLATE: WeeklySessionTemplate = { weekday: 1, startMinute: 18 * 60 };

/**
 * A rolling schedule's templates, one per sitting by position: the stored ones, then for each sitting
 * without one the day after the template before it at the same time, so a new row is never blank.
 */
export function templateRows(
	templates: readonly WeeklySessionTemplate[],
	count: number,
): WeeklySessionTemplate[] {
	const rows: WeeklySessionTemplate[] = [];
	for (let k = 0; k < count; k++) {
		const prev = rows[k - 1];
		rows.push(
			templates[k] ??
				(prev
					? { weekday: (prev.weekday % 7) + 1, startMinute: prev.startMinute }
					: FIRST_TEMPLATE),
		);
	}
	return rows;
}

/** The templates with sitting `index`'s changed. */
export function withTemplate(
	templates: readonly WeeklySessionTemplate[],
	count: number,
	index: number,
	patch: Partial<WeeklySessionTemplate>,
): WeeklySessionTemplate[] {
	const rows = templateRows(templates, count);
	if (index >= 0 && index < count) rows[index] = { ...rows[index], ...patch };
	return rows;
}

/** The templates after sitting `from` moves to `to`: a time travels with its session, like its title. */
export function withTemplateMoved(
	templates: readonly WeeklySessionTemplate[],
	count: number,
	from: number,
	to: number,
): WeeklySessionTemplate[] {
	const rows = templateRows(templates, count);
	if (from === to || from < 0 || to < 0 || from >= count || to >= count) return rows;
	const [moved] = rows.splice(from, 1);
	rows.splice(to, 0, moved);
	return rows;
}

/** The templates without sitting `index`'s. */
export function withTemplateRemoved(
	templates: readonly WeeklySessionTemplate[],
	count: number,
	index: number,
): WeeklySessionTemplate[] {
	const rows = templateRows(templates, count);
	if (index >= 0 && index < count) rows.splice(index, 1);
	return rows;
}
// #endregion
