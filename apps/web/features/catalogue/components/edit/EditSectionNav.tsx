import type { JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import "../../styles/section-nav.css";
import { type EditSection, workspaceHref } from "../../types/catalogue-types.ts";
import { SECTION_LABELS } from "../../core/workspace-model.ts";
import { setWorkspaceUrl } from "../../core/workspace-store.ts";
import { revealSection, sectionDomId } from "./EditSectionFrame.tsx";

/** Props for {@link EditSectionNav}. */
export interface EditSectionNavProps {
	/** The listing's slug, for each row's `?section=` address. */
	slug: string;
	/** The team whose catalogue the listing is in, when it is (Decision #312). */
	team?: string;
	/** The Edit sections in page order. */
	sections: readonly EditSection[];
	/** The section being read. */
	active: EditSection | null;
}

const SECTION_ICONS: Readonly<Record<EditSection, IconName>> = {
	media: "image",
	basics: "info",
	offer: "service",
	pricing: "tag",
	availability: "calendar",
	questions: "help",
	seo: "globe",
};

function jumpToSection(section: EditSection): boolean {
	if (!document.getElementById(sectionDomId(section))) return false;
	revealSection(section);
	setWorkspaceUrl({ section }, "replace");
	return true;
}

/**
 * EditSectionNav — the Edit tab's sticky section rail on `/catalogue/[id]`, the project setup rail's
 * (`SetupSectionNav`) structure on catalogue sections: one real `?section=` anchor per section, the
 * one being read marked by ink and a leading mark. A plain click reveals the section in place and
 * replaces `?section=`; a modified click, or one before hydration, is left to the browser.
 */
export function EditSectionNav({ slug, team, sections, active }: EditSectionNavProps): JSX.Element {
	return (
		<nav class="cat-secnav" aria-label="Listing sections">
			<ul class="cat-secnav__list" role="list">
				{sections.map((section) => {
					const isActive = active === section;
					return (
						<li class="cat-secnav__item" key={section}>
							<a
								class="cat-secnav__link"
								href={workspaceHref(slug, { team, section })}
								data-active={isActive ? "true" : undefined}
								aria-current={isActive ? "location" : undefined}
								onClick={(event) => {
									if (
										event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
										event.button !== 0
									) {
										return;
									}
									if (jumpToSection(section)) event.preventDefault();
								}}
							>
								<span class="cat-secnav__mark" aria-hidden="true" />
								<Icon class="cat-secnav__icon" name={SECTION_ICONS[section]} size="sm" />
								<span class="cat-secnav__label">{SECTION_LABELS[section]}</span>
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
