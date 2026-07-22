import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import "../styles/profile.css";
import { ProfileActions } from "../components/ProfileActions.tsx";
import { EntityBadge } from "../components/ProfileBadges.tsx";
import { ProfileIcon, TIER_META } from "../components/profile-glyphs.tsx";
import { headerCondensed } from "../core/profile-state.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileHeader — the main body header (root CLAUDE.md Part 1.1/1.3): a wide cover banner with the
 * circular avatar overlapping its bottom edge (4px page-background border, §C.4), then the display
 * name, `@handle`, headline, follower stats, and the Follow + primary-CTA cluster.
 *
 * It also OWNS the scroll-migration probe: a window-scroll listener flips the shared `headerCondensed`
 * signal once this header scrolls up under the sticky top bar, which the `ProfileStickyHeader` island in
 * the `ui-middle-nav__header` band reads to slide the condensed identity in (and CSS expands the band
 * from 0). Native window scroll (Decision #31) — so the probe watches `window`, not an inner container.
 */
export interface ProfileHeaderProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile (swaps the CTA cluster for Edit-profile). */
	canEdit: boolean;
}

export default function ProfileHeader({ profile, canEdit }: ProfileHeaderProps): JSX.Element {
	const root = useRef<HTMLElement>(null);

	useEffect(() => {
		const topbar = Number.parseInt(
			getComputedStyle(document.documentElement).getPropertyValue("--shell-topbar-h"),
			10,
		) || 48;
		// Condense once the header's foot passes a little below the top bar — the identity has scrolled
		// far enough that migrating it into the sticky band keeps it available.
		const threshold = topbar + 24;
		const onScroll = () => {
			const el = root.current;
			if (!el) return;
			headerCondensed.value = el.getBoundingClientRect().bottom <= threshold;
		};
		onScroll();
		globalThis.addEventListener("scroll", onScroll, { passive: true });
		globalThis.addEventListener("resize", onScroll);
		return () => {
			globalThis.removeEventListener("scroll", onScroll);
			globalThis.removeEventListener("resize", onScroll);
		};
	}, []);

	return (
		<header class="pf-header" ref={root}>
			<div
				class="pf-header__banner"
				style={`background-image:url("${profile.banner}")`}
				aria-hidden="true"
			/>
			<div class="pf-header__bar">
				<Avatar
					image={profile.avatar}
					label={profile.name}
					size={112}
					shape="circle"
					class="pf-header__avatar"
				/>
				<div class="pf-header__id">
					<h1 class="pf-header__name">
						<span class="pf-header__nametext">{profile.name}</span>
						{
							/* Verification badge beside the name (root CLAUDE.md — Part 1.3, relocated from the
						    Overview). Icon-led with the tier label; the full title lives in the tooltip. */
						}
						<Tooltip content={TIER_META[profile.tier].title} placement="top">
							<span
								class="pf-header__tier pf-tier"
								data-tier={profile.tier}
								aria-label={TIER_META[profile.tier].title}
							>
								<ProfileIcon name="verified" class="pf-tier__mark" />
								<span class="pf-tier__label">{TIER_META[profile.tier].label}</span>
							</span>
						</Tooltip>
					</h1>
					<div class="pf-header__idline">
						<span class="pf-header__handle">{profile.handle}</span>
						{/* Explicit entity-type badge adjacent to the @handle (Part 1). */}
						<EntityBadge kind={profile.kind} />
					</div>
					<p class="pf-header__headline">{profile.headline}</p>
				</div>
				<div class="pf-header__actions">
					<ProfileActions profile={profile} canEdit={canEdit} />
				</div>
			</div>
		</header>
	);
}
