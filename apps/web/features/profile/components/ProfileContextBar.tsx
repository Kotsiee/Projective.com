import type { JSX } from "preact";
import { filterHref } from "@features/explore/core/routing.ts";
import ProfileStory from "../islands/ProfileStory.island.tsx";
import ProfileAvailability from "../islands/ProfileAvailability.island.tsx";
import type { LanguageLevel, ProfileView } from "../types/profile-types.ts";
import { settingsOf } from "@projective/types/profile";

/**
 * ProfileContextBar — the editorial preamble between the hero and the tab sections: the entity's
 * own headline and story on the reading side; on the other, the facts a visitor weighs before
 * reading further — where they are based, the live availability block (published hours only), then
 * the Skills and Languages facets. (Reply speed, the spend floor and the consultation offer live in
 * the hero's metrics strip.) The profile is edited at `/[handle]/edit`, never in place here.
 *
 * A SERVER component (no signals, no state): the clock-driven availability block is its own island
 * mounted here. Everything else is prose, facts and links.
 *
 * The owner's presentation switches are honoured here and nowhere else in the bar: `showLocation`
 * withholds the "Based in" line and `showLocalTime` the live local clock (the working hours stay —
 * they are what a visitor books against).
 *
 * Both columns are optional. A facet with no entries is omitted, a facets column with nothing left is
 * omitted, and a story column with no headline and no story is omitted — the surviving column then
 * spans the row (`pf-context--solo`) rather than sitting beside an empty track. With nothing to show
 * at all the bar renders nothing, so the page never carries an empty region with a name on it.
 */
export interface ProfileContextBarProps {
	profile: ProfileView;
}

const LEVEL_LABEL: Record<LanguageLevel, string> = {
	native: "Native",
	fluent: "Fluent",
	professional: "Professional",
	conversational: "Conversational",
	basic: "Basic",
};

export function ProfileContextBar(
	{ profile }: ProfileContextBarProps,
): JSX.Element | null {
	const settings = settingsOf(profile);
	const headline = profile.headline.trim();
	const hasStory = headline.length > 0 || profile.story.trim().length > 0;
	const skills = profile.skills;
	const languages = profile.languages;
	const hours = profile.hours && profile.hours.rules.length > 0 ? profile.hours : null;
	const place = settings.showLocation
		? [profile.location.city, profile.location.country].map((p) => p.trim()).filter(Boolean).join(", ")
		: "";
	const hasFacets = skills.length > 0 || languages.length > 0 || hours !== null || place.length > 0;

	if (!hasStory && !hasFacets) return null;

	const solo = !(hasStory && hasFacets);
	const calendarHref = profile.hasAvailability ? `/${profile.handle}/availability` : null;

	return (
		<section class={`pf-context${solo ? " pf-context--solo" : ""}`} aria-label="About">
			{hasStory && (
				<div class="pf-context__story">
					<div class="pf-context__body">
						<ProfileStory headline={headline} story={profile.story} canEdit={false} />
					</div>
				</div>
			)}
			{hasFacets && (
				<div class="pf-context__facets">
					{place && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Based in</h2>
							<p class="pf-context__place">{place}</p>
						</div>
					)}
					{hours && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Availability</h2>
							<ProfileAvailability
								hours={hours}
								calendarHref={calendarHref}
								showClock={settings.showLocalTime}
							/>
						</div>
					)}
					{skills.length > 0 && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Skills</h2>
							<ul class="pf-tags" role="list">
								{skills.map((skill, i) => (
									<li class="pf-tags__item" key={`${i}:${skill.label}`}>
										<a class="pf-tag" href={filterHref({ q: skill.label })}>
											{skill.label}
										</a>
									</li>
								))}
							</ul>
						</div>
					)}
					{languages.length > 0 && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Languages</h2>
							<ul class="pf-tags" role="list">
								{languages.map((lang, i) => (
									<li class="pf-tags__item" key={`${i}:${lang.code}`}>
										<span class="pf-tag">
											{lang.label}
											<span class="pf-tag__level">
												<span aria-hidden="true">·</span>
												{LEVEL_LABEL[lang.level]}
											</span>
										</span>
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
