import { signal } from "@preact/signals";

/**
 * share-request — the cross-island bridge behind the {@link ShareHost} modal.
 *
 * Every "Share" control on the platform (a discovery card, a listing's kebab, a project, a
 * conversation) calls {@link requestShare} and the ONE mounted host opens the unified share modal:
 * ranked people on Projective to send it to, the external quick actions, Copy link, and the
 * device's own share sheet. The triggers are dozens of islands on a page and the host is one, so
 * they meet through module-level signals — the same seam every other cross-island bridge in the
 * app uses (`sign-in-prompt`, `ticket-view`, the board's footer ↔ body).
 *
 * The open flag and the request are two signals on purpose: `Dialog` binds a boolean it can write
 * back on close, while the request survives the close so the exit transition still has its title.
 */

/** What is being shared. `url` is ABSOLUTE by the time it reaches the host. */
export interface ShareRequest {
	url: string;
	/** The thing's name — the share sheet's title and the opening of the composed text. */
	title: string;
	/** An optional sentence carried into the external apps and the internal message. */
	text?: string;
	/** A short noun for the modal's header ("listing", "project", "profile"); defaults to "link". */
	noun?: string;
}

/** Whether the share modal is open — the boolean `Dialog` binds. */
export const shareOpen = signal(false);

/** The most recent request; kept through the close so the exit frame keeps its copy. */
export const shareRequest = signal<ShareRequest | null>(null);

/**
 * Open the share modal for a thing. `href` may be relative — it is resolved against the current
 * origin here, once, so no trigger has to know how to build an absolute URL.
 */
export function requestShare(request: Omit<ShareRequest, "url"> & { href: string }): void {
	const { href, ...rest } = request;
	shareRequest.value = { ...rest, url: absoluteUrl(href) };
	shareOpen.value = true;
}

/** Close the share modal without acting. */
export function dismissShare(): void {
	shareOpen.value = false;
}

/** Resolve a (possibly relative) href against the page's origin; returns it unchanged without one. */
export function absoluteUrl(href: string): string {
	try {
		return new URL(href, globalThis.location?.origin ?? "https://projective.com").toString();
	} catch {
		return href;
	}
}
