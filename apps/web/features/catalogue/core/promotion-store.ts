import { computed, signal } from "@preact/signals";
import {
	type ListingPromotion,
	type PromotionState,
	promotionStateOf,
	type PromotionSurface,
} from "@projective/types/catalogue";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { CatalogueService } from "./CatalogueService.ts";
import { type PromotionSimulation, simulatePromotion } from "./promotion-model.ts";

/**
 * promotion-store — the listing workspace's Promote control state (Decision #454), shared by the
 * inspector's docked and drawer bodies so one listing is read once and a promote in either shows in
 * both. The server's answer is the record; the `promotionState` dev axis only redraws it.
 */

// #region State
/** The server's answer for {@link promotionSlug}, or `null` before it lands. */
export const promotionServer = signal<ListingPromotion | null>(null);
/** The listing the answer is for. */
export const promotionSlug = signal<string | null>(null);
/** The surface the seller has chosen for their next flight. */
export const promotionSurface = signal<PromotionSurface>("explore_home");
/** A promote or stop in flight. */
export const promotionBusy = signal(false);
/** The last read's or write's refusal, in words. */
export const promotionError = signal<string | null>(null);
/** The `promotionState` dev axis; `auto` in production, where nothing writes the seam. */
export const promotionSim = signal<PromotionSimulation>("auto");

/** What the control draws: the server's answer under the dev simulation. */
export const promotionView = computed<ListingPromotion | null>(() => {
	const real = promotionServer.value;
	return real ? simulatePromotion(real, promotionSim.value, new Date()) : null;
});

/** The one state the control renders, or `null` while loading. */
export const promotionState = computed<PromotionState | null>(() => {
	const view = promotionView.value;
	return view ? promotionStateOf(view) : null;
});
// #endregion

// #region Actions
/**
 * Read the listing's promotion once per slug: a second mount of the same listing reuses the answer or
 * the read in flight, and only a failed read is retried.
 */
export async function loadPromotion(slug: string): Promise<void> {
	if (promotionSlug.peek() === slug && promotionError.peek() === null) return;
	promotionSlug.value = slug;
	promotionServer.value = null;
	promotionError.value = null;
	const res = await CatalogueService.promotion(slug);
	if (promotionSlug.peek() !== slug) return;
	if (res.ok && res.data) promotionServer.value = res.data.promotion;
	else promotionError.value = res.message ?? "Promotion isn't available right now.";
}

async function write(
	run: () => ReturnType<typeof CatalogueService.promotion>,
): Promise<void> {
	if (promotionBusy.peek()) return;
	promotionBusy.value = true;
	promotionError.value = null;
	try {
		const res = await run();
		if (res.ok && res.data) promotionServer.value = res.data.promotion;
		else promotionError.value = res.message ?? "That didn't go through. Try again.";
	} finally {
		promotionBusy.value = false;
	}
}

/** Start the seller's one flight for the listing on the chosen surface. */
export function startPromotion(slug: string): Promise<void> {
	return write(() => CatalogueService.promote(slug, promotionSurface.peek()));
}

/** Stop the listing's live flight now. */
export function endPromotion(slug: string): Promise<void> {
	return write(() => CatalogueService.stopPromotion(slug));
}

/**
 * Follow the dev seam into {@link promotionSim}. Call from a mount effect (never during render);
 * returns the unsubscribe.
 */
export function watchPromotionSim(): () => void {
	promotionSim.value = readDevSeam()?.promotionState ?? "auto";
	return subscribeDevSeam((seam) => {
		promotionSim.value = seam?.promotionState ?? "auto";
	});
}
// #endregion
