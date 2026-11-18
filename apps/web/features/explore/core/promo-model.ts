import type {
	CtaPromo,
	EditorialPromo,
	PromoAnchor,
	PromoSlot,
	SponsoredPromo,
} from "../types/explore-types.ts";

/**
 * Explore Home promo slots — the pure rules behind where each slot renders and whether it shows.
 *
 * No DOM, no storage, no dev seam: the `PromoGate` island reads those and hands the facts in, so the
 * rules can be tested without a browser.
 */

// #region Placement
/**
 * The promoted slots that head `rail` (Decision #454). They sit before the rail's organic items, which
 * the caller renders exactly as ranked: a promoted listing keeps its own organic position, unlabelled,
 * so a promotion never moves anything the ranking placed.
 */
export function promotedInRail(
	promos: readonly PromoSlot[],
	rail: SponsoredPromo["rail"],
): SponsoredPromo[] {
	return promos.filter((p): p is SponsoredPromo => p.variant === "sponsored" && p.rail === rail);
}

/** The conversion and editorial slots placed after `anchor`, in feed order. */
export function promosAfter(
	promos: readonly PromoSlot[],
	anchor: PromoAnchor,
): Array<CtaPromo | EditorialPromo> {
	return promos.filter((p): p is CtaPromo | EditorialPromo =>
		p.variant !== "sponsored" && p.after === anchor
	);
}
// #endregion

// #region Visibility
/** How stored dismissals are applied — the Dev Context Switcher's `promoDismissal` values. */
export type PromoDismissalMode = "auto" | "visible" | "dismissed";

/** Everything that decides whether a gated slot shows. */
export interface PromoVisibilityInput {
	id: string;
	audience: CtaPromo["audience"];
	dismissible: boolean;
	/** Slot ids this device has dismissed. */
	dismissed: readonly string[];
	/** Whether the viewer can already sell (real session, or the simulated persona). */
	viewerFreelancer: boolean;
	/** Whether the viewer is a restricted (13–17) account, who cannot become a seller (Decision #192). */
	viewerRestricted: boolean;
	mode: PromoDismissalMode;
}

/** Whether a gated promo slot renders. The audience gate holds whatever the dismissal mode. */
export function promoVisible(input: PromoVisibilityInput): boolean {
	if (input.audience === "non_freelancers" && (input.viewerFreelancer || input.viewerRestricted)) {
		return false;
	}
	if (!input.dismissible || input.mode === "visible") return true;
	if (input.mode === "dismissed") return false;
	return !input.dismissed.includes(input.id);
}

/** Decode the stored dismissal list; anything malformed reads as nothing dismissed. */
export function parseDismissed(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
	} catch {
		return [];
	}
}

/** The dismissal list with `id` added once. */
export function withDismissed(dismissed: readonly string[], id: string): string[] {
	return dismissed.includes(id) ? [...dismissed] : [...dismissed, id];
}
// #endregion
