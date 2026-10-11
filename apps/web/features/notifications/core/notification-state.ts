import { signal } from "@preact/signals";
import type { NotificationSummary } from "@projective/types/comms";
import { subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { BURST_POLL_MS, hasArrivals, POLL_MS } from "./notification-model.ts";
import { NotificationService } from "./NotificationService.ts";

/**
 * notification-state — the inbox state every surface on a page shares: the badge summary (the header
 * dot, the tab counts) and an arrival pulse the open lists refresh on. ONE poller feeds both, started
 * by the always-present header island, so a page with the drawer and `/notifications` open still makes
 * one `/summary` read per tick (Decision #173: poll the summary, no Realtime socket in the client).
 */

/** The latest badge summary, `null` until the first read lands. */
export const inboxSummary = signal<NotificationSummary | null>(null);

/** Bumped whenever a summary shows something new arrived; open lists merge their head on change. */
export const inboxArrivals = signal(0);

/** Bumped when the whole inbox is swapped (a Dev Context Switcher change); open lists reload. */
export const inboxEpoch = signal(0);

/** Publish a summary from any read (a list page carries one too), pulsing on arrivals. */
export function publishSummary(next: NotificationSummary): void {
	if (hasArrivals(inboxSummary.peek(), next)) inboxArrivals.value++;
	inboxSummary.value = next;
}

/** Re-read the summary now — after a write, on focus, on every tick. */
export async function refreshSummary(): Promise<void> {
	const next = await NotificationService.summary();
	if (next) publishSummary(next);
}

/**
 * Poll `/summary` while the tab is visible: every {@link POLL_MS}, at once on becoming visible again,
 * and every {@link BURST_POLL_MS} while the dev burst runs. Returns the stop function.
 */
export function startInboxPolling(): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const schedule = () => {
		clearTimeout(timer);
		// A tick still in flight when the poller stops must not re-arm it.
		if (stopped || document.visibilityState !== "visible") return;
		timer = setTimeout(tick, NotificationService.bursting() ? BURST_POLL_MS : POLL_MS);
	};
	const tick = async () => {
		await refreshSummary();
		schedule();
	};
	const onVisible = () => {
		if (document.visibilityState === "visible") void tick();
		else clearTimeout(timer);
	};
	// A dev axis change swaps the whole inbox: drop the old baseline so it reads as a reset, not arrivals.
	const unsubscribe = subscribeDevSeam(() => {
		inboxSummary.value = null;
		inboxEpoch.value++;
		void tick();
	});
	document.addEventListener("visibilitychange", onVisible);
	void tick();
	return () => {
		stopped = true;
		clearTimeout(timer);
		unsubscribe();
		document.removeEventListener("visibilitychange", onVisible);
	};
}
