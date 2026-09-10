import type { JSX } from "preact";
import { TAB_LABEL, tabHref, tabsFor } from "../core/profile-model.ts";
import type { ProfileTab, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileTabs — the four-section tab bar (root CLAUDE.md §8 Decision #96): Work · Experience ·
 * Reviews · Posts, each a real anchor into its `/[handle]/<section>` sub-route (URL-driven active
 * state, so deep-links and refresh land right). Underlined text tabs on one shared hairline (§B.4 /
 * §D.4): the active tab carries a 2px `--on-surface` underline — monochrome, never the brand teal.
 *
 * A SERVER component. The previous island measured the strip to fold a ten-tab matrix into a `More ▾`
 * menu; four short words fit every width the surface can be given, so there is nothing to measure
 * and no reason to ship a hydration root for a row of links.
 */
export interface ProfileTabsProps {
	profile: ProfileView;
	active: ProfileTab | null;
}

export function ProfileTabs({ profile, active }: ProfileTabsProps): JSX.Element {
	const tabs = tabsFor(profile.kind);
	return (
		<nav class="pf-tabs" aria-label="Profile sections">
			<ul class="pf-tabs__list" role="list">
				{tabs.map((tab) => {
					const isActive = active === tab;
					return (
						<li class="pf-tabs__item" key={tab}>
							<a
								class="pf-tab"
								href={tabHref(profile.handle, tab)}
								data-active={isActive ? "true" : undefined}
								aria-current={isActive ? "page" : undefined}
							>
								{TAB_LABEL[tab]}
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
