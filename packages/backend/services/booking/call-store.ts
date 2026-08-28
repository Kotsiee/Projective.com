import type { CallStatus, CallType } from "@projective/types/scheduling";
import { hash, NOW } from "../scheduling/derive.ts";

/**
 * discovery-call store — the in-module session store behind the Contact menu's "Book a discovery
 * call".
 *
 * The fixture stand-in for `scheduling.discovery_calls`, and it keeps the shape of that table rather
 * than a convenient subset: a request that has not been answered is `proposed`, and only a provider
 * with `autoConfirm` set produces a `confirmed` row. That distinction is the whole reason this is not
 * simply a boolean — the confirmation sentence the buyer reads depends on it, and a surface that said
 * "your call is booked" for an unanswered request is wrong in a way the buyer only discovers when
 * nobody joins.
 *
 * Per-process and unpersisted, like the catalogue and wallet stores before it. The live path replaces
 * this file with an insert through `scheduling.fn_request_discovery_call`, whose in-DB gate enforces
 * the same refusals the service already checks — deliberately, so the pre-flight check and the hard
 * gate cannot drift.
 */

// #region Rows
/** One booking, in the shape `scheduling.discovery_calls` stores it. */
export interface DiscoveryCallRow {
	id: string;
	hostHandle: string;
	requesterId: string;
	/** The listing the call was requested from — context for the host, never a commitment. */
	subjectId: string;
	callType: CallType;
	status: CallStatus;
	proposedStart: number;
	proposedEnd: number;
	confirmedStart: number | null;
	confirmedEnd: number | null;
	requesterTimezone: string;
	agenda: string | null;
	/** The conferencing room, minted only once a call is actually confirmed. */
	meetingUrl: string | null;
	createdAt: number;
}

const calls = new Map<string, DiscoveryCallRow>();
// #endregion

// #region Writes
/** What the service supplies to book a call. */
export interface DiscoveryCallSeed {
	handle: string;
	requesterId: string;
	subjectId: string;
	callType: CallType;
	startsAt: number;
	endsAt: number;
	timezone: string;
	agenda: string | null;
	now?: number;
}

/**
 * Record a discovery-call request.
 *
 * Idempotent on `(host, requester, slot)`: pressing Confirm twice, or retrying after a timeout the
 * client never saw resolve, returns the SAME booking rather than double-booking a provider against
 * themselves. That is the same guard the pipeline draft store carries, for the same reason.
 *
 * `autoConfirm` derives from the host handle so a given provider behaves consistently across a
 * session — a provider whose first call auto-confirmed and whose second sat in `proposed` would look
 * like a bug rather than a setting.
 */
export function requestDiscoveryCall(seed: DiscoveryCallSeed): DiscoveryCallRow {
	const now = seed.now ?? NOW;
	const id = `call-${seed.handle}-${seed.startsAt}`;

	const existing = calls.get(id);
	if (existing && existing.requesterId === seed.requesterId) return existing;

	// Mirrors `scheduling.call_settings.auto_confirm`: a request inside a published call window is
	// accepted outright rather than waiting on the host.
	const autoConfirm = hash(`autoconfirm:${seed.handle}`) % 2 === 0;

	const row: DiscoveryCallRow = {
		id,
		hostHandle: seed.handle,
		requesterId: seed.requesterId,
		subjectId: seed.subjectId,
		callType: seed.callType,
		status: autoConfirm ? "confirmed" : "proposed",
		proposedStart: seed.startsAt,
		proposedEnd: seed.endsAt,
		confirmedStart: autoConfirm ? seed.startsAt : null,
		confirmedEnd: autoConfirm ? seed.endsAt : null,
		requesterTimezone: seed.timezone,
		agenda: seed.agenda,
		/*
		 * The room is minted on CONFIRMATION, never on request.
		 *
		 * A join link handed out for a call the host has not accepted is a link to a meeting that may
		 * never happen — and, worse, one the buyer will put in their calendar and turn up to.
		 */
		meetingUrl: autoConfirm ? `https://meet.projective.example/${id}` : null,
		createdAt: now,
	};
	calls.set(id, row);
	return row;
}
// #endregion

// #region Reads
/** Every call this requester has with this host, newest first. */
export function listCalls(handle: string, requesterId: string): DiscoveryCallRow[] {
	return [...calls.values()]
		.filter((c) => c.hostHandle === handle && c.requesterId === requesterId)
		.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The instants this requester already holds with this host, so the picker can mark them.
 *
 * Terminal statuses are excluded: a cancelled call does not hold a slot, and showing it as held would
 * stop the buyer rebooking a time that is genuinely free.
 */
export function heldSlots(handle: string, requesterId: string): number[] {
	return listCalls(handle, requesterId)
		.filter((c) => c.status === "proposed" || c.status === "confirmed")
		.map((c) => c.confirmedStart ?? c.proposedStart);
}
// #endregion
