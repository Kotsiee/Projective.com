import { formatMib, quotaState, type StorageQuota } from "../types/file-types.ts";

/**
 * quota-ring — what the footer's storage ring says for one allowance.
 *
 * Every figure is the server's (`usedMib` · `limitMib` · `pct`) and the band is the SSOT's
 * `quotaState`; this only chooses the words and the tone, so the ring, its tooltip and its popover
 * can never describe the same allowance differently. Unlimited draws no arc: a share of an unbounded
 * whole is not a quantity, so the ring gives way to the stored figure alone (as `QuotaMeter` draws no
 * track).
 */

// #region Model
/** The ring's tone — the meter fill's own: primary, then warning, then danger. */
export type QuotaRingTone = "primary" | "warning" | "danger";

/** One allowance as the ring presents it. */
export interface QuotaRingView {
	/** No ceiling: the ring is replaced by the stored figure. */
	unlimited: boolean;
	/** The arc, 0–100 (0 when unlimited). */
	pct: number;
	tone: QuotaRingTone;
	/** The short figure beside the ring: "24%", or "1.2 GB" stored when unlimited. */
	figure: string;
	/** The hover sentence: what is used of what. */
	summary: string;
	/** The trigger's accessible name — the summary, and what pressing it does. */
	label: string;
}

/** The ring's view of one allowance. */
export function quotaRingView(quota: StorageQuota): QuotaRingView {
	const state = quotaState(quota);
	const used = formatMib(quota.usedMib);
	if (quota.limitMib === null) {
		const summary = state === "empty"
			? "Nothing stored yet · no storage limit"
			: `${used} stored · no storage limit`;
		return {
			unlimited: true,
			pct: 0,
			tone: "primary",
			figure: used,
			summary,
			label: `Storage: ${summary}. Show storage details`,
		};
	}
	const limit = formatMib(quota.limitMib);
	const pct = Math.round(quota.pct);
	// Something stored that rounds to nothing is "under 1%", never a "0%" that reads as empty.
	const share = pct === 0 && state !== "empty" ? "<1%" : `${pct}%`;
	const tone: QuotaRingTone = state === "warning"
		? "warning"
		: state === "critical" || state === "exceeded"
		? "danger"
		: "primary";
	const summary = state === "empty"
		? `Nothing stored yet · ${limit} available`
		: state === "exceeded"
		? `${used} of ${limit} used · over the allowance`
		: `${used} of ${limit} used · ${pct === 0 ? "under 1%" : share}`;
	return {
		unlimited: false,
		pct,
		tone,
		figure: share,
		summary,
		label: `Storage: ${summary}. Show storage details`,
	};
}
// #endregion
