import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import type { ProfileEditModel } from "@projective/types/profile";
import "../styles/profile.css";
import {
	contextFactsOf,
	HoursView,
	LanguagesView,
	PlaceView,
	SkillsView,
	StoryView,
} from "../components/ProfileContextParts.tsx";
import { InlineEditBlock } from "../components/edit/OwnerBlock.tsx";
import {
	AboutEditor,
	AvailabilityEditor,
	LanguagesBlockEditor,
	LocationEditor,
	SkillsEditor,
} from "../components/edit/ContextEditors.tsx";
import { canEditBlock, type OwnerEdit } from "../core/owner-edit.ts";
import { liveProfile } from "../core/owner-store.ts";
import { useOwnerAnchor } from "../hooks/useOwnerAnchor.ts";
import { useOwnerModel } from "../hooks/useOwnerModel.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * OwnerContextBar — the context bar as its OWNER sees it on `/[handle]` (Decision #439): the visitor's
 * layout, drawn from the same {@link ProfileContextParts}, with each block editable in place — the
 * headline and story, where they are based, whether their hours show, their skills and languages. A
 * block a visitor would not see stands as a one-line stub where it would appear, so the way to fill
 * it is where it will be read. Mounted for the owner only; a visitor gets the server component.
 */
export interface OwnerContextBarProps {
	profile: ProfileView;
	model: ProfileEditModel;
	edit: OwnerEdit;
	/** The weekday the owner's week starts on, 0 = Sunday (their locale). */
	weekStartsOn: number;
}

export default function OwnerContextBar(props: OwnerContextBarProps): JSX.Element {
	const model = useOwnerModel(props.model);
	const profile = liveProfile(props.profile);
	const facts = contextFactsOf(profile);
	const handle = props.edit.handle;
	const can = {
		about: canEditBlock(props.edit, "about"),
		location: canEditBlock(props.edit, "location"),
		availability: canEditBlock(props.edit, "availability"),
		skills: canEditBlock(props.edit, "skills"),
		languages: canEditBlock(props.edit, "languages"),
	};
	const editing = {
		about: useSignal(false),
		location: useSignal(false),
		availability: useSignal(false),
		skills: useSignal(false),
		languages: useSignal(false),
	};
	useOwnerAnchor("about", () => (editing.about.value = true), can.about);
	useOwnerAnchor("location", () => (editing.location.value = true), can.location);
	useOwnerAnchor("availability", () => (editing.availability.value = true), can.availability);
	useOwnerAnchor("skills", () => (editing.skills.value = true), can.skills);
	useOwnerAnchor("languages", () => (editing.languages.value = true), can.languages);

	const facetsShown = can.location || can.availability || can.skills || can.languages;
	const solo = !(can.about && facetsShown);
	const base = { handle, profile };

	const place = facts.place ? <PlaceView place={facts.place} /> : facts.located
		? (
			<>
				<PlaceView place={facts.located} />
				<p class="pf-ownerstub__note">Hidden from visitors by your display settings.</p>
			</>
		)
		: null;

	return (
		<section class={`pf-context${solo ? " pf-context--solo" : ""}`} aria-label="About">
			{can.about && (
				<InlineEditBlock
					anchor="about"
					class="pf-context__story"
					title={facts.hasStory ? undefined : "About"}
					label="your headline and story"
					editing={editing.about}
					view={facts.hasStory ? <StoryView facts={facts} /> : null}
					stub="Visitors see your headline and story once you write them."
					editor={() => (
						<AboutEditor {...base} model={model} close={() => (editing.about.value = false)} />
					)}
				/>
			)}
			{facetsShown && (
				<div class="pf-context__facets">
					{can.location && (
						<InlineEditBlock
							anchor="location"
							class="pf-context__facet"
							title="Based in"
							label="where you're based"
							editing={editing.location}
							view={place}
							stub="Visitors see where you're based once you add it."
							editor={() => (
								<LocationEditor
									{...base}
									model={model}
									close={() => (editing.location.value = false)}
								/>
							)}
						/>
					)}
					{can.availability && (
						<InlineEditBlock
							anchor="availability"
							class="pf-context__facet"
							title="Availability"
							label="your availability"
							editing={editing.availability}
							view={facts.hours ? <HoursView facts={facts} hours={facts.hours} /> : null}
							stub="Visitors see your hours once you publish them."
							editor={() => (
								<AvailabilityEditor
									{...base}
									weekStartsOn={props.weekStartsOn}
									close={() => (editing.availability.value = false)}
								/>
							)}
						/>
					)}
					{can.skills && (
						<InlineEditBlock
							anchor="skills"
							class="pf-context__facet"
							title="Skills"
							label="your skills"
							editing={editing.skills}
							view={facts.skills.length ? <SkillsView skills={facts.skills} /> : null}
							stub="Visitors see your skills once you add them."
							editor={() => <SkillsEditor {...base} close={() => (editing.skills.value = false)} />}
						/>
					)}
					{can.languages && (
						<InlineEditBlock
							anchor="languages"
							class="pf-context__facet"
							title="Languages"
							label="your languages"
							editing={editing.languages}
							view={facts.languages.length ? <LanguagesView languages={facts.languages} /> : null}
							stub="Visitors see the languages you work in once you add them."
							editor={() => (
								<LanguagesBlockEditor
									{...base}
									model={model}
									close={() => (editing.languages.value = false)}
								/>
							)}
						/>
					)}
				</div>
			)}
		</section>
	);
}
