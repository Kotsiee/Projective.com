import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import "../styles/profile.css";
import { ProfileActions } from "../components/ProfileActions.tsx";
import { editedAvatar, headerCondensed } from "../core/profile-state.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileStickyHeader — the condensed identity that MIGRATES into the middle-nav frame's header band
 * (`ui-middle-nav__header`) as the main body header scrolls away (root CLAUDE.md Part 1.3). It reads the
 * shared `headerCondensed` signal (set by the body `ProfileHeader`'s scroll probe) and stamps
 * `data-condensed`, which CSS uses to slide the band open from 0 height (so there is no empty bar
 * before the user scrolls) — a smooth reveal, jump-to-final under reduced-motion. It carries the avatar,
 * name, `@handle`, and the same Follow / primary-CTA cluster (reused from `ProfileActions`).
 */
export interface ProfileStickyHeaderProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile (swaps the CTA for Edit-profile). */
	canEdit: boolean;
	/**
	 * Render the band open from the first byte instead of migrating it on scroll. Set on surfaces that
	 * have no body `ProfileHeader` to migrate FROM — today the availability calendar, which otherwise
	 * showed no identity at all: nothing on the page said whose calendar it was.
	 */
	pinned?: boolean;
}

export default function ProfileStickyHeader(
	{ profile, canEdit, pinned = false }: ProfileStickyHeaderProps,
): JSX.Element {
	const condensed = pinned || headerCondensed.value;
	return (
		<div
			class="pf-stickyhead"
			data-condensed={condensed ? "true" : "false"}
			// Hide the whole condensed header from assistive tech until it is revealed (CSS `visibility`
			// also drops every descendant from the tab order while collapsed).
			aria-hidden={condensed ? undefined : "true"}
		>
			<a class="pf-stickyhead__id" href={`/${profile.handle}`}>
				{/* The owner's in-place pick wins over the server's projection; `null` means unchanged. */}
				<Avatar
					image={editedAvatar.value ?? profile.avatar}
					label={profile.name}
					size={30}
					shape="circle"
				/>
				<span class="pf-stickyhead__name">
					{profile.name}
					{profile.verified
						? <Icon name="verified" class="pf-stickyhead__verified" filled />
						: null}
				</span>
				<span class="pf-stickyhead__handle">{profile.handle}</span>
			</a>
			<div class="pf-stickyhead__actions">
				<ProfileActions profile={profile} canEdit={canEdit} compact />
			</div>
		</div>
	);
}
