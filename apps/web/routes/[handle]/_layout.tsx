import type { ComponentChildren } from "preact";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { GuestShell } from "@web/features/shell/components/GuestShell.tsx";
import { UserShell } from "@web/features/shell/components/UserShell.tsx";
import ProfileActionLane from "@features/profile/islands/ProfileActionLane.island.tsx";
import ProfileStickyHeader from "@features/profile/islands/ProfileStickyHeader.island.tsx";
import ProfileHeader from "@features/profile/islands/ProfileHeader.island.tsx";
import { ProfileTabs } from "@features/profile/components/ProfileTabs.tsx";
import { ProfileAbout } from "@features/profile/components/ProfileAbout.tsx";
import { ProfileMetaSidebar } from "@features/profile/components/ProfileMetaSidebar.tsx";
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
	 * Wrap body content in the auth-appropriate shell, optionally with a lane + sticky header. `footer`
	 * (guest only) renders the marketing footer at the body's end — off for the full-page availability
	 * calendar. The authed shell never carries the marketing footer.
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
					middleNavHeader={header}
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

	// The profile-scoped item viewer renders its own EntityView layout — keep the action lane for
	// context, but not the profile header/tabs/split (no sticky-header migration either).
	if (segments[1] === "view") {
		return shell(lane, undefined, <ctx.Component />);
	}

	// The Availability calendar is a full-page, app-like surface — it does NOT use the profile chrome
	// (no header/tabs/meta rail) or the lane; the calendar carries its own mini-map + availability
	// panel + controls, and fills the whole content region under the header. No footer (the calendar
	// owns its own scroll).
	if (segments[1] === "availability") {
		return shell(undefined, undefined, <ctx.Component />, false);
	}

	// The active tab highlighted below the permanent Overview — the URL segment, or the kind's default
	// (Services) on the bare `/@handle` index (root CLAUDE.md — Part 1.1).
	const active = activeTabOf(path) ?? defaultTabFor(profile.kind);
	// Persistent split (root CLAUDE.md — Part 1 / Part 3): the main column carries the PERMANENT
	// Overview and then the tab bar + the routed tab body; the sticky meta rail sits alongside on every
	// tab (it is no longer Overview-only). `ctx.Component` is always a tab body now.
	return shell(
		lane,
		stickyHeader,
		(
			<div class="pf">
				<ProfileHeader profile={profile} canEdit={canEdit} />
				<div class="pf-split">
					<div class="pf-split__main">
						<ProfileAbout profile={profile} canEdit={canEdit} />
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
					<ProfileMetaSidebar profile={profile} />
				</div>
			</div>
		),
	);
});
