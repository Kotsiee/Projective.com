import { z } from "zod";
import { RescheduleStatus, RsvpResponse } from "./coordination.ts";

/**
 * scheduling.sim — the developer SIMULATION overlay for the calendar reads and writes.
 *
 * The Dev Context Switcher is a CLIENT-side seam (`<html data-dev-*>`), so the server cannot see it.
 * Every axis the Event Modal branches on is decided by data the SERVER produced — who is seated on an
 * event's roster, what the acting seat answered, whether a negotiation is open and in which mode — so
 * reading the seam client-side would move nothing on screen. The axes therefore travel as validated
 * QUERY PARAMS on the read (and as a field on the write payload, so a mutation re-resolves the SAME
 * simulated event the surface was showing): the mechanism `/wallet` (root CLAUDE.md §8 Decision #55),
 * `/teams` (#61) and `/files` (#67) all use, for the same reason.
 *
 * It grants **no access**. It only changes what the developer's own request is answered with; the live
 * path ignores it entirely and RLS remains the real gate. Every field is optional — an absent field
 * means "use the real projection", and an overlay that restated the defaults would make every request
 * look simulated and hide which axis is actually being exercised.
 */

// #region Axes
/**
 * Where the acting viewer sits relative to the event.
 *
 * `non_party` is the axis's whole point: it is the only way to reach the withheld projection
 * (`./privacy.ts`) at runtime without signing out, and a signed-out developer cannot reach the
 * authenticated surfaces at all. `host` and `attendee` are the two seats that render different
 * controls — a host approves and opens, an attendee votes and answers.
 */
export const SimEventSeat = z.enum(["host", "attendee", "non_party"]);
export type SimEventSeat = z.infer<typeof SimEventSeat>;

/**
 * How many people the arrangement has, which is what {@link rescheduleModeFor} settles the
 * negotiation MODE from. Expressed as a shape rather than a head count because the modal branches on
 * "vote or confirmation", not on the number — and a count would be inert on a roster the cast is too
 * small to fill.
 */
export const SimEventScale = z.enum(["one_to_one", "group"]);
export type SimEventScale = z.infer<typeof SimEventScale>;

/**
 * The negotiation state to force. Re-uses {@link RescheduleStatus} verbatim rather than declaring a
 * parallel vocabulary — a second enum for the same axis is how a switcher comes to offer a state the
 * service cannot produce.
 */
export const SimEventReschedule = RescheduleStatus;
export type SimEventReschedule = z.infer<typeof SimEventReschedule>;
// #endregion

// #region Overlay
/** The simulation overlay. Every field optional; an absent field uses the real projection. */
export const SchedulingSimSchema = z.object({
	/** Force where the viewer sits — reaches the host controls, the attendee controls, and withholding. */
	seat: SimEventSeat.optional(),
	/** Force the arrangement's shape — reaches the vote branch and the 1-on-1 confirmation branch. */
	scale: SimEventScale.optional(),
	/** Force the negotiation state — reaches every ballot state without waiting on a clock. */
	reschedule: SimEventReschedule.optional(),
	/** Force the acting seat's own answer — reaches all four RSVP states including "no answer yet". */
	rsvp: RsvpResponse.optional(),
});
export type SchedulingSim = z.infer<typeof SchedulingSimSchema>;

/** Whether a simulation overlay asks for anything at all. */
export function schedulingSimIsEmpty(sim: SchedulingSim | undefined): boolean {
	if (!sim) return true;
	return sim.seat === undefined &&
		sim.scale === undefined &&
		sim.reschedule === undefined &&
		sim.rsvp === undefined;
}
// #endregion

// #region Query-param transport
/**
 * Parse an overlay from a request's query string, or `undefined` when none was asked for.
 *
 * Validated through {@link SchedulingSimSchema}, so a hand-crafted URL cannot inject an unvalidated
 * shape. A failed parse yields `undefined` — the real projection — because a malformed simulation
 * should show the truth rather than nothing.
 */
export function schedulingSimFromParams(params: URLSearchParams): SchedulingSim | undefined {
	const raw: Record<string, unknown> = {};
	const seat = params.get("simEventSeat");
	const scale = params.get("simEventScale");
	const reschedule = params.get("simEventReschedule");
	const rsvp = params.get("simEventRsvp");

	if (seat) raw.seat = seat;
	if (scale) raw.scale = scale;
	if (reschedule) raw.reschedule = reschedule;
	if (rsvp) raw.rsvp = rsvp;

	if (Object.keys(raw).length === 0) return undefined;
	const parsed = SchedulingSimSchema.safeParse(raw);
	if (!parsed.success) return undefined;
	return schedulingSimIsEmpty(parsed.data) ? undefined : parsed.data;
}

/**
 * Render an overlay as query params to append to a read.
 *
 * Returns `""` when there is nothing to simulate, so a production request is byte-identical to one
 * from before this seam existed — and otherwise a string with a **leading `&`**, matching the files
 * and workspace seams, because every call site appends it to a read that already carries a scope
 * param (`?projectId=x${schedulingSimToQuery(sim)}`). The separator is part of the returned value on
 * purpose: the alternative silently concatenates onto the previous param when a caller forgets it.
 */
export function schedulingSimToQuery(sim: SchedulingSim | undefined): string {
	if (!sim || schedulingSimIsEmpty(sim)) return "";
	const params = new URLSearchParams();
	if (sim.seat) params.set("simEventSeat", sim.seat);
	if (sim.scale) params.set("simEventScale", sim.scale);
	if (sim.reschedule) params.set("simEventReschedule", sim.reschedule);
	if (sim.rsvp) params.set("simEventRsvp", sim.rsvp);
	const q = params.toString();
	return q ? `&${q}` : "";
}
// #endregion
