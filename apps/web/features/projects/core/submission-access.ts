import {
	type DevSeamState,
	type DevSubmissionState,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";
import type { ProjectFormat, SubmissionStatus } from "../types/projects-types.ts";

/**
 * submission-access — the pure, shipping-safe model that resolves the SUBMISSIONS workflow's effective
 * viewer + state, layering the (DEV-only) Context Switcher overrides on top of the real SSR-resolved
 * baseline. Every submissions surface — the channel-header tabs, the crumb-bar action state machine, the
 * footer Tasks toggle, the create/pre-submit modals — reads its capabilities from here so they all agree
 * and all live-update the same way when the developer flips a persona/state (root task §7).
 *
 * Production safety: it reads the override exclusively through {@link readDevSeam} /
 * {@link subscribeDevSeam} (both {@link IS_DEV}-gated in `@web/utils/dev-seam.ts`), so in production the
 * seam is always `null` and every resolver degrades to the real SSR values — the overrides are a
 * dev-time simulation layer only, and reading them grants no access (RLS remains the real gate). It
 * imports NO dev-tools code (a direct import would drag the build-excluded devtools into the bundle).
 */

// #region Effective viewer
/**
 * The acting viewer's coarse submission capability. A **reviewer** (client / admin / manager) sees every
 * submitter's work and reviews it; a **freelancer** sees ONLY their own and drives the create/submit
 * flow. `stageAssigned` gates a freelancer's access to a specific stage's tabs (Stage Access rule).
 */
export interface EffectiveViewer {
	/** Client / project owner / admin / manager — sees all submissions, reviews them. */
	isReviewer: boolean;
	/** Provider-side submitter — sees only their own submissions. */
	isFreelancer: boolean;
	/** For a freelancer, whether they are assigned to the active stage. */
	stageAssigned: boolean;
}

/**
 * Resolve the effective viewer. Without an override it is the real session: `viewerIsClient` → reviewer,
 * else freelancer (a real freelancer is always assigned to a stage they can open). With an override the
 * persona/role decide: `client`/`business`, and a `team` `admin`/`manager`, review; a `freelancer`, and a
 * `team` `worker`/`guest`, submit — and the freelancer's stage assignment is the simulated flag.
 */
export function resolveViewer(viewerIsClient: boolean, seam: DevSeamState | null): EffectiveViewer {
	if (!seam) {
		return { isReviewer: viewerIsClient, isFreelancer: !viewerIsClient, stageAssigned: true };
	}
	const isFreelancer = seam.persona === "freelancer" ||
		(seam.persona === "team" && (seam.role === "worker" || seam.role === "guest"));
	return {
		isReviewer: !isFreelancer,
		isFreelancer,
		stageAssigned: seam.stageAssignment === "assigned",
	};
}
// #endregion

// #region Effective state derivations
/** The effective engagement delivery format — the override wins, else the SSR-resolved format. */
export function effectiveFormat(format: ProjectFormat, seam: DevSeamState | null): ProjectFormat {
	return seam ? seam.projectType : format;
}

/** Whether the current engagement fulfils tickets (a create-modal ticket dropdown) — non-one-off. */
export function fulfilsTickets(format: ProjectFormat): boolean {
	return format !== "one_off";
}

/** Whether the client has defined stage/ticket tasks — the override wins, else the SSR baseline. */
export function effectiveHasTasks(baseHasTasks: boolean, seam: DevSeamState | null): boolean {
	return seam ? seam.hasTasks : baseHasTasks;
}

/** Map the dev submission-state override onto the canonical {@link SubmissionStatus}. */
export function mapDevSubmissionStatus(state: DevSubmissionState): SubmissionStatus {
	switch (state) {
		case "submitted":
			return "pending_review";
		case "approved":
			return "accepted";
		case "revision_requested":
			return "revision_requested";
		default:
			return "draft";
	}
}

/**
 * The effective status of the active submission unit. For a freelancer under an active override the
 * simulated submission state wins (so flipping it live re-drives the action state machine); otherwise
 * the unit's real status (or `null` when no unit is in view).
 */
export function effectiveUnitStatus(
	unitStatus: SubmissionStatus | null,
	viewer: EffectiveViewer,
	seam: DevSeamState | null,
): SubmissionStatus | null {
	if (seam && viewer.isFreelancer) return mapDevSubmissionStatus(seam.submissionState);
	return unitStatus;
}
// #endregion

// #region Action state machine
/**
 * The action controls to render between the breadcrumbs and the footer (root task §3), resolved from the
 * effective viewer + whether a submission unit is entered + its effective status. Exactly one of the
 * action groups is active at a time — a clean state machine.
 */
export interface WorkflowActions {
	/** Reviewer viewing a submitted item → "Review Submission". */
	review: boolean;
	/** Freelancer at the root (no active submission) → "Create New Submission". */
	create: boolean;
	/** Freelancer inside an unsubmitted draft → Upload · Delete · Submit for Review. */
	draftEdit: boolean;
	/** Freelancer inside a submitted unit → the read-only status badge (its status), else `null`. */
	statusBadge: SubmissionStatus | null;
}

/** Resolve the active action group (root task §3 state machine). */
export function resolveWorkflowActions(args: {
	viewer: EffectiveViewer;
	hasActiveUnit: boolean;
	effectiveStatus: SubmissionStatus | null;
}): WorkflowActions {
	const { viewer, hasActiveUnit, effectiveStatus } = args;
	const none: WorkflowActions = {
		review: false,
		create: false,
		draftEdit: false,
		statusBadge: null,
	};

	if (viewer.isReviewer) {
		// A reviewer reviews a SUBMITTED item — never a bare draft (nothing to review yet).
		return { ...none, review: hasActiveUnit && !!effectiveStatus && effectiveStatus !== "draft" };
	}
	// Freelancer.
	if (!hasActiveUnit) return { ...none, create: true };
	if (!effectiveStatus || effectiveStatus === "draft") return { ...none, draftEdit: true };
	return { ...none, statusBadge: effectiveStatus };
}
// #endregion

// #region Reactive helper
/**
 * Read the current override snapshot (or `null`), and subscribe to changes — the small ceremony every
 * submissions island repeats. The callback fires on every `pj:devcontext` change so the island can
 * recompute its capabilities live. Returns an unsubscribe. No-op / `null` in production.
 */
export function watchDevSeam(onChange: (seam: DevSeamState | null) => void): () => void {
	return subscribeDevSeam(onChange);
}

export { readDevSeam };
export type { DevSeamState };
// #endregion
