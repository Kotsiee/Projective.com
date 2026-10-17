import type { ComponentChildren, JSX } from "preact";
import { createAnchorRegistry, RESERVED_ANCHOR_IDS } from "@projective/types/content";
import { CHANGELOG_CATEGORY_LABEL, type ChangelogRelease } from "@projective/types/editorial";
import {
	ContentRenderer,
	DocumentDate,
	DocumentHeader,
	DocumentLayout,
	EditorialGlyphContext,
	type EditorialGlyphs,
	Prose,
} from "@projective/ui/display/editorial";
import type { ChangelogReleaseView as ReleaseData } from "@server/services/editorial/ChangelogBackendService.ts";
import { CHANGELOG_PATH, releaseAnchorId, releasePath } from "../core/changelog-url.ts";
import { ReleaseGallery } from "./ReleaseGallery.tsx";

/** Props for {@link ChangelogReleaseView}. */
export interface ChangelogReleaseViewProps {
	data: ReleaseData;
	/** The lightbox island (the route's; omitted in tests). Rendered after the document. */
	lightbox?: ComponentChildren;
	/** The anchor glyph the headings draw (`EDITORIAL_ICONS` in the route; none in tests). */
	glyphs?: EditorialGlyphs;
}

/** A neighbouring release as a link: which way it lies, then its version and title. */
function Sibling(
	{ release, direction }: { release: ChangelogRelease; direction: "older" | "newer" },
): JSX.Element {
	return (
		<li class={`chl-siblings__item chl-siblings__item--${direction}`}>
			<a
				class="chl-siblings__link"
				href={releasePath(release.version)}
				rel={direction === "older" ? "prev" : "next"}
			>
				<span class="chl-siblings__dir">
					{direction === "older" ? "Previous release" : "Next release"}
				</span>
				<span class="chl-siblings__title">
					<span class="chl-mono">v{release.version}</span> {release.title}
				</span>
			</a>
		</li>
	);
}

/**
 * ChangelogReleaseView — `/changelog/[version]`, a release's canonical page: a breadcrumb back to the
 * feed, the release as a document (its title the page's `<h1>`, the summary as the lead, then
 * "Released <time>" · the version · its categories as one meta line), the body and its pictures, and
 * a footer naming the previous and next releases beside "All releases".
 *
 * Injectable islands, so a render test mounts it with none; the route passes the real ones.
 */
export function ChangelogReleaseView(
	{ data, lightbox, glyphs = {} }: ChangelogReleaseViewProps,
): JSX.Element {
	const { release, newer, older, latest } = data;
	const anchor = releaseAnchorId(release.version);
	const registry = createAnchorRegistry([...RESERVED_ANCHOR_IDS, anchor]);
	const meta = [
		<DocumentDate key="released" prefix="Released" iso={release.releasedOn} />,
		<span key="version" class="chl-mono">Version {release.version}</span>,
		...release.categories.map((category) => CHANGELOG_CATEGORY_LABEL[category]),
		latest ? "Latest release" : null,
	];
	return (
		<EditorialGlyphContext.Provider value={glyphs}>
			<DocumentLayout
				class="chl-release"
				header={
					<>
						<nav class="chl-crumbs" aria-label="Breadcrumb">
							<ol class="chl-crumbs__list" role="list">
								<li class="chl-crumbs__item">
									<a href={CHANGELOG_PATH}>Changelog</a>
								</li>
								<li class="chl-crumbs__item" aria-current="page">
									<span class="chl-mono">v{release.version}</span>
								</li>
							</ol>
						</nav>
						<DocumentHeader title={release.title} summary={release.summary} meta={meta} />
					</>
				}
				footer={
					<nav class="chl-siblings" aria-label="Other releases" data-print="hide">
						{older || newer
							? (
								<ul class="chl-siblings__list" role="list">
									{older ? <Sibling release={older} direction="older" /> : null}
									{newer ? <Sibling release={newer} direction="newer" /> : null}
								</ul>
							)
							: null}
						<a
							class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md chl-siblings__all"
							href={CHANGELOG_PATH}
						>
							<span class="ui-button__label">All releases</span>
						</a>
					</nav>
				}
			>
				<Prose class="chl-release__body">
					<ContentRenderer nodes={release.body} registry={registry} />
				</Prose>
				<ReleaseGallery
					entry={anchor}
					version={release.version}
					images={release.images}
					eager
				/>
			</DocumentLayout>
			{lightbox}
		</EditorialGlyphContext.Provider>
	);
}
