/** Share of a card that must be on screen for it to count as seen. */
export const IMPRESSION_RATIO = 0.5;

/** How long a card must stay at {@link IMPRESSION_RATIO} before it counts as seen. */
export const IMPRESSION_DWELL_MS = 1000;

/** Queue length that triggers an immediate flush. */
export const FLUSH_AT = 20;

/** Heartbeat flush interval for a page left open. */
export const FLUSH_EVERY_MS = 10_000;

/** A rail depth must grow by more than this before it is re-sent. */
export const DEPTH_STEP = 0.01;

/** The beacon endpoint. */
export const DISCOVERY_EVENTS_URL = "/api/explore/events";

/**
 * How far through a horizontal scroller the reader has reached, 0–1: the right edge of the visible
 * window over the full track width. A track that does not overflow is fully seen.
 */
export function railDepth(scrollLeft: number, clientWidth: number, scrollWidth: number): number {
	if (scrollWidth <= 0 || scrollWidth <= clientWidth) return 1;
	const reached = (Math.abs(scrollLeft) + clientWidth) / scrollWidth;
	return Math.min(1, Math.max(0, Math.round(reached * 100) / 100));
}

/** Whether a newly measured depth is worth another event. */
export function depthAdvanced(depth: number, sent: number): boolean {
	return depth > sent + DEPTH_STEP;
}

/** The dedupe key for one placement: the same item in two rails is two impressions. */
export function placementKey(itemId: string, rail: string | undefined): string {
	return `${rail ?? ""}\u0000${itemId}`;
}
