import type { ComponentChildren, JSX } from "preact";
import { useEffect } from "preact/hooks";
// The guest floating-shell CSS lives in a server component (GuestShell), whose CSS import is NOT in any
// island's client-bundle graph and so never ships. Riding it on this always-present-when-a-lane-exists
// island injects it (same pattern as user-shell.css on ShellSidebar).
import "@web/features/shell/styles/guest-shell.css";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { MIDDLE_LANE_TOGGLE_EVENT, type MiddleLaneToggleDetail } from "@web/utils/lane-events.ts";

export interface GuestAsideProps {
	/** The route lane content (e.g. the profile `ProfileActionLane`). */
	children?: ComponentChildren;
}

/**
 * GuestAside — the guest floating side nav (DESIGN_SYSTEM.md Part D). It is the guest counterpart of the
 * authenticated middle-nav lane: a floating, glassmorphic panel that hosts the SAME route lane content,
 * but with **no drag-resize splitter handle** — collapse/expand is driven purely by the lane's own
 * footer toggle, which dispatches {@link MIDDLE_LANE_TOGGLE_EVENT} (shared with the authed
 * `MiddleNavSplitter`).
 *
 * Collapse state is cached under {@link LocalKeys.GUEST_NAV_COLLAPSED} and expressed on
 * `:root[data-guest-nav]`, mirroring the authenticated rail's `:root[data-sidebar]`: the `_app.tsx`
 * pre-paint applies it before first paint (no flash-of-wrong-width) and this island keeps it in sync,
 * so `guest-shell.css` (panel width) and `profile.css` (the lane's rail/full presentation) both resolve
 * off one pre-painted attribute. Dumb island — it only reconciles the cached preference and toggles it.
 */
export default function GuestAside({ children }: GuestAsideProps): JSX.Element {
	useEffect(() => {
		const root = document.documentElement;
		// Reconcile the pre-painted attribute with the cached preference (defensive — the _app.tsx
		// pre-paint normally already applied it, so this is a no-op).
		const stored = readStored("local", LocalKeys.GUEST_NAV_COLLAPSED);
		root.dataset.guestNav = stored === "1" ? "collapsed" : "expanded";

		const onToggle = (e: Event) => {
			const detail = (e as CustomEvent<MiddleLaneToggleDetail>).detail;
			const isCollapsed = root.dataset.guestNav === "collapsed";
			const next = detail?.collapsed ?? !isCollapsed;
			root.dataset.guestNav = next ? "collapsed" : "expanded";
			writeStored("local", LocalKeys.GUEST_NAV_COLLAPSED, next ? "1" : "0");
		};
		globalThis.addEventListener(MIDDLE_LANE_TOGGLE_EVENT, onToggle);
		return () => globalThis.removeEventListener(MIDDLE_LANE_TOGGLE_EVENT, onToggle);
	}, []);

	return (
		<aside class="ui-guest-aside" aria-label="Page navigation">
			{children}
		</aside>
	);
}
