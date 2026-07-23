import { cloneElement, type JSX } from "preact";
import "../styles/project-showcase.css";
import { EditIcon, EyeIcon } from "../components/glyphs.tsx";

/**
 * ProjectPreviewTabs — the CLIENT/owner's mode switch, mounted in the middle-nav frame's header band
 * (`ui-middle-nav__header`) for `/projects/[projectId]` and `/projects/[projectId]/edit`. It offers the
 * two states of the same engagement (root brief §Part 1.1):
 *   • **Preview** (`/projects/[id]`) — the project exactly as freelancers see it, in the shared
 *     `/view/[id]?type=projects` presentation.
 *   • **Edit** (`/projects/[id]/edit`) — the inline/full project editor.
 *
 * A persistent contextual strip (not scroll-gated, unlike the freelancer's migrated sticky header): the
 * client always needs the switch reachable. Tabs are REAL anchors so the active underline is URL-driven
 * (`data-active`) and survives refresh/deep-links (§B.4 underlined tabs, no pills). It is an island so it
 * is the bundling site for `project-showcase.css` (feature CSS is collected only through island imports)
 * and hydrates cleanly from fully-serializable props. Only the client sees it — the freelancer/guest
 * band is the reused `ProjectStickyHeader` (Apply), gated server-side by `viewerIsClient`.
 */
export interface ProjectPreviewTabsProps {
	/** The engagement slug — the two tab hrefs hang off `/projects/[slug]`. */
	slug: string;
	/** Which mode is active (drives the underline). */
	active: "preview" | "edit";
	/** The engagement title, shown as the strip's left identity. */
	title: string;
}

export default function ProjectPreviewTabs(
	{ slug, active, title }: ProjectPreviewTabsProps,
): JSX.Element {
	const base = `/projects/${slug}`;
	const tabs = [
		{ key: "preview", label: "Preview", href: base, icon: EyeIcon },
		{ key: "edit", label: "Edit", href: `${base}/edit`, icon: EditIcon },
	] as const;

	return (
		<header class="proj-pvhead">
			<div class="proj-pvhead__id">
				<span class="proj-pvhead__eyebrow">Managing</span>
				<span class="proj-pvhead__title">{title}</span>
			</div>
			<nav class="proj-pvhead__tabs" aria-label="Project view mode">
				{tabs.map((t) => {
					const on = t.key === active;
					return (
						<a
							key={t.key}
							class="proj-pvtab"
							href={t.href}
							data-active={on ? "true" : undefined}
							aria-current={on ? "page" : undefined}
						>
							<span class="proj-pvtab__icon" aria-hidden="true">{cloneElement(t.icon)}</span>
							<span class="proj-pvtab__label">{t.label}</span>
						</a>
					);
				})}
			</nav>
		</header>
	);
}
