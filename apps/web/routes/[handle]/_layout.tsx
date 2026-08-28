import type { ComponentChildren } from "preact";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { GuestShell } from "@web/features/shell/components/GuestShell.tsx";
import { UserShell } from "@web/features/shell/components/UserShell.tsx";
import ProfileActionLane from "@features/profile/islands/ProfileActionLane.island.tsx";
import ProfileStickyHeader from "@features/profile/islands/ProfileStickyHeader.island.tsx";
import ProfileHeader from "@features/profile/islands/ProfileHeader.island.tsx";
import ProfileTabs from "@features/profile/islands/ProfileTabs.island.tsx";
import { ProfileAbout } from "@features/profile/components/ProfileAbout.tsx";
import { ProfileMetaSidebar } from "@features/profile/components/ProfileMetaSidebar.tsx";
import {
	viewLaneFor,
	viewLaneOptionsFor,
	viewOwnsLaneSlot,
} from "@features/view/core/view-lane-slot.tsx";
import { viewHeaderFor } from "@features/view/core/view-header-slot.tsx";
import { publicFooterFor } from "@features/marketing/core/footer-slot.tsx";
import {
	activeTabOf,
	defaultTabFor,
	isOwnProfile,
	TABS_ANCHOR,
} from "@features/profile/core/profile-model.ts";
// profile.css also pulls in the explore card/collection styles (via `@import`) that the reused
// components need — see the note there. Delivered through the profile islands that import it.
import "@features/profile/styles/profile.css";

/**
 * Profile shell (`/[handle]` wildcard namespace) — one layout for every profile entity (individual,
 * team, business) resolved by `@handle`. It mounts the contextual profile action lane and the
 * scroll-migrated sticky header, then paints the shared profile chrome (banner/avatar header ·
 * entity-driven tabs · split-view meta rail) around the per-route `Component`.
 *
 * Two shells by auth state (DESIGN_SYSTEM.md Part D): a signed-in viewer gets the unified
 * {@link UserShell} L-shell (the action lane in its middle-nav frame + the sticky header band) so the
 * app chrome matches everywhere; a guest gets the unified floating {@link GuestShell} — the same
 * pill site header as every other guest surface, with the action lane in a floating side nav and the
 * sticky header in a floating sub-header. The profile-scoped item viewer (`/[handle]/view/[id]`) and a
 * reserved/unresolved handle render standalone (no profile chrome).
 */
