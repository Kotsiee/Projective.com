import type {
	EngagementKind,
	FairExitTier,
	ProjectViewerRole,
	ServiceCancelBlocked,
	ServiceCancelPreview,
	ServiceCancelStage,
	ServiceExitQuote,
} from "../types/projects-types.ts";
import { DEFAULT_FAIR_EXIT_TIER } from "./fair-exit-model.ts";

/**
 * service-cancel-model — the pure decisions behind the Cancel service confirmation (Decision #456):
 * the tier each stage holding claimed work is on, the quote it shows, what a blocked service says, and
 * when the confirm may fire. Every figure arrives from the server; nothing here computes money.
 */

/** The tier chosen for each stage holding claimed work, keyed by the stage's uuid. */
export type ServiceCancelTiers = Readonly<Record<string, FairExitTier>>;

/**
 * The viewer's role toward a bought service, with the Dev Context Switcher's simulated side (the
 * seam's `serviceSide`, passed in so this module stays free of the seam) standing in for the server's
 * answer: its client is `client`, its provider `freelancer`. Anything but a service, and `auto`, keep
 * the server's role.
 */
export function effectiveServiceRole(
	kind: EngagementKind,
	role: ProjectViewerRole,
	side: string | null | undefined,
): ProjectViewerRole {
	if (kind !== "service") return role;
	if (side === "client") return "client";
	if (side === "provider") return "freelancer";
	return role;
}

/** Every listed stage opens on the middle tier, like a single-stage Fair Exit. */
export function defaultServiceCancelTiers(
	preview: ServiceCancelPreview | null,
): ServiceCancelTiers {
	const tiers: Record<string, FairExitTier> = {};
	for (const stage of preview?.stages ?? []) tiers[stage.stageId] = DEFAULT_FAIR_EXIT_TIER;
	return tiers;
}

/** The quote a stage settles at its chosen tier, or null when it has none chosen or quoted. */
export function stageQuoteFor(
	stage: ServiceCancelStage,
	tiers: ServiceCancelTiers,
): ServiceExitQuote | null {
	const tier = tiers[stage.stageId];
	if (tier === undefined) return null;
	return stage.tiers.find((q) => q.tier === tier) ?? null;
}

/** Why the service cannot be cancelled now, in words for its client. */
export function serviceCancelBlockedText(blocked: ServiceCancelBlocked): string {
	return blocked === "ended"
		? "This service has already ended, so there is nothing left to cancel."
		: "A stage is being paid out right now. Try again once that settles.";
}

/** The meta line under the figures: what else cancelling does. */
export function serviceCancelConsequences(preview: ServiceCancelPreview): string[] {
	const lines: string[] = [];
	if (preview.ticketsToCancel === 1) lines.push("1 open ticket will be cancelled");
	else if (preview.ticketsToCancel > 1) {
		lines.push(`${preview.ticketsToCancel} open tickets will be cancelled`);
	}
	lines.push("this cannot be undone");
	return lines;
}

/** The confirm fires only on a cancellable preview, with a quoted tier on every listed stage. */
export function canConfirmServiceCancel(
	preview: ServiceCancelPreview | null,
	tiers: ServiceCancelTiers,
	busy: boolean,
): boolean {
	if (busy || !preview || !preview.cancellable) return false;
	return preview.stages.every((stage) => stageQuoteFor(stage, tiers) !== null);
}
