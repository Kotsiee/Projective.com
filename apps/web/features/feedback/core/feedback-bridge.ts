import {
	FEEDBACK_HOME,
	FEEDBACK_PATH,
	type FeedbackView,
	withFeedbackLocation,
} from "./feedback-url.ts";

/**
 * feedback-bridge — the one way a surface opens the feedback board (Decision #272):
 * `openFeedback()` from a menu entry, `openFeedback({ view: "compose" })` from a "Suggest an idea".
 *
 * A window event rather than an import of the drawer, so a menu entry never pulls the board into its
 * island's bundle. CANCELABLE: the mounted `FeedbackHost` claims it with `preventDefault()`. Where
 * nothing claims it — the board's own page, a page with no host — the bridge navigates to
 * `/feedback` instead, so the entry always does something (§3 gate 11).
 */

/** The event name. */
export const FEEDBACK_OPEN_EVENT = "pj:feedback-open";

/** What an open request carries. */
export interface FeedbackOpenDetail {
	view: Exclude<FeedbackView, "idea">;
}

/** The page the bridge falls back to for a request. */
export function feedbackFallbackHref(detail: FeedbackOpenDetail): string {
	return withFeedbackLocation(FEEDBACK_PATH, { ...FEEDBACK_HOME, view: detail.view });
}

/** Open the board — in the drawer where a host is mounted, else on `/feedback`. Returns whether a host took it. */
export function openFeedback(detail: FeedbackOpenDetail = { view: "board" }): boolean {
	let claimed = false;
	try {
		const event = new CustomEvent<FeedbackOpenDetail>(FEEDBACK_OPEN_EVENT, {
			detail,
			cancelable: true,
		});
		claimed = globalThis.dispatchEvent(event) === false;
	} catch {
		claimed = false;
	}
	if (!claimed) globalThis.location?.assign(feedbackFallbackHref(detail));
	return claimed;
}

/**
 * Subscribe to open requests. The listener returns `true` to CLAIM one (the bridge then does not
 * navigate). Returns an unsubscribe.
 */
export function onOpenFeedback(listener: (detail: FeedbackOpenDetail) => boolean): () => void {
	const handle = (event: Event) => {
		const detail = (event as CustomEvent<FeedbackOpenDetail>).detail;
		if (detail && listener(detail)) event.preventDefault();
	};
	globalThis.addEventListener(FEEDBACK_OPEN_EVENT, handle);
	return () => globalThis.removeEventListener(FEEDBACK_OPEN_EVENT, handle);
}
