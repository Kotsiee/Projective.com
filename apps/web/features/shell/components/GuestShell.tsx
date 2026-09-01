import type { ComponentChildren, JSX } from "preact";
import SiteHeader from "@features/marketing/islands/SiteHeader.island.tsx";
import { PublicFooter } from "@features/marketing/components/PublicFooter.tsx";
import GuestAside from "@web/features/shell/islands/GuestAside.island.tsx";

export interface GuestShellProps {
	/**
	 * Optional route lane (Green side nav). When present it mounts in a glassmorphic {@link GuestAside}
	 * on the left — NO drag-resize handle, collapse driven by the lane's own footer toggle. Used by the
	 * `/[handle]` profile lane and the `/explore` Search Results filters (relocated out of the body).
	 * Absent on lane-less routes (`/`, the Explore Home feed, …), which render just the header + body.
	 *
	 * When a lane is present the shell switches to a flex-column layout: the aside + body sit in a
	 * `.guest-shell__region` above a **full-width** `PublicFooter`, and the aside terminates cleanly above
	 * that footer (see guest-shell.css). Lane-less routes keep the original header + body + in-body footer.
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
	/**
	 * The page the visitor is currently on, threaded into the header's Sign in / Get started links as
	 * a `redirectTo` so authenticating returns them HERE rather than to the default landing page.
	 */
	returnTo?: string;
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
	{ lane, header, footer = true, returnTo, children }: GuestShellProps,
): JSX.Element {
	const hasAside = !!lane;
	return (
		<div
			class="site guest-shell"
			data-has-aside={hasAside ? "true" : "false"}
			data-has-subheader={header ? "true" : "false"}
		>
			<SiteHeader authenticated={false} returnTo={returnTo} />
			{header ? <div class="guest-shell__subheader">{header}</div> : null}
			{hasAside
				? (
					// Lane routes: aside + body share a flex region ABOVE a full-width footer, so the footer
					// spans the window and the aside terminates cleanly above it (guest-shell.css).
					<>
						<div class="guest-shell__region">
							<GuestAside>{lane}</GuestAside>
							<main class="site__main guest-shell__body">{children}</main>
						</div>
						{footer ? <PublicFooter /> : null}
					</>
				)
				: (
					// Lane-less routes: unchanged — the footer stays at the body's end (already full-width).
					<main class="site__main guest-shell__body">
						{children}
						{footer ? <PublicFooter /> : null}
					</main>
				)}
		</div>
	);
}
