import type { ComponentChildren, JSX } from "preact";
import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import "../styles/user-shell.css";
import {
	AppShell,
	BottomNav,
	MiddleNav,
	PageCanvas,
	type ShellChrome,
} from "@projective/ui/navigation";
import ShellSidebar from "@web/features/shell/islands/ShellSidebar.island.tsx";
import MiddleNavSplitter from "@web/features/shell/islands/MiddleNavSplitter.island.tsx";
import NavSearchBar from "@web/features/shell/islands/NavSearchBar.island.tsx";
import UserActions from "@web/features/shell/islands/UserActions.island.tsx";
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
	/**
	 * Chrome density (DESIGN_SYSTEM.md Part D.6). `full` is the standard L-shell; `focus` is the
	 * distraction-free mode for a linear, committing flow (checkout's Details and Payment steps).
	 *
	 * In `focus` the shell renders **no global sidebar, no lane, no search and no utility bar** — the
	 * header keeps only the brand mark. It does not "hide" them: they are not constructed, so they
	 * cost no grid track and take no part in the frame-inset accumulator. The middle-nav frame still
	 * renders when a {@link middleNavHeader} is supplied, which is how the checkout stepper spans the
	 * top of the canvas with nothing beside it.
	 *
	 * The mode is resolved per-URL by a slot resolver in the layout, exactly like the lane and the
	 * bands — so it paints correctly in the first byte with no client flash.
	 */
	chrome?: ShellChrome;
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
		chrome = "full",
		children,
	}: UserShellProps,
): JSX.Element {
	const canvas = <PageCanvas>{children}</PageCanvas>;
	const focus = chrome === "focus";
	// In focus mode every navigational exit is withheld, so the lane is not constructed at all — but
	// the middle-nav FRAME still renders whenever a band was registered, because the checkout stepper
	// lives in the header band and must span the canvas with no lane beside it. The frame's grid is
	// `auto minmax(0, 1fr)`, so an absent lane resolves column 1 to 0px and the bands simply start at
	// the frame's inline edge (measured: `0px 1265px`, header flush at x=0, zero overflow).
	const activeLane = focus ? undefined : lane;
	const framed = activeLane || middleNavHeader || middleNavFooter;
	return (
		<>
			<AppShell
				persona="user"
				chrome={chrome}
				brand={
					<div class="shell-headlead">
						<BrandMark />
						{showSearch && !focus ? <NavSearchBar /> : null}
					</div>
				}
				utilityBar={focus
					? null
					: <UserActions context={context} protectedRoute={protectedRoute} />}
				sidebar={focus ? undefined : <ShellSidebar path={path} context={context} />}
			>
				{framed
					? (
						<MiddleNav
							lane={activeLane
								? <MiddleNavSplitter>{activeLane}</MiddleNavSplitter>
								: undefined}
							header={middleNavHeader}
							footer={middleNavFooter}
						>
							{canvas}
						</MiddleNav>
					)
					: canvas}
			</AppShell>
			{
				/* Ergonomic mobile thumb-nav (Part D.3) — fixed, mobile-only (hidden ≥ --bp-md by CSS).
				   Withheld in focus chrome: on mobile it IS the side navigation, so leaving it would
				   reinstate on a phone every exit the mode removes on a desktop.
				   NOTE: withholding it does NOT by itself free the bottom edge. `middle-nav.css` lifts
				   the footer band by `--shell-bottomnav-h` unconditionally at ≤767px, so removing the
				   bar leaves a 56px dead gap under the step's commit action until the paired focus
				   rules in `middle-nav.css` / `page-canvas.css` drop the reservation too. */
			}
			{focus ? null : <BottomNav items={bottomNavItems(path)} label="Primary" />}
		</>
	);
}
