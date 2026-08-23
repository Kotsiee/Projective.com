import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { type ProfileShowcase, routes } from "../core/landing-data.ts";

/**
 * ProfileCard — a discovery card for a freelancer or an assembled team, in the landing carousel.
 *
 * Renders the CANONICAL profile card (`.ex-card--profile`, defined once in
 * `features/explore/styles/explore.css` and `@import`ed by `landing.css`) rather than a parallel
 * `.lp-profile` block: a masked cover, the circular avatar centred on its lower edge, the centred name
 * and `@handle`, the craft headline, a quiet metadata line, and a rating/rate foot.
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
		<article class="ex-card ex-card--profile" data-ambient-src={profile.cover}>
			<a
				class="ex-card__link"
				href={routes.profile(profile.handle)}
				aria-label={`${profile.name} — ${profile.craft}`}
			/>
			<div class="ex-pcard__banner">
				<img
					class="ex-pcard__cover"
					src={profile.cover}
					alt=""
					loading="lazy"
					decoding="async"
				/>
			</div>
			<div class="ex-pcard__body">
				<div class="ex-pcard__identity">
					<Avatar
						image={profile.avatar}
						alt=""
						size="xl"
						shape="circle"
						class="ex-pcard__avatar"
					/>
					<span class="ex-pcard__name">
						<span class="ex-pcard__nametext">{profile.name}</span>
					</span>
					<span class="ex-pcard__handle">{profile.handle}</span>
				</div>

				<p class="ex-pcard__headline">{profile.craft}</p>

				<p class="ex-pcard__meta">
					{isTeam && profile.members
						? `${isTeam ? "Team" : "Freelancer"} • ${profile.members} people`
						: "Freelancer"}
				</p>

				<div class="ex-pcard__foot">
					<RatingStars
						value={profile.rating}
						size="sm"
						compact
						label={`Rated ${profile.rating.toFixed(1)} out of 5`}
					/>
					<ul class="ex-pcard__metrics" role="list">
						<li class="ex-pcard__metric">
							<span class="ex-pcard__metric-value">{profile.delivered}</span>{" "}
							<span class="ex-pcard__metric-label">delivered</span>
						</li>
						<li class="ex-pcard__metric">
							<span class="ex-pcard__metric-value">{profile.rate}</span>
						</li>
					</ul>
				</div>
			</div>
		</article>
	);
}
