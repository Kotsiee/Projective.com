import type { ComponentChildren, JSX } from "preact";
import SiteHeader from "@features/marketing/islands/SiteHeader.island.tsx";
import { PublicFooter } from "@features/marketing/components/PublicFooter.tsx";
import GuestAside from "@web/features/shell/islands/GuestAside.island.tsx";

export interface GuestShellProps {
	/**
	 * Optional route lane (Green side nav). When present it mounts in a floating, glassmorphic
	 * {@link GuestAside} on the left — NO drag-resize handle, collapse driven by the lane's own footer
	 * toggle. Absent on lane-less routes (`/`, `/explore`, …), which then render just the header + body.
	 */
	lane?: ComponentChildren;
	/**
	 * Optional route sticky header — mounts in a floating `.guest-shell__subheader` beneath the site
	 * header, adjacent to the aside (e.g. the profile `ProfileStickyHeader`, revealed on scroll). Absent
	 * → no sub-header band.
	 */
	header?: ComponentChildren;
	/** Render the marketing {@link PublicFooter} at the body's end (default true; off for full-page surfaces). */
	footer?: boolean;
	/** The page body. */
	children: ComponentChildren;
}

/**
 * GuestShell — the unified FLOATING guest navigation shell (DESIGN_SYSTEM.md Part D), the guest
 * counterpart of the authenticated {@link UserShell}. It is the single guest chrome shared by BOTH the
 * `(public)` layout and the guest branch of the `/[handle]` profile layout, so a signed-out visitor
 * sees one consistent shell everywhere — a floating pill {@link SiteHeader} (full-width, morphing to a
 * glass pill on scroll, discovery megamenus intact), an optional floating glass side nav
 * ({@link GuestAside}), an optional floating glass sub-header, over a full-bleed body — instead of the
 * two divergent chromes (marketing header vs `AppShell persona="guest"`) it replaces.
 *
 * It reuses the marketing `.site` / `.site__main` base (site-shell.css: the reserved header band +
 * `overflow-x: clip`), so lane-less routes are structurally identical to the previous public layout;
 * the floating aside / sub-header / body gutters layer on via `guest-shell.css` only when a route
 * supplies a lane. Guests therefore never render the full-bleed `ui-shell-topbar` or the full-height
 * `ui-app-shell__sidebar` — that nested L-shell is reserved for authenticated users.
 */
export function GuestShell(
	{ lane, header, footer = true, children }: GuestShellProps,
): JSX.Element {
	return (
		<div
			class="site guest-shell"
			data-has-aside={lane ? "true" : "false"}
			data-has-subheader={header ? "true" : "false"}
		>
			<SiteHeader authenticated={false} />
			{lane ? <GuestAside>{lane}</GuestAside> : null}
			{header ? <div class="guest-shell__subheader">{header}</div> : null}
			<main class="site__main guest-shell__body">
				{children}
				{footer ? <PublicFooter /> : null}
			</main>
		</div>
	);
}
