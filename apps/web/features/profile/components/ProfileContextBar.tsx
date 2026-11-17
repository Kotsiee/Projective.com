import type { JSX } from "preact";
import type { ProfileView } from "../types/profile-types.ts";
import {
	contextFactsOf,
	HoursView,
	LanguagesView,
	PlaceView,
	SkillsView,
	StoryView,
} from "./ProfileContextParts.tsx";

/**
 * ProfileContextBar — the editorial preamble between the hero and the tab sections, as a VISITOR
 * reads it: the entity's own headline and story on the reading side; on the other, the facts a
 * visitor weighs before reading further — where they are based, the live availability block
 * (published hours only), then the Skills and Languages facets. (Reply speed, the spend floor and the
 * consultation offer live in the hero's metrics strip.)
 *
 * A SERVER component; the owner's copy is the `OwnerContextBar` island, drawn from the same
 * {@link ProfileContextParts} so the page an owner edits is the page a visitor reads (Decision #439).
 *
 * The owner's display switches are honoured here: `showLocation` withholds the "Based in" line and
 * `showLocalTime` the live local clock (the working hours stay — they are what a visitor books
 * against). A facet with no entries is omitted, a facets column with nothing left is omitted, and a
 * story column with nothing written is omitted — the surviving column then spans the row
 * (`pf-context--solo`). With nothing to show at all the bar renders nothing.
 */
export interface ProfileContextBarProps {
	profile: ProfileView;
}

export function ProfileContextBar({ profile }: ProfileContextBarProps): JSX.Element | null {
	const facts = contextFactsOf(profile);
	const { skills, languages, hours, place } = facts;
	const facetsShown = skills.length > 0 || languages.length > 0 || hours !== null ||
		place.length > 0;
	if (!facts.hasStory && !facetsShown) return null;
	const solo = !(facts.hasStory && facetsShown);

	return (
		<section class={`pf-context${solo ? " pf-context--solo" : ""}`} aria-label="About">
			{facts.hasStory && (
				<div class="pf-context__story">
					<StoryView facts={facts} />
				</div>
			)}
			{facetsShown && (
				<div class="pf-context__facets">
					{place && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Based in</h2>
							<PlaceView place={place} />
						</div>
					)}
					{hours && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Availability</h2>
							<HoursView facts={facts} hours={hours} />
						</div>
					)}
					{skills.length > 0 && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Skills</h2>
							<SkillsView skills={skills} />
						</div>
					)}
					{languages.length > 0 && (
						<div class="pf-context__facet">
							<h2 class="pf-h">Languages</h2>
							<LanguagesView languages={languages} />
						</div>
					)}
				</div>
			)}
		</section>
	);
}
