import type { JSX } from "preact";
import "../styles/profile.css";
import { TAB_LABEL, tabHref, tabsFor } from "../core/profile-model.ts";
import { tabIcon } from "./profile-glyphs.tsx";
import type { ProfileTab, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileTabs — the entity-driven tab bar (root CLAUDE.md Part 2). The tab set is conditional on
 * {@link ProfileView.kind} via {@link tabsFor}; each tab is a real anchor into its `/[handle]/<tab>`
 * sub-route (URL-driven active state, so deep-links + refresh land right). Underlined-text tabs, NOT
 * boxed pills (§B.4 / §D.4): a 2px `--primary` underline marks the active tab on the shared hairline.
 * Horizontally scrollable on overflow; labels collapse to the leading glyph on mobile.
 */
export function ProfileTabs(
	{ profile, active }: { profile: ProfileView; active: ProfileTab | null },
): JSX.Element {
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
								<span class="pf-tab__icon" aria-hidden="true">{tabIcon(tab)}</span>
								<span class="pf-tab__label">{TAB_LABEL[tab]}</span>
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
