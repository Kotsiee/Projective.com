import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import "../styles/profile.css";
import { ProfileIcon } from "./profile-glyphs.tsx";
import { OnlineStatus } from "./ProfileBadges.tsx";
import LocalTimeClock from "../islands/LocalTimeClock.island.tsx";
import { reviewsHref } from "../core/profile-model.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileMetaSidebar — the sticky right rail of the profile (root CLAUDE.md — Part 3). Two stacked
 * tonal-tint panels (§B.4):
 *  1. The meta panel — a header pairing the live online status (left) with the local time / timezone +
 *     availability (right), then equal-weight rows for location and average response time.
 *  2. A separate Reviews panel below — the DUAL-role summary (as Freelancer AND as Client), a
 *     click-through to the Reviews tab (Part 1.2 / 3.2).
 *
 * Follower/following counts are gone (Part 3.1); Verification moved to the header badge (Part 1.3). The
 * rail persists across every tab beside the permanent Overview.
 */
export function ProfileMetaSidebar({ profile }: { profile: ProfileView }): JSX.Element {
	const { rating, location } = profile;
	const hasReviews = !!(rating.asHelper || rating.asClient);
	return (
		<aside class="pf-meta" aria-label="Profile details">
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
