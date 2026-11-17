import type { JSX } from "preact";
import { filterHref } from "@features/explore/core/routing.ts";
import ProfileStory from "../islands/ProfileStory.island.tsx";
import ProfileAvailability from "../islands/ProfileAvailability.island.tsx";
import { settingsOf } from "@projective/types/profile";
import type { LanguageLevel, ProfileHours, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileContextParts — the context bar's blocks as plain views, shared by the visitor's server
 * component ({@link ProfileContextBar}) and the owner's island (`OwnerContextBar`), so the page an
 * owner edits and the page a visitor reads cannot drift. Hook-free, so either side may render them.
 */

const LEVEL_LABEL: Record<LanguageLevel, string> = {
	native: "Native",
	fluent: "Fluent",
	professional: "Professional",
	conversational: "Conversational",
	basic: "Basic",
};

/** What the bar shows, read once from the profile and the owner's own display switches. */
export interface ContextFacts {
	headline: string;
	story: string;
	hasStory: boolean;
	/** "City, Country" as stored, whether or not it is shown. */
	located: string;
	/** What a visitor reads — empty when the owner hides it (`showLocation`). */
	place: string;
	hours: ProfileHours | null;
	calendarHref: string | null;
	showClock: boolean;
	skills: ProfileView["skills"];
	languages: ProfileView["languages"];
}

/** The bar's facts for `profile`. */
export function contextFactsOf(profile: ProfileView): ContextFacts {
	const settings = settingsOf(profile);
	const headline = profile.headline.trim();
	const located = [profile.location.city, profile.location.country]
		.map((p) => p.trim())
		.filter(Boolean)
		.join(", ");
	return {
		headline,
		story: profile.story,
		hasStory: headline.length > 0 || profile.story.trim().length > 0,
		located,
		place: settings.showLocation ? located : "",
		hours: profile.hours && profile.hours.rules.length > 0 ? profile.hours : null,
		calendarHref: profile.hasAvailability ? `/${profile.handle}/availability` : null,
		showClock: settings.showLocalTime,
		skills: profile.skills,
		languages: profile.languages,
	};
}

/** The headline over the story. */
export function StoryView({ facts }: { facts: ContextFacts }): JSX.Element {
	return (
		<div class="pf-context__body">
			<ProfileStory headline={facts.headline} story={facts.story} canEdit={false} />
		</div>
	);
}

/** "Based in" — one fact line in the meta register. */
export function PlaceView({ place }: { place: string }): JSX.Element {
	return <p class="pf-context__place">{place}</p>;
}

/** The live availability block. */
export function HoursView(
	{ facts, hours }: { facts: ContextFacts; hours: ProfileHours },
): JSX.Element {
	return (
		<ProfileAvailability
			hours={hours}
			calendarHref={facts.calendarHref}
			showClock={facts.showClock}
		/>
	);
}

/** The skills, each a search link. */
export function SkillsView({ skills }: { skills: ContextFacts["skills"] }): JSX.Element {
	return (
		<ul class="pf-tags" role="list">
			{skills.map((skill, i) => (
				<li class="pf-tags__item" key={`${i}:${skill.label}`}>
					<a class="pf-tag" href={filterHref({ q: skill.label })}>{skill.label}</a>
				</li>
			))}
		</ul>
	);
}

/** The languages, each with its level in the meta ink. */
export function LanguagesView(
	{ languages }: { languages: ContextFacts["languages"] },
): JSX.Element {
	return (
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
	);
}
