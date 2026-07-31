import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import "../styles/profile.css";
import { ProfileIcon } from "./profile-glyphs.tsx";
import { OnlineStatus } from "./ProfileBadges.tsx";
import LocalTimeClock from "../islands/LocalTimeClock.island.tsx";
import { reviewsHref } from "../core/profile-model.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileMetaSidebar — the profile's context block (root CLAUDE.md — Part 3): the live online status
 * paired with the owner's local time / timezone + availability, then equal-weight rows for location and
 * average response time, then the DUAL-role reviews summary (as Freelancer AND as Client) as a
 * click-through into the Reviews tab (Part 1.2 / 3.2).
 *
 * These are identity facts, so per the region contract they belong to the **lane**, which already owns
 * scope and persists across every tab and the availability calendar — `variant="lane"` renders them as a
 * hairline-separated section of the lane panel (no box of its own: a card inside an already-elevated
 * surface is the §B.9.2 nesting the card policy bans). As a body rail they reserved 18rem + a 2rem
 * gutter on every tab for ~324px of content, which is what starved the work grid.
 *
 * `variant="inline"` is the ≤767px fallback only — below that width neither shell renders a lane, so the
 * body carries these facts once, as a wrapping row under the Overview. Follower/following counts are
 * gone (Part 3.1); Verification moved to the header badge (Part 1.3).
 */
export function ProfileMetaSidebar(
	{ profile, variant = "lane" }: { profile: ProfileView; variant?: "lane" | "inline" },
): JSX.Element {
	const { rating, location } = profile;
	const hasReviews = !!(rating.asHelper || rating.asClient);
	return (
		<aside class={`pf-meta pf-meta--${variant}`} aria-label="Profile details">
			{/* Panel 1 — status + location + response. */}
			<div class="pf-meta__panel">
				<div class="pf-meta__head">
					<OnlineStatus online={profile.online} label={profile.online ? "Online" : "Offline"} />
					<div class="pf-meta__clockblock">
						<LocalTimeClock timezone={location.timezone} />
						{profile.hasAvailability
							? <span class="pf-meta__avail">{profile.availabilityLabel}</span>
							: null}
					</div>
				</div>

				<hr class="pf-hairline" />

				<div class="pf-meta__rows">
					<div class="pf-meta__row">
						<ProfileIcon name="location" class="pf-meta__icon" />
						<span class="pf-meta__rowtext">{location.city}, {location.country}</span>
					</div>
					<div class="pf-meta__row">
						<ProfileIcon name="response" class="pf-meta__icon" />
						<span class="pf-meta__rowtext">{profile.responseTime}</span>
					</div>
				</div>
			</div>

			{/* Panel 2 — the dual-role Reviews summary, a click-through into the Reviews tab. */}
			{hasReviews
				? (
					<a
						class="pf-meta__panel pf-revpanel"
						href={reviewsHref(profile.handle)}
						aria-label="See all reviews"
					>
						<span class="pf-revpanel__head">
							<span class="pf-meta__heading">Reviews</span>
							<ProfileIcon name="chevron" class="pf-revpanel__chevron" />
						</span>
						{rating.asHelper
							? (
								<span class="pf-rep__track">
									<span class="pf-rep__role">As a freelancer</span>
									<RatingStars
										value={rating.asHelper.value}
										count={rating.asHelper.count}
										size="sm"
										label={`Rated ${
											rating.asHelper.value.toFixed(1)
										} out of 5 as a freelancer, ${rating.asHelper.count} reviews`}
									/>
								</span>
							)
							: null}
						{rating.asClient
							? (
								<span class="pf-rep__track">
									<span class="pf-rep__role">As a client</span>
									<RatingStars
										value={rating.asClient.value}
										count={rating.asClient.count}
										size="sm"
										label={`Rated ${
											rating.asClient.value.toFixed(1)
										} out of 5 as a client, ${rating.asClient.count} reviews`}
									/>
								</span>
							)
							: null}
					</a>
				)
				: null}
		</aside>
	);
}
