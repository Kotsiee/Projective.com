import type {
	FairExitBlocked,
	FairExitPreview,
	FairExitQuote,
	FairExitTier,
} from "../types/projects-types.ts";

/**
 * fair-exit-model — the pure decisions behind the Fair Exit confirmation (Decision #198): which tier a
 * segment value names, which quote to show, what a blocked stage says, and when the confirm may fire.
 * Every figure arrives formatted from the server; nothing here computes money.
 */

/** The tier the confirmation opens on — the middle of the three. */
export const DEFAULT_FAIR_EXIT_TIER: FairExitTier = 50;

/** One segment of the tier switch. */
export interface FairExitTierOption {
	label: string;
	value: string;
}

/** The three tiers as segment options, in order. */
export const FAIR_EXIT_TIER_OPTIONS: readonly FairExitTierOption[] = [
	{ label: "25%", value: "25" },
	{ label: "50%", value: "50" },
	{ label: "75%", value: "75" },
];

/** The tier a segment value names, or null for anything else. */
export function parseFairExitTier(
	value: string | string[] | null | undefined,
): FairExitTier | null {
	const raw = Array.isArray(value) ? value[0] : value;
	switch (raw) {
		case "25":
			return 25;
		case "50":
			return 50;
		case "75":
			return 75;
		default:
			return null;
	}
}

/** The preview's quote for a tier, or null when the preview does not carry one. */
export function quoteFor(
	preview: FairExitPreview | null,
	tier: FairExitTier | null,
): FairExitQuote | null {
	if (!preview || tier === null) return null;
	return preview.tiers.find((q) => q.tier === tier) ?? null;
}

/** Why the stage cannot be ended, in words for the reviewer. */
export function blockedText(blocked: FairExitBlocked): string {
	return blocked === "settled"
		? "This stage is already settled, so there is nothing left to end."
		: "Nothing is held in escrow on this stage, so there is nothing to settle.";
}

/** The meta line under the figures: what else ending the stage does. */
export function fairExitConsequences(preview: FairExitPreview): string[] {
	const lines: string[] = [];
	if (preview.ticketsToCancel > 0) {
		lines.push(
			preview.ticketsToCancel === 1
				? "1 open ticket on this stage will be cancelled"
				: `${preview.ticketsToCancel} open tickets on this stage will be cancelled`,
		);
	}
	if (preview.prepaidCents > 0) {
		lines.push(`${preview.prepaidLabel} prepaid for unclaimed tickets comes back in full`);
	}
	return lines;
}

/** The confirm fires only on an exitable preview, a known tier, and nothing in flight. */
export function canConfirmFairExit(
	preview: FairExitPreview | null,
	tier: FairExitTier | null,
	busy: boolean,
): boolean {
	return !busy && preview !== null && preview.exitable && quoteFor(preview, tier) !== null;
}
