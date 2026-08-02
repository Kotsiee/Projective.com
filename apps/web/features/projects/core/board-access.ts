import type { DevSeamState } from "@web/utils/dev-seam.ts";
import { readDevSeam, resolveViewer, watchDevSeam } from "./submission-access.ts";
import { liveSessionKind, type SessionKind } from "./session-model.ts";

/**
 * board-access — the pure, shipping-safe model that resolves what the acting viewer may DO on a
 * board, layering the (DEV-only) Context Switcher override on top of the SSR-resolved baseline.
 *
 * Every ticket surface reads its capabilities from here — the board body, the composer, the detail
 * modal, and the middle-nav footer rig — so a persona flip moves all four together instead of
 * leaving the footer offering an action the body will refuse.
 *
 * The client/provider split is NOT re-derived here: it delegates to the submissions
 * {@link resolveViewer}, which already owns that rule. Two answers to "which side of the market is
 * this person on" is one answer too many, and the board and the Submissions explorer sit one tab
 * apart.
 *
 * Production safety: the override is read exclusively through the {@link IS_DEV}-gated seam, so in
 * production it is always `null` and every resolver degrades to the server's own values. Reading it
 * grants no access — RLS remains the real gate; it only changes what the developer's browser draws.
 */

// #region Access shape
/** What the acting viewer may do with tickets on this board. */
export interface BoardAccess {
	/**
	 * A client-side seat: compose tickets, create stages, move cards on the project pipeline, check
	 * out the basket. The board's primary gate.
	 */
	isClient: boolean;
	/** A provider-side seat: claims and delivers, never composes. */
	isFreelancer: boolean;
	/**
	 * May rewrite a ticket's own content in place (title, description, tasks) from the detail modal.
	 *
	 * Narrower than {@link isClient} on purpose: a project manager can commission work without being
	 * able to silently reword what a freelancer already agreed to deliver. An individual client owns
	 * their project outright, so persona alone settles it there; inside a team or business it takes
	 * ownership or an admin seat.
	 */
	canEditTicket: boolean;
	/**
	 * Whether this engagement has tickets at all. A session is booked, not ticketed (PRODUCT_SPEC
	 * §Sessions), so the composer and the footer's Create Ticket have nothing to act on — the
	 * distinction is "no such thing here", not "you may not".
	 */
	hasTickets: boolean;
}
// #endregion

// #region Resolution
/**
 * Resolve the board's access set from the SSR baseline plus the active override.
 *
 * With no override every value comes from the server: `viewerIsClient` decides both gates (SSR
 * carries no finer signal than "is this the client side"), and the engagement format decides whether
 * tickets exist. With an override the persona/role decide the side of the market, and
 * ownership/admin decides the edit right.
 */
export function resolveBoardAccess(
	args: { viewerIsClient: boolean; sessionKind: SessionKind },
	seam: DevSeamState | null,
): BoardAccess {
	const viewer = resolveViewer(args.viewerIsClient, seam);
	const kind = liveSessionKind(args.sessionKind, seam);
	const hasTickets = kind === "none";

	if (!seam) {
		return {
			isClient: viewer.isReviewer,
			isFreelancer: viewer.isFreelancer,
			canEditTicket: viewer.isReviewer,
			hasTickets,
		};
	}

	// An individual client (or a buyer-only business) owns the engagement outright; inside a team the
	// seat has to earn it.
	const outrightOwner = seam.persona === "client" || seam.persona === "business";
	return {
		isClient: viewer.isReviewer,
		isFreelancer: viewer.isFreelancer,
		canEditTicket: viewer.isReviewer && (outrightOwner || seam.isOwner || seam.role === "admin"),
		hasTickets,
	};
}
// #endregion

export { readDevSeam, watchDevSeam };
export type { DevSeamState };
