import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { vars } from "../core/style.ts";
import { type ProfileShowcase, routes } from "../core/landing-data.ts";

/**
 * ProfileCard — a discovery card for a freelancer or an assembled team, in the landing carousel.
 *
 * Renders the CANONICAL talent banner (`.ex-card--banner .ex-card--talent`, defined once in
 * `features/explore/styles/explore.css` and `@import`ed by `landing.css`) rather than a parallel
 * `.lp-profile` block: cover, the circular avatar overlapping its lower edge, name + `@handle`, the
 * one-line craft headline, a single quiet metadata line, and the rate foot.
 *
 * Two divergences from the old `.lp-profile` are deliberate. The skills `Tag` cluster is gone — the
 * discovery cards dropped skill rows to the detail view in the lean pass, and a landing card showing a
 * band the search feed does not is history, not a difference in the entity. And the rating is the
 * shared {@link RatingStars} in its single-glyph `compact` form rather than a bespoke primary-coloured
 * star, so one rating treatment reads across every surface.
 *
 * The whole card is one route action; zero client JS, hydration lives in the parent carousel island.
 */
export function ProfileCard({ profile }: { profile: ProfileShowcase }): JSX.Element {
	const isTeam = profile.kind === "team";
	return (
		<article
			class="ex-card ex-card--banner ex-card--talent"
			style={vars({ "--ex-cover": `url("${profile.cover}")` })}
		>
			<a
				class="ex-card__link"
				href={routes.profile(profile.handle)}
				aria-label={`${profile.name} — ${profile.craft}`}
			/>
			<div class="ex-banner__cover" aria-hidden="true" />
			<div class="ex-banner__body">
				<div class="ex-banner__id">
					<Avatar
						image={profile.avatar}
						alt=""
						size="lg"
						shape="circle"
						class="ex-banner__avatar"
					/>
					<span class="ex-banner__idtext">
						<span class="ex-banner__name">
							<span class="ex-banner__nametext">{profile.name}</span>
						</span>
						<span class="ex-banner__handle">{profile.handle}</span>
					</span>
				</div>

				<p class="ex-talent__headline">{profile.craft}</p>

				<div class="ex-talent__meta">
					<RatingStars
						value={profile.rating}
						size="sm"
						compact
						label={`Rated ${profile.rating.toFixed(1)} out of 5`}
					/>
					<span class="ex-talent__count">{profile.delivered} delivered</span>
					{isTeam && profile.members
						? <span class="ex-talent__count">{profile.members} people</span>
						: null}
				</div>

				<div class="ex-card__foot">
					<span class="ex-muted">{isTeam ? "Team" : "Freelancer"}</span>
					<span class="ex-price">{profile.rate}</span>
				</div>
			</div>
		</article>
	);
}
