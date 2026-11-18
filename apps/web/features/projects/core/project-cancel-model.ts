import type {
	EngagementKind,
	FairExitTier,
	ProjectCancelBlocked,
	ProjectCancelPreview,
	ProjectCancelStage,
	ProjectExitQuote,
	ProjectViewerRole,
} from "../types/projects-types.ts";
import { DEFAULT_FAIR_EXIT_TIER } from "./fair-exit-model.ts";

/**
 * project-cancel-model — the pure decisions behind the one Cancel confirmation, for a client's brief
 * and a bought service alike (Decisions #456, #467): the tier each stage holding claimed work is on,
 * the quote it shows, what a blocked engagement says, whether cancelling moves money (which picks the
 * commit's tier), and when the confirm may fire. Every figure arrives from the server; nothing here
 * computes money.
 */

/** The tier chosen for each stage holding claimed work, keyed by the stage's uuid. */
export type ProjectCancelTiers = Readonly<Record<string, FairExitTier>>;

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

/** The words the dialog uses for an engagement of this kind. */
export interface ProjectCancelCopy {
	/** `project` for a brief, `service` for a bought engagement. */
	noun: "project" | "service";
	/** The dialog's header. */
	header: string;
	/** The escape hatch, which holds initial focus. */
	keep: string;
	/** The commit when nothing is held: a plain, irreversible cancel. */
	commit: string;
	/** The commit when cancelling moves money: it settles before it cancels. */
	settleCommit: string;
}

/** The dialog's words for a brief or a bought service. */
export function projectCancelCopy(kind: EngagementKind): ProjectCancelCopy {
	const noun = kind === "service" ? "service" : "project";
	return {
		noun,
		header: `Cancel this ${noun}?`,
		keep: `Keep ${noun}`,
		commit: `Cancel ${noun}`,
		settleCommit: "Settle and cancel",
	};
}

/** Every listed stage opens on the middle tier, like a single-stage Fair Exit. */
export function defaultProjectCancelTiers(
	preview: ProjectCancelPreview | null,
): ProjectCancelTiers {
	const tiers: Record<string, FairExitTier> = {};
	for (const stage of preview?.stages ?? []) tiers[stage.stageId] = DEFAULT_FAIR_EXIT_TIER;
	return tiers;
}

/** The quote a stage settles at its chosen tier, or null when it has none chosen or quoted. */
export function stageQuoteFor(
	stage: ProjectCancelStage,
	tiers: ProjectCancelTiers,
): ProjectExitQuote | null {
	const tier = tiers[stage.stageId];
	if (tier === undefined) return null;
	return stage.tiers.find((q) => q.tier === tier) ?? null;
}

/**
 * Whether cancelling moves money: something comes back at once, or a stage holding claimed work
 * settles. It decides the commit's weight — the tier-1 accent pill only for a commit that moves money
 * (DESIGN_SYSTEM §B.8.1); a cancel that moves nothing stays a plain destructive confirm.
 */
export function projectCancelMovesMoney(preview: ProjectCancelPreview | null): boolean {
	if (!preview || !preview.cancellable) return false;
	return preview.returnedCents > 0 || preview.stages.length > 0;
}

/** Why the engagement cannot be cancelled now, in words for its client. */
export function projectCancelBlockedText(
	blocked: ProjectCancelBlocked,
	kind: EngagementKind = "project",
): string {
	const noun = kind === "service" ? "service" : "project";
	switch (blocked) {
		case "ended":
			return `This ${noun} has already ended, so there is nothing left to cancel.`;
		case "dispute":
			return `A dispute is open on money this ${noun} holds. Its ruling pays or refunds that money; cancel once it is resolved.`;
		case "sittings":
			return `This ${noun} holds money for booked sittings, which settle sitting by sitting. Settle or refund them first.`;
		case "settling":
			return "A stage is being paid out right now. Try again once that settles.";
	}
}

/** The meta line under the figures: what else cancelling does. */
export function projectCancelConsequences(preview: ProjectCancelPreview): string[] {
	const lines: string[] = [];
	if (preview.ticketsToCancel === 1) lines.push("1 open ticket will be cancelled");
	else if (preview.ticketsToCancel > 1) {
		lines.push(`${preview.ticketsToCancel} open tickets will be cancelled`);
	}
	lines.push("this cannot be undone");
	return lines;
}

/** The confirm fires only on a cancellable preview, with a quoted tier on every listed stage. */
export function canConfirmProjectCancel(
	preview: ProjectCancelPreview | null,
	tiers: ProjectCancelTiers,
	busy: boolean,
): boolean {
	if (busy || !preview || !preview.cancellable) return false;
	return preview.stages.every((stage) => stageQuoteFor(stage, tiers) !== null);
}

/**
 * The window event that opens the engagement's one Cancel confirmation, owned by the lane island
 * (ProjectSidebar), from a surface that is not that island — the setup rig's refused Archive.
 */
export const OPEN_PROJECT_CANCEL_EVENT = "projective:open-project-cancel";

/**
 * Whether a refused archive was refused because money is still held (`settle_first`, Decision #467):
 * the surface then offers Cancel, which settles it first, in place of the archive.
 */
export function isSettleFirstRefusal(
	errors: Readonly<Record<string, string>> | undefined,
): boolean {
	return Object.values(errors ?? {}).includes("settle_first");
}
