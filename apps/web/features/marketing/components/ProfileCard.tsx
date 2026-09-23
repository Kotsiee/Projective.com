import type { JSX } from "preact";
import { Avatar, ProgressiveImage, RatingStars } from "@projective/ui/display";
import { VerifiedBadge } from "@features/explore/components/VerifiedBadge.tsx";
import { type ProfileShowcase, routes } from "../core/landing-data.ts";

/**
 * ProfileCard — a discovery card for a freelancer or an assembled team, in the landing carousel.
 *
 * Renders the CANONICAL profile card (`.ex-card--profile`, defined once in
 * `features/explore/styles/explore.css` and `@import`ed by `landing.css`) rather than a parallel
 * `.lp-profile` block: a masked cover, the circular avatar centred on its lower edge, the centred name
 * and `@handle`, the craft headline, a quiet metadata line, and a rating ⁄ delivery foot.
 *
 * The rating is the shared {@link RatingStars} in its single-glyph `compact` form, and only when the
 * profile has been reviewed — an unreviewed helper shows their delivery count in that slot instead,
 * never an invented score.
 *
 * The whole card is one route action; zero client JS, hydration lives in the parent carousel island.
 */
export function ProfileCard({ profile }: { profile: ProfileShowcase }): JSX.Element {
	const meta = profile.kind === "team"
		? ["Team", profile.members ? `${profile.members} people` : null]
		: ["Freelancer"];
	const facts = meta.filter((s): s is string => !!s);
	return (
		<article class="ex-card ex-card--profile" data-ambient-src={profile.cover}>
			<a
				class="ex-card__link"
				href={routes.profile(profile.handle)}
				aria-label={`${profile.name} — ${profile.craft}`}
			/>
			<div class="ex-pcard__banner">
				<ProgressiveImage
					class="ex-pcard__cover"
					src={profile.cover}
					placeholder={profile.coverPlaceholder}
					loading="lazy"
				/>
			</div>
			<div class="ex-pcard__body">
				<div class="ex-pcard__identity">
					<Avatar
						image={profile.avatar}
						placeholder={profile.avatarPlaceholder}
						label={profile.name}
						alt=""
						size="xl"
						shape="circle"
						class="ex-pcard__avatar"
					/>
					<span class="ex-pcard__name">
						<span class="ex-pcard__nametext">{profile.name}</span>
						{profile.verified && <VerifiedBadge size="md" />}
					</span>
					<span class="ex-pcard__handle">{profile.handle}</span>
				</div>

				<p class="ex-pcard__headline">{profile.craft}</p>

				<p class="ex-pcard__meta">
					{facts.map((fact, i) => (
						<span class="ex-pcard__metaitem" key={fact}>
							{i > 0 && (
								<>
									{" "}
									<span class="ex-pcard__dot" aria-hidden="true">·</span>
									{" "}
								</>
							)}
							{fact}
						</span>
					))}
				</p>

				<div class="ex-pcard__foot">
					{profile.rating
						? (
							<RatingStars
								value={profile.rating.value}
								count={profile.rating.count}
								size="sm"
								compact
								label={`Rated ${
									profile.rating.value.toFixed(1)
								} out of 5 from ${profile.rating.count} reviews`}
							/>
						)
						: <span class="ex-muted">{profile.delivered} delivered</span>}
					<ul class="ex-pcard__metrics" role="list">
						{profile.rating && (
							<li class="ex-pcard__metric">
								<span class="ex-pcard__metric-value">{profile.delivered}</span>{" "}
								<span class="ex-pcard__metric-label">delivered</span>
							</li>
						)}
						{profile.rate && (
							<li class="ex-pcard__metric">
								<span class="ex-pcard__metric-value">{profile.rate}</span>
							</li>
						)}
					</ul>
				</div>
			</div>
		</article>
	);
}
