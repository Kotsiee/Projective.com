import { z } from "zod";

/**
 * services.sim — the developer SIMULATION overlay for the service booking surfaces.
 *
 * The Dev Context Switcher is a CLIENT seam (`<html data-dev-*>`), which the server cannot see. Every
 * axis the booking CTAs branch on is decided by data the SERVER produced — whether this seller takes
 * discovery calls, how many cohort seats are left, whether this buyer already has a draft — so
 * reading the seam client-side would move nothing on screen. The axes therefore travel as validated
 * query params on the read, and the fat service applies them as an overlay: the mechanism `/wallet`
 * (Decision #55), `/teams` (#61), `/files` (#67) and `/checkout` (#70) all use, for the same reason.
 *
 * It grants **no access**. It changes only what the developer's own request is answered with; the
 * live path ignores it entirely and RLS remains the real gate. Every field is optional — an absent
 * field means "use the real projection", and an overlay that restated the defaults would make every
 * request look simulated and hide which axis is actually being exercised.
 */

// #region Axes
/**
 * What the seller offers by way of a pre-purchase call.
 *
 * `none` is the axis's whole point: it is the only way to reach the popover's two-row form, where the
 * discovery-call row is ABSENT rather than disabled — the state that is easiest to get wrong and
 * hardest to notice, because the three-row version looks fine.
 */
export const SimCallOffer = z.enum(["courtesy", "paid", "both", "none"]);
export type SimCallOffer = z.infer<typeof SimCallOffer>;

/**
 * Where a cohort sits against its capacity.
 *
 * `last_seat` is separate from `open` because the copy differs at one (`1 spot left`, not `1 spots
 * left`) and because it is the only state in which the urgency reads as true rather than as pressure.
 * `full` reaches the disabled "Cohort full" primary.
 */
export const SimCohortCapacity = z.enum(["open", "last_seat", "full"]);
export type SimCohortCapacity = z.infer<typeof SimCohortCapacity>;

/**
 * Whether this buyer already instantiated the pipeline.
 *
 * `exists` reaches "Open Project →" plus the archive control; `stale` reaches a draft already past
 * its 30-day idle window, which is the state the sweep acts on and which no fixture clock will ever
 * produce on its own.
 */
export const SimPipelineDraft = z.enum(["none", "exists", "stale"]);
export type SimPipelineDraft = z.infer<typeof SimPipelineDraft>;

/**
 * How much availability the provider is publishing.
 *
 * `sparse` is the picker's honest worst case — a rail whose visible fortnight has one open day — and
 * `none` reaches the closed state, which must explain itself rather than render an empty rail.
 */
export const SimAvailability = z.enum(["open", "sparse", "none"]);
export type SimAvailability = z.infer<typeof SimAvailability>;
// #endregion

// #region Overlay
/** The simulation overlay. Every field optional; an absent field uses the real projection. */
export const ServiceSimSchema = z.object({
	/** Force the seller's discovery-call offer — reaches all four Contact-menu shapes. */
	callOffer: SimCallOffer.optional(),
	/** Force the cohort's seat position — reaches the last-seat copy and the refused primary. */
	cohortCapacity: SimCohortCapacity.optional(),
	/** Force the buyer's draft state — reaches "Open Project →", the archive control, and the sweep. */
	pipelineDraft: SimPipelineDraft.optional(),
	/** Force how much availability the slot grid finds — reaches sparse and closed. */
	availability: SimAvailability.optional(),
});
export type ServiceSim = z.infer<typeof ServiceSimSchema>;

/** Whether an overlay asks for anything at all. */
export function serviceSimIsEmpty(sim: ServiceSim | undefined): boolean {
	if (!sim) return true;
	return sim.callOffer === undefined &&
		sim.cohortCapacity === undefined &&
		sim.pipelineDraft === undefined &&
		sim.availability === undefined;
}
// #endregion

// #region Query-param transport
/**
 * Parse an overlay from a request's query string, or `undefined` when none was asked for.
 *
 * Validated through {@link ServiceSimSchema}, so a hand-crafted URL cannot inject an unvalidated
 * shape. A failed parse yields `undefined` — the real projection — because a malformed simulation
 * should show the truth rather than nothing.
 */
export function serviceSimFromParams(params: URLSearchParams): ServiceSim | undefined {
	const raw: Record<string, unknown> = {};
	const callOffer = params.get("simCallOffer");
	const cohortCapacity = params.get("simCohortCapacity");
	const pipelineDraft = params.get("simPipelineDraft");
	const availability = params.get("simAvailability");

	if (callOffer) raw.callOffer = callOffer;
	if (cohortCapacity) raw.cohortCapacity = cohortCapacity;
	if (pipelineDraft) raw.pipelineDraft = pipelineDraft;
	if (availability) raw.availability = availability;

	if (Object.keys(raw).length === 0) return undefined;
	const parsed = ServiceSimSchema.safeParse(raw);
	if (!parsed.success) return undefined;
	return serviceSimIsEmpty(parsed.data) ? undefined : parsed.data;
}

/**
 * Render an overlay as query params to append to a read.
 *
 * Returns `""` when there is nothing to simulate, so a production request is byte-identical to one
 * from before this seam existed — and otherwise a string with a **leading `&`**, matching the
 * scheduling, files and workspace seams, because every call site appends it to a read that already
 * carries a scope param. The separator is part of the returned value on purpose: the alternative
 * silently concatenates onto the previous param when a caller forgets it.
 */
export function serviceSimToQuery(sim: ServiceSim | undefined): string {
	if (!sim || serviceSimIsEmpty(sim)) return "";
	const params = new URLSearchParams();
	if (sim.callOffer) params.set("simCallOffer", sim.callOffer);
	if (sim.cohortCapacity) params.set("simCohortCapacity", sim.cohortCapacity);
	if (sim.pipelineDraft) params.set("simPipelineDraft", sim.pipelineDraft);
	if (sim.availability) params.set("simAvailability", sim.availability);
	const q = params.toString();
	return q ? `&${q}` : "";
}
// #endregion
