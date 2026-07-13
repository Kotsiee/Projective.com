import type { JSX } from "preact";
import { Avatar, Badge, Tag } from "@projective/ui/display";
import { type ProfileShowcase, routes } from "../core/landing-data.ts";
import { vars } from "../core/style.ts";

/**
 * ProfileCard — a direct-action discovery card for a freelancer or team. The whole card is the route
 * action (anchor → `[handle]`), so the four-sided treatment is legitimate (interactive element, §B.4).
 * Composes library atoms (Avatar, Tag, Badge) over a photographic cover. Zero client JS — hydration
 * lives in the parent carousel island.
 */
export function ProfileCard({ profile }: { profile: ProfileShowcase }): JSX.Element {
	const isTeam = profile.kind === "team";
	return (
		<a
			class="lp-card lp-profile"
			href={routes.profile(profile.handle)}
			style={vars({ "--lp-cover": `url("${profile.cover}")` })}
			aria-label={`${profile.name} — ${profile.craft}`}
		>
			<div class="lp-profile__cover" aria-hidden="true">
				<Badge
					value={isTeam ? `Team · ${profile.members}` : "Helper"}
					severity={isTeam ? "primary" : "secondary"}
				/>
			</div>
			<div class="lp-profile__body">
				<div class="lp-profile__head">
					<Avatar image={profile.avatar} alt="" size="lg" class="lp-profile__avatar" />
					<div class="lp-profile__id">
						<span class="lp-profile__name">{profile.name}</span>
						<span class="lp-profile__handle">{profile.handle}</span>
					</div>
				</div>
				<p class="lp-profile__craft">{profile.craft}</p>
				<div class="lp-profile__skills">
					{profile.skills.map((s) => <Tag key={s} value={s} variant="subtle" rounded />)}
				</div>
				<div class="lp-profile__foot">
					<span class="lp-profile__rating" aria-label={`Rated ${profile.rating} out of 5`}>
						★ {profile.rating.toFixed(1)}
						<span class="lp-profile__delivered">· {profile.delivered} delivered</span>
					</span>
					<span class="lp-profile__rate">{profile.rate}</span>
				</div>
			</div>
		</a>
	);
}