export default define.page(function ProfileLayout(ctx) {
	const profile = ctx.state.profile;
	const path = ctx.url.pathname;
	const authed = !!ctx.state.isAuthenticated;
	const context = ctx.state.userContext;
	const handleParam = ctx.params.handle ?? path.split("/").filter(Boolean)[0] ?? "";

	/**
	 * Wrap body content in the auth-appropriate shell, optionally with a lane + sticky header.
	 *
	 * `footer` renders the marketing footer at the body's end — off for the full-page calendars, which
	 * fill the content region and own their own scrolling. BOTH shells honour it now: the guest branch
	 * passes it straight to {@link GuestShell}, and the authed branch composes it with the URL-keyed
	 * `publicFooterFor` resolver, the same one the sibling `(public)` layout uses where no such local
	 * flag exists. The composition is deliberately NARROWING — the flag can only ever withhold a footer
	 * the resolver already agreed to, never add one it refused — so the two cannot drift apart in the
	 * direction that would put a masthead under a full-page calendar.
	 */
	const shell = (
		lane: ComponentChildren,
		header: ComponentChildren,
		children: ComponentChildren,
		footer = true,
	): ComponentChildren => {
		if (authed) {
			return (
				<UserShell
					path={path}
					context={asAuthenticatedContext(context)}
					lane={lane}
					laneOptions={viewLaneOptionsFor(ctx.url)}
					middleNavHeader={header}
					bodyFooter={footer ? publicFooterFor(ctx.url) : null}
				>
					{children}
				</UserShell>
			);
		}
		return (
			<GuestShell lane={lane} header={header} footer={footer}>
				{children}
			</GuestShell>
		);
	};

	// Reserved route word / unresolved handle → a calm not-found (no profile chrome).
	if (!profile) {
		return shell(
			undefined,
			undefined,
			(
				<div class="pf pf-notfound">
					<h1 class="pf-notfound__title">Profile not found</h1>
					<p class="pf-notfound__note">
						“/{handleParam}” isn’t a profile on Projective.
					</p>
					<a class="pf-btn pf-btn--primary" href="/explore">Explore Projective</a>
				</div>
			),
		);
	}

	const canEdit = isOwnProfile(profile, context);
	const lane = <ProfileActionLane profile={profile} canEdit={canEdit} path={path} />;
	const stickyHeader = <ProfileStickyHeader profile={profile} canEdit={canEdit} />;
	const segments = path.split("/").filter(Boolean);

	// The profile-scoped Entity View page renders its own Amazon-style layout: mount the item's own
	// action lane (pricing/CTAs/trust) — resolved from the URL like the public `/view/[id]` — instead of
	// the profile action lane, and drop the profile header/tabs/split (no sticky-header migration).
	if (segments[1] === "view") {
		// The session-schedule leaf (/[handle]/view/[id]/schedule) is a full-page calendar surface —
		// no lane/footer (like the availability calendar); the schedule island fills the region itself.
		if (segments[3] === "schedule") {
			return shell(undefined, undefined, <ctx.Component />, false);
		}
		/*
		 * `viewLaneFor` owns the slot for any id that RESOLVES, and for a commerce archetype it returns a
		 * collapsed back rail on the authenticated shell and `null` on the guest one — that listing's
		 * conversion rail is the view page's own end column, so the shell must never mount a second
		 * panel beside it. Falling back to the profile lane there would pin a panel about the SELLER on
		 * one edge of a page about one of their listings, with the listing's conversion rail on the
		 * other. The profile lane stays the fallback for an id that resolves to nothing.
		 */
		const viewLane = viewOwnsLaneSlot(ctx.url)
			? viewLaneFor(ctx.url, authed, ctx.state.userContext)
			: lane;
		// The Projects view mirrors the profile's scroll-migrated sticky header in the middle-nav band
		// (null for articles / the generic view — no band).
		const viewHeader = viewHeaderFor(ctx.url, authed, ctx.state.userContext);
		return shell(viewLane, viewHeader, <ctx.Component />);
	}

	// The Availability calendar keeps the profile's LANE and a PINNED identity band, but not the body
	// chrome (no header/tabs/Overview) — the calendar carries its own mini-map + availability panel +
	// controls and fills the content region. It previously rendered with neither, which left the page
	// with no identity ("whose calendar is this?") and — because the lane's Profile ⁄ Availability
	// toggle was the only route in — literally zero links back to the profile. The band is `pinned`
	// because there is no body header here to migrate from, so it is simply present.
	if (segments[1] === "availability") {
		return shell(
			lane,
			<ProfileStickyHeader profile={profile} canEdit={canEdit} pinned />,
			<ctx.Component />,
			false,
		);
	}

	// The active tab highlighted below the permanent Overview — the URL segment, or the kind's default
	// (Services) on the bare `/@handle` index (root CLAUDE.md — Part 1.1).
	const active = activeTabOf(path) ?? defaultTabFor(profile.kind);
	// Single full-width column (root CLAUDE.md — Part 1): identity → the PERMANENT Overview → the tab
	// bar + the routed tab body. The meta facts moved into the LANE, which already owns scope and
	// persists across every tab; as a body rail they reserved 18rem + a 2rem gutter on every tab for a
	// block that measured ~324px of content, which is what held the work grid to one column up to a
	// 1600px display. `--inline` below is the ≤767px fallback, where no lane exists.
	return shell(
		lane,
		stickyHeader,
		(
			<div class="pf-scope">
				<div class="pf">
					<ProfileHeader profile={profile} canEdit={canEdit} />
					<ProfileAbout profile={profile} canEdit={canEdit} />
					<ProfileMetaSidebar profile={profile} variant="inline" />
					<section id={TABS_ANCHOR} class="pf-sections" aria-label="Profile sections">
						<ProfileTabs profile={profile} active={active} />
						{
							/* `.ex` establishes the explore-card `--ex-*` token context for the reused
					    collections (neutralised to a bare token-carrier in profile.css). */
						}
						<div class="ex pf-tabpanel">
							<ctx.Component />
						</div>
					</section>
				</div>
			</div>
		),
	);
});
