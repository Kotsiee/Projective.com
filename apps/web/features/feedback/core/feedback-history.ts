/**
 * feedback-history — the board's writes to the address bar (Decision #272), stamped the way every
 * in-page host on this app stamps them.
 *
 * Fresh's client runtime marks history entries `fClientNav: true` and, on a `popstate` into one,
 * reloads the document (partials are gone, Decision #52). So every entry written here carries
 * `fClientNav: false`, and before anything is pushed the page's OWN entry is re-stamped — the `?tkv=`
 * ticket host's recipe (Decision #95), which `SettingsModalHost` follows too. `pjFeedback` marks an
 * entry this module pushed, so a close knows whether there is an entry of ours to leave.
 */

/** The marker this module writes on its entries. */
interface FeedbackHistoryState {
	pjFeedback?: boolean;
	fClientNav?: boolean;
	[key: string]: unknown;
}

function current(): FeedbackHistoryState {
	const state = history.state;
	return state && typeof state === "object" ? (state as FeedbackHistoryState) : {};
}

/** The address bar as path + query + hash. */
export function currentHref(): string {
	return location.pathname + location.search + location.hash;
}

/** Re-stamp the current entry so a later Back into it never reloads the document. */
export function pinHistoryEntry(): void {
	history.replaceState({ ...current(), fClientNav: false }, "", currentHref());
}

/** Push `href` as a new entry (pinning the one beneath it first). */
export function pushFeedbackHref(href: string): void {
	pinHistoryEntry();
	history.pushState({ ...current(), fClientNav: false, pjFeedback: true }, "", href);
}

/** Rewrite the current entry to `href`, keeping whatever marks it already carries. */
export function replaceFeedbackHref(href: string): void {
	if (href === currentHref()) return;
	history.replaceState({ ...current(), fClientNav: false }, "", href);
}

/** Whether the current entry is one this module pushed. */
export function isPushedFeedbackEntry(): boolean {
	return current().pjFeedback === true;
}
