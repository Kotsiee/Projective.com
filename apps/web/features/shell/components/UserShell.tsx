import type { ComponentChildren, JSX } from "preact";
import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import "../styles/user-shell.css";
import { AppShell, BottomNav, MiddleNav, PageCanvas } from "@projective/ui/navigation";
import ShellSidebar from "@web/features/shell/islands/ShellSidebar.island.tsx";
import MiddleNavSplitter from "@web/features/shell/islands/MiddleNavSplitter.island.tsx";
import NavSearchBar from "@web/features/shell/islands/NavSearchBar.island.tsx";
import UserActions from "@web/features/shell/islands/UserActions.island.tsx";
import { globalNav } from "@web/features/shell/core/nav-model.ts";
import { bottomNavItems } from "@web/features/shell/core/bottom-nav-model.tsx";
import { BrandMark } from "./BrandMark.tsx";

export interface UserShellProps {
	/** Current pathname — drives active-state across the sidebar + nav. */
	path: string;
	/**
	 * The hydrated user context (from `ctx.state.userContext`). Tailors the global rail to the actor's
	 * structural context + capabilities so SSR paints the correct skeleton. Read-only visual guide:
	 * access is re-checked server-side + under RLS on every navigation. Defaults to a personal member.
	 */
	context?: UserContext;
	/** Show the centered structural search (default true). Omit where the middle-nav config disallows. */
	showSearch?: boolean;
	/**
	 * Whether this shell renders a PROTECTED route (a `(dashboard)` surface). Threaded to
	 * {@link UserActions} to drive the smart-logout redirect (leave the private area for `/` on a
	 * protected route; reload in place as a guest on a public route). Defaults to public — only the
	 * `(dashboard)` layout sets it true.
	 */
	protectedRoute?: boolean;
	/** Optional page-level middle-nav lane content (drag-resizable). When absent the canvas fills. */
	lane?: ComponentChildren;
	/**
	 * Optional route-configured header for the middle-nav frame — mounted as the {@link MiddleNav}
	 * `header` band, a sticky top strip flush against the lane so it reads as one connected header across
	 * the whole middle-nav frame (DESIGN_SYSTEM.md §D.4). The shell layout resolves it per route (e.g. the
	 * channel view's `ChannelHeader`); when absent the band is omitted and the content fills the top. This
	 * is the SSR-idiomatic equivalent of a page "registering" a header with the shell — resolved from the
	 * URL so it paints correctly on the first byte with no client-context flash. Requires a {@link lane}
	 * (the header band belongs to the middle-nav frame); ignored when the canvas renders bare.
	 */
	middleNavHeader?: ComponentChildren;
	/**
	 * Optional route-configured footer for the middle-nav frame — mounted as the {@link MiddleNav}
	 * `footer` band, a sticky bottom strip that locks to the viewport bottom under the native window
	 * scroll (Decision #31). The shell layout resolves it per route (e.g. the channel Chat tab's
	 * `ChatComposer`); when absent the band is omitted. Requires a {@link lane} (the footer band belongs
	 * to the middle-nav frame); ignored when the canvas renders bare.
	 */
	middleNavFooter?: ComponentChildren;
	/** The page body. */
	children: ComponentChildren;
}

/**
 * UserShell — the unified authenticated L-shell (DESIGN_SYSTEM.md Part D, "Desktop/Mobile User").
 * The single composition of `AppShell` (glass header layers + opaque global sidebar, region seams as
 * hairlines) → optional `MiddleNav` lane → `PageCanvas`, shared verbatim by the `(dashboard)` layout
 * and the authenticated branch of the `(public)` layout so Home & Explore render inside the same
 * shell when signed in — zero layout duplication.
 *
 * Header flow is left→right (Part D.1): a **Left block** fusing the brand mark to the integrated
 * {@link NavSearchBar} (the same modular scope-selector + typewriter search the guest header uses),
 * and a **Right block** — {@link UserActions} — with Create · Notifications · Basket · Profile.
 *
 * Mobile viewport isolation (Part D.3): the desktop mechanics — global sidebar, middle-nav lane, and
 * nested-frame chrome — are stripped by CSS at ≤ --bp-md, leaving only the glass mobile header, a
 * full-width native-scrolling body, and the fixed {@link BottomNav}. There is **no burger menu** on
 * mobile: the header's profile avatar (in {@link UserActions}) opens the account side-sheet, and the
 * bottom bar carries the primaries.
 */
export function UserShell(
	{
		path,
		context = PERSONAL_MEMBER_CONTEXT,
		showSearch = true,
		protectedRoute = false,
		lane,
		middleNavHeader,
		middleNavFooter,
		children,
	}: UserShellProps,
): JSX.Element {
	const canvas = <PageCanvas>{children}</PageCanvas>;
	return (
		<>
			<AppShell
				persona="user"
				brand={
					<div class="shell-headlead">
						<BrandMark />
						{showSearch ? <NavSearchBar /> : null}
					</div>
				}
				utilityBar={<UserActions context={context} protectedRoute={protectedRoute} />}
				sidebar={<ShellSidebar items={globalNav(path, context)} />}
			>
				{lane
					? (
						<MiddleNav
							lane={<MiddleNavSplitter>{lane}</MiddleNavSplitter>}
							header={middleNavHeader}
							footer={middleNavFooter}
						>
							{canvas}
						</MiddleNav>
					)
					: canvas}
			</AppShell>
			{/* Ergonomic mobile thumb-nav (Part D.3) — fixed, mobile-only (hidden ≥ --bp-md by CSS). */}
			<BottomNav items={bottomNavItems(path)} label="Primary" />
		</>
	);
}
