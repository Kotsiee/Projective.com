import type { ComponentChildren } from "preact";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { GuestShell } from "@web/features/shell/components/GuestShell.tsx";
import { UserShell } from "@web/features/shell/components/UserShell.tsx";
import TicketDeepLinkHost from "@web/features/projects/islands/TicketDeepLinkHost.island.tsx";
import ProfileHero from "@features/profile/islands/ProfileHero.island.tsx";
import ProfileStyleAnchor from "@features/profile/islands/ProfileStyleAnchor.island.tsx";
import { ProfileContextBar } from "@features/profile/components/ProfileContextBar.tsx";
import { ProfileTabs } from "@features/profile/components/ProfileTabs.tsx";
import { ProfileCalendarHead } from "@features/profile/components/ProfileCalendarHead.tsx";
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

/**
 * Profile shell (`/[handle]` wildcard namespace) — one layout for every profile entity (individual,
 * team, business, organisation) resolved by `@handle`.
 *
 * The surface is ONE column in the native window scroll (root CLAUDE.md §8 Decision #96): the split
 * hero → the context bar → the four-section tab bar → the routed section body. There is no middle-nav
 * lane, no splitter and no migrating sticky header — the profile mounts nothing in the shell's lane
 * slot, so the authenticated {@link UserShell} renders a bare {@link PageCanvas} and the guest
 * {@link GuestShell} its lane-less header + body + footer flow.
 *
 * Two routes under the namespace keep their own chrome: the profile-scoped item viewer
 * (`/[handle]/view/[id]`, which resolves ITS lane from the URL like the public `/view/[id]`) and the
 * full-page availability calendar (`/[handle]/availability`, which fills the content region and gets
 * only a one-line identity strip with a way back).
 */
export default define.page(function ProfileLayout(ctx) {
	const profile = ctx.state.profile;
	const path = ctx.url.pathname;
	const authed = !!ctx.state.isAuthenticated;
	const context = ctx.state.userContext;
	const handleParam = ctx.params.handle ?? path.split("/").filter(Boolean)[0] ?? "";

	/**
	 * Wrap body content in the auth-appropriate shell. `lane`/`header` are only ever set by the item
	 * viewer branch; the profile itself passes neither.
	 *
	 * `footer` renders the marketing footer at the body's end — off for the full-page calendars, which
	 * fill the content region and own their own scrolling. The authed branch composes it with the
	 * URL-keyed `publicFooterFor` resolver (the same one the sibling `(public)` layout uses), NARROWING
	 * only — the flag can withhold a footer the resolver agreed to, never add one it refused.
	 */
	const shell = (
		children: ComponentChildren,
		options: { lane?: ComponentChildren; header?: ComponentChildren; footer?: boolean } = {},
	): ComponentChildren => {
		const footer = options.footer ?? true;
		if (authed) {
			return (
				<UserShell
					path={path}
					context={asAuthenticatedContext(context)}
					lane={options.lane}
					laneOptions={options.lane ? viewLaneOptionsFor(ctx.url) : undefined}
					middleNavHeader={options.header}
					bodyFooter={footer ? publicFooterFor(ctx.url) : null}
				>
					{/* The `?tkv=` ticket deep link — same host as the dashboard, same rules. */}
					<TicketDeepLinkHost authed />
					{children}
				</UserShell>
			);
		}
		return (
			<GuestShell
				lane={options.lane}
				header={options.header}
				footer={footer}
				returnTo={ctx.url.pathname + ctx.url.search}
			>
				{/* A guest only ever loses the parameter; the host opens nothing for them. */}
				<TicketDeepLinkHost authed={false} />
				{children}
			</GuestShell>
		);
	};

	// Reserved route word / unresolved handle → a calm not-found (no profile chrome).
	if (!profile) {
		return shell(
			<div class="pf pf-notfound">
				{/* No profile island mounts on this branch, so the sheet needs its own carrier. */}
				<ProfileStyleAnchor />
				<h1 class="pf-notfound__title">Profile not found</h1>
				<p class="pf-notfound__note">
					“/{handleParam}” isn’t a profile on Projective.
				</p>
				<a class="pf-notfound__link" href="/explore">Explore Projective</a>
			</div>,
		);
	}

	const canEdit = isOwnProfile(profile, context);
	const segments = path.split("/").filter(Boolean);

	// The profile-scoped Entity View page renders its own layout: mount the item's own action lane
	// (pricing/CTAs/trust) — resolved from the URL like the public `/view/[id]` — and no profile chrome.
	if (segments[1] === "view") {
		// The session-schedule leaf (/[handle]/view/[id]/schedule) is a full-page calendar surface —
		// no lane/footer; the schedule island fills the region itself.
		if (segments[3] === "schedule") {
			return shell(<ctx.Component />, { footer: false });
		}
		/*
		 * `viewLaneFor` owns the slot for any id that RESOLVES, and for a commerce archetype it returns a
		 * collapsed back rail on the authenticated shell and `null` on the guest one — that listing's
		 * conversion rail is the view page's own end column, so the shell must never mount a second
		 * panel beside it. An id that resolves to nothing gets no lane at all now (the profile no
		 * longer has one to fall back to).
		 */
		const lane = viewOwnsLaneSlot(ctx.url)
			? viewLaneFor(ctx.url, authed, ctx.state.userContext)
			: undefined;
		// The Projects view mirrors its own scroll-migrated sticky header in the middle-nav band (null
		// for articles / the generic view — no band).
		const header = viewHeaderFor(ctx.url, authed, ctx.state.userContext);
		return shell(<ctx.Component />, { lane: lane ?? undefined, header });
	}

	// The Availability calendar fills the content region; it gets a one-line identity strip so the
	// page still says whose calendar it is and carries a way back to the profile.
	if (segments[1] === "availability") {
		return shell(
			<div class="pf-scope pf-scope--calendar">
				<ProfileCalendarHead profile={profile} />
				<ctx.Component />
			</div>,
			{ footer: false },
		);
	}

	// The active section highlighted in the tab bar — the URL segment, or Work on the bare index.
	const active = activeTabOf(path) ?? defaultTabFor(profile.kind);
	return shell(
		<div class="pf-scope">
			<div class="pf">
				<ProfileHero profile={profile} canEdit={canEdit} />
				<ProfileContextBar profile={profile} canEdit={canEdit} />
				<section id={TABS_ANCHOR} class="pf-sections" aria-label="Profile sections">
					<ProfileTabs profile={profile} active={active} />
					{
						/* `.ex` establishes the explore-card `--ex-*` token context for the reused
					    collections (neutralised to a bare token-carrier in profile-work.css). */
					}
					<div class="ex pf-tabpanel">
						<ctx.Component />
					</div>
				</section>
			</div>
		</div>,
	);
});
