import { signal } from "@preact/signals";
import { readStored, removeStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";

/**
 * popout-state — the cross-island, cross-navigation store for the floating "Pop Out Chat" popover
 * (task §1). A channel/conversation popped out into a `DraggablePopover` must SURVIVE a full-page
 * navigation (Fresh does MPA navigations), so its state lives in `sessionStorage` and is mirrored to a
 * module-level signal:
 *
 *  - The pop-out button (in the channel/conversation header island) calls {@link openPopout} — same-page
 *    islands (the global {@link ChatPopoutHost}) react instantly via the shared signal.
 *  - After navigating away, the host re-mounts and re-seeds the signal from `sessionStorage`
 *    ({@link hydratePopout}); because the current path no longer matches the popped-out `href`, the host
 *    shows the "Return to Channel" / "Maximize" button in the popover header.
 *  - Closing the popover (×) clears the store.
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
	/** Last window position (viewport px). */
	x?: number;
	y?: number;
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

/** Open (or replace) the pop-out with the given channel/conversation. */
export function openPopout(state: PopoutState): void {
	popout.value = state;
	persist(state);
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

/** Whether the current pathname is the popped-out channel/conversation's own page. */
export function isOnPopoutPage(pathname: string): boolean {
	const cur = popout.value;
	if (!cur) return false;
	return pathname === cur.href || pathname.startsWith(cur.href + "/");
}
