import type { JSX } from "preact";
import { filterHref } from "@features/explore/core/routing.ts";
import ProfileStory from "../islands/ProfileStory.island.tsx";
import ProfileAvailability from "../islands/ProfileAvailability.island.tsx";
import type { LanguageLevel, ProfileView } from "../types/profile-types.ts";
import { settingsOf } from "@projective/types/profile";
import { availabilityHrefFor, editHrefFor, type OwnerEdit } from "../core/owner-edit.ts";
import { OwnedHeading, OwnerEditLink, OwnerStub } from "./OwnerEditLink.tsx";

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
 *
 * For the owner (`ownerEdit`, Decision #408) every block carries an {@link OwnerEditLink} to the part
 * of the editor that changes it, and a block a visitor would not see — empty, or hidden by the owner —
 * stands as an {@link OwnerStub} in its place.
 */
export interface ProfileContextBarProps {
	profile: ProfileView;
	/** The owner's edit links (`core/owner-edit.ts`); `null` for a visitor, who gets none of them. */
	ownerEdit?: OwnerEdit | null;
}

const LEVEL_LABEL: Record<LanguageLevel, string> = {
	native: "Native",
	fluent: "Fluent",
	professional: "Professional",
	conversational: "Conversational",
	basic: "Basic",
};

export function ProfileContextBar(
	{ profile, ownerEdit = null }: ProfileContextBarProps,
): JSX.Element | null {
	const settings = settingsOf(profile);
	const headline = profile.headline.trim();
	const hasStory = headline.length > 0 || profile.story.trim().length > 0;
	const skills = profile.skills;
	const languages = profile.languages;
	const hours = profile.hours && profile.hours.rules.length > 0 ? profile.hours : null;
	const located = [profile.location.city, profile.location.country].map((p) => p.trim()).filter(
		Boolean,
	)
		.join(", ");
	const place = settings.showLocation ? located : "";

	const aboutHref = editHrefFor(ownerEdit, "about");
	const locationHref = editHrefFor(ownerEdit, "location");
	const placeHref = located && !settings.showLocation
		? editHrefFor(ownerEdit, "privacy")
		: locationHref;
	const hoursHref = availabilityHrefFor(ownerEdit);
	const skillsHref = editHrefFor(ownerEdit, "skills");
	const languagesHref = editHrefFor(ownerEdit, "languages");

	const storyShown = hasStory || aboutHref !== null;
	const facetsShown = skills.length > 0 || languages.length > 0 || hours !== null ||
		place.length > 0 ||
		!!(placeHref || hoursHref || skillsHref || languagesHref);

	if (!storyShown && !facetsShown) return null;

	const solo = !(storyShown && facetsShown);
	const calendarHref = profile.hasAvailability ? `/${profile.handle}/availability` : null;
	const owned = (href: string | null) =>
		href ? "pf-context__facet pf-ownerblock" : "pf-context__facet";

	return (
		<section class={`pf-context${solo ? " pf-context--solo" : ""}`} aria-label="About">
			{hasStory && (
				<div
					class={aboutHref
						? "pf-context__story pf-context__story--owned pf-ownerblock"
						: "pf-context__story"}
				>
					<div class="pf-context__body">
						<ProfileStory headline={headline} story={profile.story} canEdit={false} />
					</div>
					{aboutHref && <OwnerEditLink href={aboutHref} label="your story" />}
				</div>
			)}
			{!hasStory && aboutHref && (
				<OwnerStub
					class="pf-context__story"
					title="About"
					note="Visitors see your headline and story once you write them."
					href={aboutHref}
					label="your story"
				/>
			)}
			{facetsShown && (
				<div class="pf-context__facets">
					{place
						? (
							<div class={owned(placeHref)}>
								<OwnedHeading title="Based in" href={placeHref} label="where you're based" />
								<p class="pf-context__place">{place}</p>
							</div>
						)
						: placeHref && (
							<OwnerStub
								class="pf-context__facet"
								title="Based in"
								note={located
									? "Hidden from visitors by your privacy settings."
									: "Visitors see where you're based once you add it."}
								href={placeHref}
								label={located ? "your privacy settings" : "where you're based"}
							/>
						)}
					{hours
						? (
							<div class={owned(hoursHref)}>
								<OwnedHeading title="Availability" href={hoursHref} label="your availability" />
								<ProfileAvailability
									hours={hours}
									calendarHref={calendarHref}
									showClock={settings.showLocalTime}
								/>
							</div>
						)
						: hoursHref && (
							<OwnerStub
								class="pf-context__facet"
								title="Availability"
								note="Visitors see your hours once you publish them."
								href={hoursHref}
								label="your availability"
							/>
						)}
					{skills.length > 0
						? (
							<div class={owned(skillsHref)}>
								<OwnedHeading title="Skills" href={skillsHref} label="your skills" />
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
						)
						: skillsHref && (
							<OwnerStub
								class="pf-context__facet"
								title="Skills"
								note="Visitors see your skills once you add them."
								href={skillsHref}
								label="your skills"
							/>
						)}
					{languages.length > 0
						? (
							<div class={owned(languagesHref)}>
								<OwnedHeading title="Languages" href={languagesHref} label="your languages" />
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
						)
						: languagesHref && (
							<OwnerStub
								class="pf-context__facet"
								title="Languages"
								note="Visitors see the languages you work in once you add them."
								href={languagesHref}
								label="your languages"
							/>
						)}
				</div>
			)}
		</section>
	);
}
