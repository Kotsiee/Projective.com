import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { VerifiedBadge } from "./VerifiedBadge.tsx";
import { profileHref } from "../core/routing.ts";
import type { ExploreOwner } from "../types/explore-types.ts";

/**
 * OwnerBadge — the owner attribution present on every explore card: the individual's, team's, or
 * business's avatar/logo + name (+ `@handle`). Profile navigation is bound EXCLUSIVELY to the avatar
 * and the `@handle` — each is its own anchor to the owner's profile — while the display name is inert
 * text (clicking the name never routes). This also keeps the sub-anchors independently clickable and
 * middle-click safe when the badge sits inside a card's stretched link (they stack above it — see
 * explore.css). The verified crest is the shared {@link VerifiedBadge} (tooltip-driven).
 */
export function OwnerBadge(
	{ owner, size = "sm", variant = "full" }: {
		owner: ExploreOwner;
		size?: "sm" | "md";
		/** `mini` = the compact thumbnail owner-row: a tiny circular avatar + `@handle` only, inline. */
		variant?: "full" | "mini";
	},
): JSX.Element {
	const href = profileHref(owner.handle);
	if (variant === "mini") {
		return (
			<span class="ex-owner ex-owner--mini">
				<a class="ex-owner__avatar-link" href={href} aria-label={`${owner.name} — view profile`}>
					<Avatar
						image={owner.avatar}
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
	return (
		<span class={`ex-owner ex-owner--${size}`}>
			<a class="ex-owner__avatar-link" href={href} aria-label={`${owner.name} — view profile`}>
				<Avatar
					image={owner.avatar}
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
