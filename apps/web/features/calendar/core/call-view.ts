import {
	type CalendarEvent,
	type CallMove,
	type CallSide,
	type CallStatus,
	RESCHEDULE_LOCKOUT_HOURS,
} from "@projective/types/scheduling";
import type { DevDiscoveryCall } from "@web/utils/dev-seam.ts";

/**
 * call-view — where a discovery call stands for the person looking at it, and the one thing to know
 * before they press anything.
 *
 * The moves themselves come from the server's read ({@link CalendarEvent.callMoves}); this only words
 * them, so the modal states the lockout before the press rather than after it. The Dev Context
 * Switcher's `discoveryCall` axis replaces the read's answer here, in the browser, and every door
 * still judges the move.
 */

/** What the modal draws for a call. */
export interface CallView {
	status: CallStatus;
	side: CallSide;
	moves: CallMove[];
	/** One line beside the actions, or `null` when there is nothing to add. */
	note: string | null;
}

/** The simulated answer for each state of the `discoveryCall` axis. */
const DEV_CALLS: Record<Exclude<DevDiscoveryCall, "auto">, Omit<CallView, "note">> = {
	proposed_host: { status: "proposed", side: "host", moves: ["confirm", "propose", "decline"] },
	proposed_requester: { status: "proposed", side: "requester", moves: ["propose", "cancel"] },
	confirmed: { status: "confirmed", side: "requester", moves: ["propose", "cancel"] },
	no_show_claimable: { status: "confirmed", side: "host", moves: ["cancel", "no_show"] },
	expired: { status: "expired", side: "requester", moves: [] },
};

function noteFor(view: Omit<CallView, "note">, passed: boolean): string | null {
	const { status, moves } = view;
	if (status === "proposed") {
		if (moves.includes("confirm")) return "Confirm this time, or offer another.";
		return passed ? null : "Waiting for the other person to confirm.";
	}
	if (status === "confirmed") {
		if (moves.includes("no_show")) return "If they have not joined, you can report a no-show.";
		if (moves.includes("propose")) {
			return `A new time needs at least ${RESCHEDULE_LOCKOUT_HOURS} hours' notice.`;
		}
		if (moves.includes("cancel")) {
			return `Too close to move: under ${RESCHEDULE_LOCKOUT_HOURS} hours away.`;
		}
		return null;
	}
	if (status === "expired") return "This request expired before anyone confirmed it.";
	return null;
}

/** The view of a call, or `null` for an event that is not one. */
export function callViewOf(
	event: CalendarEvent,
	dev: DevDiscoveryCall,
	nowMs: number,
): CallView | null {
	if (!event.callId || !event.callStatus || !event.callSide) return null;
	const view: Omit<CallView, "note"> = dev === "auto"
		? { status: event.callStatus, side: event.callSide, moves: event.callMoves ?? [] }
		: DEV_CALLS[dev];
	return { ...view, note: noteFor(view, nowMs >= event.start) };
}
