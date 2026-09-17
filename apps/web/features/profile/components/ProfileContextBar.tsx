import type { JSX } from "preact";
import { filterHref } from "@features/explore/core/routing.ts";
import ProfileStory from "../islands/ProfileStory.island.tsx";
import ProfileAvailability from "../islands/ProfileAvailability.island.tsx";
import type { LanguageLevel, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileContextBar — the editorial preamble between the hero and the tab sections: the entity's
 * own headline and story — both owner-editable in place — on the reading side; on the other, the
 * facts a visitor weighs before reading further — the live availability block (published hours
 * only), then the Skills and Languages facets. (Reply speed, the spend floor and the consultation
 * offer live in the hero's metrics strip.)
 *
 * A SERVER component (no signals, no state): the two interactive parts — the inline headline ⁄
 * story editor and the clock-driven availability block — are their own islands mounted here.
 * Everything else is prose, facts and links, and a hydration root for a paragraph and two tag lists
 * would ship JavaScript to do nothing.
 *
 * Both columns are optional. A facet with no entries is omitted, a facets column with nothing left is
 * omitted, and a story column with no headline, no story and no owner to write one is omitted — the
 * surviving column then spans the row (`pf-context--solo`) rather than sitting beside an empty track.
 * With nothing to show at all the bar renders nothing, so the page never carries an empty region with
 * a name on it.
 */
export interface ProfileContextBarProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile (unlocks the inline story editor). */
	canEdit: boolean;
}

const LEVEL_LABEL: Record<LanguageLevel, string> = {
	native: "Native",
	fluent: "Fluent",
	professional: "Professional",
	conversational: "Conversational",
	basic: "Basic",
};

export function ProfileContextBar(
	{ profile, canEdit }: ProfileContextBarProps,
): JSX.Element | null {
	const headline = profile.headline.trim();
	const hasStory = headline.length > 0 || profile.story.trim().length > 0 || canEdit;
	const skills = profile.skills;
	const languages = profile.languages;
	const hours = profile.hours && profile.hours.rules.length > 0 ? profile.hours : null;
	const hasFacets = skills.length > 0 || languages.length > 0 || hours !== null;

	if (!hasStory && !hasFacets) return null;

	const solo = !(hasStory && hasFacets);
	const calendarHref = profile.hasAvailability ? `/${profile.handle}/availability` : null;

	return (
		<section class={`pf-context${solo ? " pf-context--solo" : ""}`} aria-label="About">
			{hasStory && (
				<div class="pf-context__story">
					<div class="pf-context__body">
						<ProfileStory headline={headline} story={profile.story} canEdit={canEdit} />
					</div>
				</div>
			)}
			{hasFacets && (
				<div class="pf-context__facets">
					{hours && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Availability</h2>
							<ProfileAvailability hours={hours} calendarHref={calendarHref} />
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
