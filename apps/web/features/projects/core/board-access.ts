import type { DevSeamState } from "@web/utils/dev-seam.ts";
import { canAddStage, type EngagementKind } from "@projective/types/projects";
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
	/**
	 * For a provider-side seat: whether the viewer is onboarded to the stages in view. With no
	 * override this is always `true` and the SERVER's `viewerStageIds` decide which stages; under the
	 * Dev Context Switcher the simulated `stageAssignment` flag stands in for that list (assigned →
	 * every stage, unassigned → none), because the seam is a client surface the server cannot see.
	 */
	stageAssigned: boolean;
	/** Whether an override is active — the board reads the seam's answer instead of the server's list. */
	simulated: boolean;
	/**
	 * May add a stage ({@link canAddStage}, Decision #421): the client side on a client project, a
	 * freelancer seated on it on a service the client bought. Every Add stage control reads this.
	 */
	canAddStage: boolean;
}

/** The server's answers the access set is resolved from. */
export interface BoardAccessBaseline {
	viewerIsClient: boolean;
	sessionKind: SessionKind;
	/** Who architected the engagement (`BoardPage.engagementKind`). */
	engagementKind: EngagementKind;
	/** Whether the server onboarded this viewer to any stage (`BoardPage.viewerStageIds`). */
	viewerSeated: boolean;
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
	args: BoardAccessBaseline,
	seam: DevSeamState | null,
): BoardAccess {
	const viewer = resolveViewer(args.viewerIsClient, seam);
	const kind = liveSessionKind(args.sessionKind, seam);
	const hasTickets = kind === "none";
	const engagementKind = seam && seam.engagementOrigin !== "auto"
		? seam.engagementOrigin
		: args.engagementKind;
	const stageAuthor = canAddStage({
		kind: engagementKind,
		viewerIsClient: viewer.isReviewer,
		viewerIsSeatedProvider: viewer.isFreelancer &&
			(seam ? viewer.stageAssigned : args.viewerSeated),
	});

	if (!seam) {
		return {
			isClient: viewer.isReviewer,
			isFreelancer: viewer.isFreelancer,
			canEditTicket: viewer.isReviewer,
			hasTickets,
			stageAssigned: viewer.stageAssigned,
			simulated: false,
			canAddStage: stageAuthor,
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
		stageAssigned: viewer.stageAssigned,
		simulated: true,
		canAddStage: stageAuthor,
	};
}
// #endregion

export { readDevSeam, watchDevSeam };
export type { DevSeamState };
