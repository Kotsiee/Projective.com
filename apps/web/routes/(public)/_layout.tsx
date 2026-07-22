import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { GuestShell } from "@web/features/shell/components/GuestShell.tsx";
import { UserShell } from "@web/features/shell/components/UserShell.tsx";
import { exploreFilterLaneFor } from "@features/explore/core/explore-lane-slot.tsx";
import { viewLaneFor } from "@features/view/core/view-lane-slot.tsx";

/** Auth surfaces render their own full-window chrome (AuthShell) — no marketing header/footer. */
const AUTH_PATHS = new Set(["/join", "/login", "/forgot-password", "/verify"]);

/**
 * Public surface shell — resolves to one of two navigation profiles by auth state (DESIGN_SYSTEM.md
 * Part D). Guests get the unified floating {@link GuestShell} (the pill {@link SiteHeader} with
 * megamenus over native window scrolling, shared with every other guest surface); signed-in users get
 * the unified {@link UserShell} L-shell so Home & Explore match the authenticated app exactly
 * (site-wide auth is resolved in the global middleware).
 *
 * The `(auth)` group (join/login/forgot-password/verify) is exempted: those pages own a full-window
 * split-screen shell, so both shells are suppressed for them.
 */
export default define.page(function PublicLayout(ctx) {
	if (AUTH_PATHS.has(ctx.url.pathname)) {
		return <ctx.Component />;
	}
	// The Search Results filters are relocated out of the page body into the navigation sidebar: the
	// authed middle-nav lane, or the guest floating aside. Resolved per URL (State B on `/explore` only).
	// The Entity View action panel (`/view/[id]`) mounts in the SAME sidebar slot — the two are mutually
	// exclusive by route, so the first non-null resolver wins.
	const filterLane = exploreFilterLaneFor(ctx.url) ??
		viewLaneFor(ctx.url, !!ctx.state.isAuthenticated);
	if (ctx.state.isAuthenticated) {
		return (
			<UserShell
				path={ctx.url.pathname}
				context={asAuthenticatedContext(ctx.state.userContext)}
				lane={filterLane}
			>
				<ctx.Component />
			</UserShell>
		);
	}
	return (
		<GuestShell lane={filterLane}>
			<ctx.Component />
		</GuestShell>
	);
});
