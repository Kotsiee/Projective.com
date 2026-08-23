import type { SchedulingSim } from "@projective/types/scheduling";
import { schedulingSimIsEmpty } from "@projective/types/scheduling";
import { IS_DEV } from "@web/utils/dev.ts";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";

/**
 * scheduling-seam — the bridge between the CLIENT-side Dev Context Switcher and this SERVER-derived
 * surface.
 *
 * The switcher publishes its simulated state as `<html data-dev-*>` attributes, which the server
 * cannot see. Every axis the Event Modal branches on is decided by data the SERVER produced — who is
 * seated on an event's roster, what that seat answered, whether a negotiation is open and in which
 * mode — so reading the seam client-side would move nothing on screen. The axes therefore travel as
 * validated QUERY PARAMS on the read, and the fat service applies them as an overlay: the mechanism
 * `/wallet` (Decision #55), `/teams` (#61) and `/files` (#67) all use, for the same reason.
 *
 * Reading or sending the seam grants **no access**. It only changes what the developer's own request
 * is answered with; RLS and the route guard remain the real gates, and the live path ignores the
 * overlay entirely. Every entry point is gated on {@link IS_DEV}, so the module tree-shakes out of
 * production and no `sim*` param is ever appended there.
 */

// #region Transport (re-exported from the SSOT — never reimplemented)
/**
 * The parse and serialise halves live in `@projective/types/scheduling/sim.ts` and are re-exported
 * here so a consumer has one seam import. They are NOT reimplemented locally: a second parser for the
 * same query params is a second place for the param NAMES to drift, at which point the switcher moves
 * an axis the server never reads and the failure looks like the fixture being wrong.
 */
export { schedulingSimFromParams, schedulingSimToQuery } from "@projective/types/scheduling";
// #endregion

// #region Client side
/**
 * The simulation overlay implied by the active dev seam, or `undefined` in production, without a DOM,
 * or when no axis is overridden.
 *
 * Only axes that DIFFER from their switcher default are sent. An overlay that restated the defaults
 * would make every request look simulated and hide which axis is actually being exercised.
 *
 * The 1-on-1 ⁄ group axis is NOT a new control: it reads the existing `serviceType` axis, which
 * already discriminates the three engagement archetypes. A `standard_project` says nothing about how
 * many people are on a given occurrence, so it is deliberately not translated — an event on a
 * stage-based project keeps whatever head count the fixture derived for it.
 */
export function simFromSeam(state?: DevSeamState | null): SchedulingSim | undefined {
	if (!IS_DEV) return undefined;
	const seam = state ?? readDevSeam();
	if (!seam) return undefined;

	const sim: SchedulingSim = {};

	if (seam.eventSeat !== "auto") sim.seat = seam.eventSeat;
	if (seam.eventRsvp !== "auto") sim.rsvp = seam.eventRsvp;
	if (seam.eventReschedule !== "auto") sim.reschedule = seam.eventReschedule;
	if (seam.serviceType === "normal_session") sim.scale = "one_to_one";
	else if (seam.serviceType === "group_session") sim.scale = "group";

	return schedulingSimIsEmpty(sim) ? undefined : sim;
}

/**
 * Subscribe to seam changes, receiving the overlay each change implies.
 *
 * Returns an unsubscribe function; a no-op returning a no-op in production, so no listener is
 * retained there. Consumers **refetch** on each call — the axes are server-derived, so a re-render
 * alone would show the same data with a different label on it, which is worse than not reacting at
 * all.
 */
export function subscribeSchedulingSim(
	fn: (sim: SchedulingSim | undefined) => void,
): () => void {
	if (!IS_DEV) return () => {};
	return subscribeDevSeam((state) => fn(simFromSeam(state)));
}
// #endregion
