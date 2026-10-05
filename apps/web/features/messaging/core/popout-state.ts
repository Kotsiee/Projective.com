import { signal } from "@preact/signals";
import { readStored, removeStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";
import { normalisePath, shouldDismissPopout } from "./popout-route.ts";

/**
 * popout-state — the cross-island, cross-navigation store for the floating "Pop Out Chat" popover
 * (task §1). A channel/conversation popped out into a `DraggablePopover` must SURVIVE a full-page
 * navigation (Fresh does MPA navigations), so its state lives in `sessionStorage` and is mirrored to a
 * module-level signal:
 *
 *  - The pop-out button (in the channel/conversation header island) calls {@link openPopout} — same-page
 *    islands (the global {@link ChatPopoutHost}) react instantly via the shared signal.
 *  - After navigating away, the host re-mounts and reconciles the store with the new document
 *    ({@link syncPopoutRoute}); because the current path no longer matches the popped-out `href`, the
 *    host shows the "Open in input" button in the popover header.
 *  - Arriving at a full chat view (a conversation or a channel's Chat tab) from another page closes
 *    the window — the page now shows the chat it duplicated. The page it was spawned on keeps it.
 *  - Closing the popover (×) or opening it in the main input clears the store.
 *
 * Session-scoped so it never outlives the tab; the position is carried in the blob so the window
 * reopens where the developer left it within the session.
 */

/** The persisted pop-out state. */
export interface PopoutState {
	/** `project` → a project channel; `conversation` → a global `/messages` thread. */
	scope: "project" | "conversation";
	/** The engagement slug (project scope) or the conversation id (conversation scope). */
	projectId: string;
	/** The channel route segment (project scope) or the conversation id (conversation scope). */
	channelId: string;
	/** The conversation id used to page messages (`/api/messaging/messages`) for `conversation` scope. */
	conversationId?: string;
	/** The header title (the channel/conversation name). */
	title: string;
	/** The route to return to / maximize (the channel or conversation page). */
	href: string;
	/**
	 * Where the pop-out was opened FROM.
	 *
	 * `page` (the default) is a chat popped out of its own channel or conversation page. `profile` is a
	 * conversation started from a person's `/[handle]` page: the viewer was never on the conversation
	 * page, so the window docks into the bottom-end corner rather than opening at the default spot
	 * below the top bar.
	 */
	source?: "page" | "profile";
	/**
	 * The pathname of the last document that showed the window, stamped on open and on every host
	 * mount. Arriving at a chat route from any other path dismisses the window.
	 */
	lastPath?: string;
	/** The counterparty's avatar for the window's title glyph; null → the generic chat mark. */
	avatar?: string | null;
	/** Last window position (viewport px). */
	x?: number;
	y?: number;
	/** Last user-resized size (viewport px), so a reload reopens the window at the size it was left. */
	w?: number;
	h?: number;
}

/** The active pop-out, or `null`. Seeded null (SSR-safe); {@link hydratePopout} loads the stored blob. */
export const popout = signal<PopoutState | null>(null);

function persist(state: PopoutState | null): void {
	if (state) writeStored("session", SessionKeys.CHAT_POPOUT, JSON.stringify(state));
	else removeStored("session", SessionKeys.CHAT_POPOUT);
}

/** Re-seed the signal from `sessionStorage` (call from the host island's mount effect). */
export function hydratePopout(): void {
	const raw = readStored("session", SessionKeys.CHAT_POPOUT);
	if (!raw) {
		popout.value = null;
		return;
	}
	try {
		popout.value = JSON.parse(raw) as PopoutState;
	} catch {
		popout.value = null;
	}
}

/**
 * Open (or replace) the pop-out with the given channel/conversation.
 *
 * Re-opening the conversation that is ALREADY popped out keeps its remembered position and size: a
 * second press of a profile's Message control is "bring me back to that window", not "put a fresh
 * window in the corner", and the geometry is the one thing the caller cannot know.
 */
export function openPopout(state: PopoutState): void {
	const cur = popout.value;
	const same = cur && cur.scope === state.scope && cur.channelId === state.channelId;
	const placed: PopoutState = same ? { ...state, x: cur.x, y: cur.y, w: cur.w, h: cur.h } : state;
	const here = globalThis.location?.pathname;
	const next: PopoutState = here ? { ...placed, lastPath: normalisePath(here) } : placed;
	popout.value = next;
	persist(next);
}

/**
 * Reconcile the pop-out with the document now showing `pathname`: re-seed it from `sessionStorage`,
 * then close it when this is a chat route reached from another page ({@link shouldDismissPopout}),
 * or record `pathname` as the window's last page. Call on every host mount and on any return to a
 * document that skipped mounting (a back/forward-cache restore, a `popstate`).
 */
export function syncPopoutRoute(pathname: string): void {
	hydratePopout();
	const cur = popout.value;
	if (!cur) return;
	if (shouldDismissPopout(cur.lastPath, pathname)) {
		closePopout();
		return;
	}
	const here = normalisePath(pathname);
	if (cur.lastPath === here) return;
	const next = { ...cur, lastPath: here };
	popout.value = next;
	persist(next);
}

/** Close the pop-out and clear the store. */
export function closePopout(): void {
	popout.value = null;
	persist(null);
}

/** Persist the window's last position. */
export function movePopout(x: number, y: number): void {
	const cur = popout.value;
	if (!cur) return;
	const next = { ...cur, x, y };
	popout.value = next;
	persist(next);
}

/** Persist the window's last user-resized size. */
export function resizePopout(w: number, h: number): void {
	const cur = popout.value;
	if (!cur) return;
	const next = { ...cur, w, h };
	popout.value = next;
	persist(next);
}

/** Whether the current pathname is the popped-out channel/conversation's own page. */
export function isOnPopoutPage(pathname: string): boolean {
	const cur = popout.value;
	if (!cur) return false;
	return pathname === cur.href || pathname.startsWith(cur.href + "/");
}
