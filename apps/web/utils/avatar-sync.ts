/**
 * avatar-sync — tells every island already on the page that a person's profile photo changed.
 *
 * Server-side, a new photo reaches every surface on its next read by construction: nobody stores a
 * copy of anyone's picture, every surface resolves it through `org.get_party_cards`. This covers the
 * page the change was MADE on, whose islands were rendered before it — the account button above all,
 * which would otherwise show the old face until the next navigation.
 *
 * A window event rather than a shared module signal, because the listeners live in different
 * features' islands that should not import each other's state.
 */

/** The event name. The detail is {@link AvatarChangedDetail}. */
export const AVATAR_CHANGED_EVENT = "pj:avatar-changed";

export interface AvatarChangedDetail {
	/** Whose photo changed. */
	userId: string;
	/** The new photo's URL (the small tier). */
	url: string;
}

/** Announce that `userId`'s profile photo is now `url`. No-op outside a browser. */
export function broadcastAvatar(userId: string, url: string): void {
	if (typeof globalThis.dispatchEvent !== "function" || !userId || !url) return;
	globalThis.dispatchEvent(
		new CustomEvent<AvatarChangedDetail>(AVATAR_CHANGED_EVENT, { detail: { userId, url } }),
	);
}

/** Listen for photo changes; returns the unsubscribe. */
export function onAvatarChanged(listener: (detail: AvatarChangedDetail) => void): () => void {
	if (typeof globalThis.addEventListener !== "function") return () => {};
	const handler = (e: Event) => {
		const detail = (e as CustomEvent<AvatarChangedDetail>).detail;
		if (detail?.userId && detail.url) listener(detail);
	};
	globalThis.addEventListener(AVATAR_CHANGED_EVENT, handler);
	return () => globalThis.removeEventListener(AVATAR_CHANGED_EVENT, handler);
}
