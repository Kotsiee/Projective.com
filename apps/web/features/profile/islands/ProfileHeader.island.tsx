import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import "../styles/profile.css";
import { ProfileActions } from "../components/ProfileActions.tsx";
import { EntityBadge } from "../components/ProfileBadges.tsx";
import { ProfileIcon, TIER_META } from "../components/profile-glyphs.tsx";
import { editedAvatar, editedBanner, headerCondensed } from "../core/profile-state.ts";
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
 *
 * ## Changing the banner and the avatar
 *
 * An OWNER gets a picker on each, in place, with no edit mode to enter — the same "inline editing needs
 * no edit mode" rule the story field already follows (Decision #36). Both are restricted to images, and
 * both go through the Asset Picker rather than a file input: a profile picture is almost always
 * something the person already has on the platform, and routing it through the library means one copy,
 * one place to change it, and one slice of quota.
 *
 * The change is optimistic and session-local, like every other inline profile edit, pending
 * `PROFILE_BACKEND_LIVE`.
 */

/**
 * The Asset Picker routing key.
 *
 * ONE key for both targets, with the target held locally: only one of the two can be open at a time
 * (the picker is a modal), so a second key would disambiguate nothing and mount a second dialog.
 */
const PICKER_ID = "profile-image";

/** Which image the open picker is choosing. */
type ImageTarget = "banner" | "avatar";

export interface ProfileHeaderProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile (swaps the CTA cluster for Edit-profile). */
	canEdit: boolean;
}

export default function ProfileHeader({ profile, canEdit }: ProfileHeaderProps): JSX.Element {
	const root = useRef<HTMLElement>(null);

	// The owner's edits live in the shared bridge, not here: the condensed sticky header draws the same
	// avatar from a different island, and a local signal would change one of the two.
	const banner = editedBanner.value ?? profile.banner;
	const avatar = editedAvatar.value ?? profile.avatar;
	const target = useSignal<ImageTarget>("banner");

	function choose(which: ImageTarget): void {
		target.value = which;
		openPicker({
			requesterId: PICKER_ID,
			title: which === "banner" ? "Choose a cover image" : "Choose a profile picture",
			kinds: ["image"],
			multiple: false,
		});
	}

	function apply(assets: AssetItem[]): void {
		const picked = assets[0];
		if (!picked) return;
		// The full asset, not the thumbnail: a banner is rendered at up to the full page width and a
		// thumbnail scaled to it is visibly soft. The avatar takes the thumbnail when there is one,
		// because it is drawn at 112px and the full image is bytes nobody sees.
		if (target.value === "banner") editedBanner.value = picked.url;
		else editedAvatar.value = picked.thumbnailUrl ?? picked.url;
	}

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
				style={`background-image:url("${banner}")`}
				aria-hidden="true"
			/>
			{canEdit
				? (
					<Tooltip content="Change cover image" placement="left">
						<button
							type="button"
							class="pf-header__imgbtn pf-header__imgbtn--banner"
							aria-label="Change cover image"
							onClick={() => choose("banner")}
						>
							<Icon name="image" size="xs" aria-hidden="true" />
						</button>
					</Tooltip>
				)
				: null}
			<div class="pf-header__bar">
				<div class="pf-header__avatarwrap">
					<Avatar
						image={avatar}
						label={profile.name}
						size={112}
						shape="circle"
						class="pf-header__avatar"
					/>
					{canEdit
						? (
							<Tooltip content="Change profile picture" placement="bottom">
								<button
									type="button"
									class="pf-header__imgbtn pf-header__imgbtn--avatar"
									aria-label="Change profile picture"
									onClick={() => choose("avatar")}
								>
									<Icon name="image" size="2xs" aria-hidden="true" />
								</button>
							</Tooltip>
						)
						: null}
				</div>
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

			{
				/* Mounted unconditionally, and NOT behind `canEdit`: an island is only in the page's island
			    graph once it renders, and that graph is what carries its stylesheet. It draws nothing
			    until it is opened, and only an owner has a control that opens it. */
			}
			<AssetPicker requesterId={PICKER_ID} onPick={apply} />
		</header>
	);
}
