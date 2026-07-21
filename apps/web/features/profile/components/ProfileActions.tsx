import type { JSX } from "preact";
import { ctaFor } from "../core/profile-model.ts";
import { editMode, following } from "../core/profile-state.ts";
import { ProfileIcon } from "./profile-glyphs.tsx";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileActions — the Follow + primary-CTA (Hire / Message) cluster shared by the body header and the
 * migrated sticky header, so the two stay in lockstep (both read the module-level `following` signal).
 * For the owner it collapses to the Edit-profile toggle (you can't hire/follow yourself). Rendered
 * inside island trees, so the signal reads are reactive. `compact` drops the secondary Message for the
 * tight sticky bar.
 */
export function ProfileActions(
	{ profile, canEdit, compact = false }: {
		profile: ProfileView;
		canEdit: boolean;
		compact?: boolean;
	},
): JSX.Element {
	if (canEdit) {
		return (
			<div class="pf-actions">
				<button
					type="button"
					class="pf-btn pf-btn--primary"
					aria-pressed={editMode.value}
					onClick={() => (editMode.value = !editMode.value)}
				>
					<ProfileIcon name="edit" class="pf-btn__icon" />
					<span class="pf-btn__label">{editMode.value ? "Done editing" : "Edit profile"}</span>
				</button>
			</div>
		);
	}

	// Action sequence (root CLAUDE.md — Part 4.4): Follow · Message · Hire. Sellers (freelancer/team)
	// get the primary Hire; buyers (client/business) can't be hired, so Message is their primary. The
	// tight `compact` sticky bar keeps only Follow + the primary CTA.
	const cta = ctaFor(profile.kind);
	const seller = cta.primary === "Hire";
	const isFollowing = following.value;
	const hireHref = `/${profile.handle}/services`;
	return (
		<div class="pf-actions">
			<button
				type="button"
				class="pf-btn pf-btn--follow"
				data-on={isFollowing ? "true" : undefined}
				aria-pressed={isFollowing}
				onClick={() => (following.value = !isFollowing)}
			>
				<ProfileIcon name={isFollowing ? "following" : "follow"} class="pf-btn__icon" />
				<span class="pf-btn__label">{isFollowing ? "Following" : "Follow"}</span>
			</button>
			{(!compact || !seller) && (
				<a class={`pf-btn${seller ? "" : " pf-btn--primary"}`} href="/messages">
					<ProfileIcon name="message" class="pf-btn__icon" />
					<span class="pf-btn__label">Message</span>
				</a>
			)}
			{seller && (
				<a class="pf-btn pf-btn--primary" href={hireHref}>
					<ProfileIcon name="hire" class="pf-btn__icon" />
					<span class="pf-btn__label">Hire</span>
				</a>
			)}
		</div>
	);
}
