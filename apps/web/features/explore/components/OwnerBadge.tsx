import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { VerifiedBadge } from "./VerifiedBadge.tsx";
import { profileHref } from "../core/routing.ts";
import type { ExploreOwner } from "../types/explore-types.ts";
import { personFallbackImage } from "@web/components/UserAvatar.tsx";

/**
 * OwnerBadge — the owner attribution present on every explore card: the individual's, team's, or
 * business's avatar/logo + name (+ `@handle`). Every anchor is a real `<a href>` to the owner's
 * profile, stacked above the card's stretched link (see explore.css) so it stays independently
 * clickable, keyboard-reachable and middle-click safe. The verified crest is the shared
 * {@link VerifiedBadge} (tooltip-driven) and always sits OUTSIDE an anchor, since it carries its own
 * tooltip trigger.
 *
 * The `creator` variant is ONE anchor spanning the avatar and the display name: two links to one
 * destination side by side would be two tab stops announcing the same thing. The avatar is hidden
 * from assistive tech inside it, so the link's accessible name is the visible name alone.
 */
export function OwnerBadge(
	{ owner, size = "sm", variant = "full" }: {
		owner: ExploreOwner;
		size?: "sm" | "md";
		/**
		 * `mini` = the compact thumbnail owner-row: a tiny circular avatar + `@handle` only, inline.
		 * `creator` = the service/product card's creator row: a small avatar + the DISPLAY NAME, so the
		 * card names a person rather than a handle. The avatar and the name are one anchor together.
		 */
		variant?: "full" | "mini" | "creator";
	},
): JSX.Element {
	const href = profileHref(owner.handle);
	if (variant === "mini") {
		return (
			<span class="ex-owner ex-owner--mini">
				<a class="ex-owner__avatar-link" href={href} aria-label={`${owner.name} — view profile`}>
					<Avatar
						image={owner.avatar}
						fallbackImage={personFallbackImage(owner.kind)}
						placeholder={owner.avatarPlaceholder}
						label={owner.name}
						alt=""
						size="sm"
						shape={owner.kind === "business" ? "square" : "circle"}
						class="ex-owner__avatar"
					/>
				</a>
				<a class="ex-owner__handle" href={href}>{owner.handle}</a>
			</span>
		);
	}
	if (variant === "creator") {
		return (
			<span class="ex-owner ex-owner--creator">
				<a class="ex-owner__link" href={href}>
					<span class="ex-owner__avatar-wrap" aria-hidden="true">
						<Avatar
							image={owner.avatar}
							fallbackImage={personFallbackImage(owner.kind)}
							placeholder={owner.avatarPlaceholder}
							label={owner.name}
							alt=""
							size="sm"
							shape={owner.kind === "business" ? "square" : "circle"}
							class="ex-owner__avatar"
						/>
					</span>
					<span class="ex-owner__name">
						<span class="ex-owner__nametext">{owner.name}</span>
					</span>
				</a>
				{owner.verified && <VerifiedBadge size="sm" />}
			</span>
		);
	}
	return (
		<span class={`ex-owner ex-owner--${size}`}>
			<a class="ex-owner__avatar-link" href={href} aria-label={`${owner.name} — view profile`}>
				<Avatar
					image={owner.avatar}
					fallbackImage={personFallbackImage(owner.kind)}
					placeholder={owner.avatarPlaceholder}
					label={owner.name}
					alt=""
					size={size === "md" ? "md" : "sm"}
					shape={owner.kind === "business" ? "square" : "circle"}
					class="ex-owner__avatar"
				/>
			</a>
			<span class="ex-owner__id">
				<span class="ex-owner__name">
					<span class="ex-owner__nametext">{owner.name}</span>
					{owner.verified && <VerifiedBadge size={size === "md" ? "md" : "sm"} />}
				</span>
				<a class="ex-owner__handle" href={href}>{owner.handle}</a>
			</span>
		</span>
	);
}
