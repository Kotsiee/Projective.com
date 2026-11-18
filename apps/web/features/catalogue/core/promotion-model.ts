import type { ListingPromotion } from "@projective/types/catalogue";

/**
 * promotion-model — the pure rules behind the listing workspace's Promote control (Decision #454):
 * the Dev Context Switcher's `promotionState` simulation over the server's answer, and the words a
 * flight's end date is stated in. No DOM, no dev seam, so it is tested without a browser.
 */

// #region Simulation
/** The `promotionState` dev axis, restated here so this model never imports the dev seam. */
export type PromotionSimulation = "auto" | "not_entitled" | "available" | "live" | "elsewhere";

const SIMULATED_PLACEMENT = "00000000-0000-4000-8000-000000000454";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The control's answer under the simulation: `auto` is the server's own; every other value draws the
 * published listing in that state, keeping the server's live or elsewhere facts when it has them. The
 * door is still the judge of a promote or a stop.
 */
export function simulatePromotion(
	real: ListingPromotion,
	sim: PromotionSimulation,
	now: Date,
): ListingPromotion {
	const base = { ...real, published: true, live: null, elsewhere: null };
	const ends = new Date(now.getTime() + real.flightDays * DAY_MS).toISOString();
	switch (sim) {
		case "auto":
			return real;
		case "not_entitled":
			return { ...base, entitled: false };
		case "available":
			return { ...base, entitled: true };
		case "live":
			return {
				...base,
				entitled: true,
				live: real.live ?? {
					placementId: SIMULATED_PLACEMENT,
					surface: "explore_home",
					startsAt: now.toISOString(),
					endsAt: ends,
				},
			};
		case "elsewhere":
			return {
				...base,
				entitled: true,
				elsewhere: real.elsewhere ?? { slug: "", title: "another listing", endsAt: ends },
			};
	}
}
// #endregion

// #region Words
/** A flight's last day as the control states it ("25 Nov"), in the reader's own calendar. */
export function promotionEndLabel(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

/** The plan a seller needs, named by whose slot it is. */
export function promotionPlanName(subject: ListingPromotion["subject"]): string {
	return subject === "team" ? "Pro Team" : "Pro";
}
// #endregion
