import type { JSX } from "preact";
import { Avatar, Tag } from "@projective/ui/display";
import "../styles/profile.css";
import { CategoryGlyph } from "@features/explore/core/skill-map.tsx";
import { filterHref, profileHref } from "@features/explore/core/routing.ts";
import ProfileStory from "../islands/ProfileStory.island.tsx";
import { ProfileIcon } from "./profile-glyphs.tsx";
import type { LanguageLevel, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileAbout — the PERMANENT Overview at the top of the profile body (root CLAUDE.md — Part 1/2): the
 * story (inline-editable by the owner), skill **tag chips** (`@projective/ui` {@link Tag}, not plain
 * words — Part 2.1), languages as split `Language | Proficiency` pills (Part 2.2), and the
 * notable-clients **mini-cards** with a prominent company logo (Part 2.3). Section groups are set off by
 * type weight + spacing, not boxes (§B.4). It sits above the tab bar and stays on every tab.
 */

const LEVEL_LABEL: Record<LanguageLevel, string> = {
	native: "Native",
	fluent: "Fluent",
	professional: "Professional",
	conversational: "Conversational",
	basic: "Basic",
};

export function ProfileAbout(
	{ profile, canEdit }: { profile: ProfileView; canEdit: boolean },
): JSX.Element {
	return (
		<div class="pf-about">
			<section class="pf-about__block" aria-label="About">
				<h2 class="pf-about__heading">About</h2>
				<div class="pf-story">
					<ProfileStory story={profile.story} canEdit={canEdit} />
				</div>
			</section>

			{profile.skills.length > 0 && (
				<section class="pf-about__block" aria-label="Skills">
					<h2 class="pf-about__heading">Skills</h2>
					<div class="pf-skills">
						{profile.skills.map((skill) => (
							<a
								key={skill.label}
								class="pf-skill"
								href={filterHref({ q: skill.label })}
								aria-label={`Filter Explore by ${skill.label}`}
							>
								<Tag
									variant="subtle"
									rounded
									icon={<CategoryGlyph category={skill.category} />}
									value={skill.label}
								/>
							</a>
						))}
					</div>
				</section>
			)}

			{profile.languages.length > 0 && (
				<section class="pf-about__block" aria-label="Languages">
					<h2 class="pf-about__heading">Languages</h2>
					<ul class="pf-langs" role="list">
						{profile.languages.map((lang) => (
							<li class="pf-langpill" key={lang.code}>
								<span class="pf-langpill__lang">{lang.label}</span>
								<span class="pf-langpill__level">{LEVEL_LABEL[lang.level]}</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{profile.notableClients.length > 0 && (
				<section class="pf-about__block" aria-label="Notable clients">
					<h2 class="pf-about__heading">Worked with</h2>
					<ul class="pf-clients" role="list">
						{profile.notableClients.map((client) => {
							const inner = (
								<>
									<Avatar
										image={client.logo}
										label={client.name}
										size={56}
										shape="square"
										class="pf-clientcard__logo"
									/>
									<span class="pf-clientcard__name">
										{client.name}
										{client.verified
											? <ProfileIcon name="verified" class="pf-clientcard__check" />
											: null}
									</span>
								</>
							);
							return (
								<li class="pf-clientcard" key={client.name}>
									{client.handle
										? (
											<a class="pf-clientcard__link" href={profileHref(client.handle)}>
												{inner}
											</a>
										)
										: <span class="pf-clientcard__link pf-clientcard__link--static">{inner}</span>}
								</li>
							);
						})}
					</ul>
				</section>
			)}
		</div>
	);
}
