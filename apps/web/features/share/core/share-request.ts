import { signal } from "@preact/signals";
import type { ShareFile } from "./share-mode.ts";

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

/**
 * Who the shared URL opens for (Decision #402): anyone it is passed to, or only the people who already
 * have access — a private or restricted file's address, which the external apps cannot widen.
 */
export type ShareReach = "anyone" | "with-access";

/** What is being shared. `url` is ABSOLUTE by the time it reaches the host. */
export interface ShareRequest {
	url: string;
	/** The thing's name — the share sheet's title and the opening of the composed text. */
	title: string;
	/** An optional sentence carried into the external apps and the internal message. */
	text?: string;
	/** A short noun for the modal's header ("listing", "project", "profile"); defaults to "link". */
	noun?: string;
	/** The stored file being shared, which can be sent as a link or a copy (Decision #401). */
	file?: ShareFile;
	/** Who {@link url} opens for; `anyone` when absent. */
	reach?: ShareReach;
	/** Open the place where the sharer changes who has access, when the trigger has one. */
	manageAccess?: () => void;
	/**
	 * The standing button that asked (Decision #405): the share then opens as a popover anchored to it
	 * from `--bp-md` up. A menu row passes none — it is gone by the time the share opens — and gets the
	 * modal.
	 */
	anchor?: EventTarget | null;
}

/** The control a share was asked from — the host anchors to it when it is an element on the page. */
export function shareAnchor(event: Event | undefined): EventTarget | null {
	return event?.currentTarget ?? null;
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
	// A second press on the button an open share is anchored to closes it, as a popover trigger does.
	if (shareOpen.peek() && rest.anchor && shareRequest.peek()?.anchor === rest.anchor) {
		shareOpen.value = false;
		return;
	}
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
