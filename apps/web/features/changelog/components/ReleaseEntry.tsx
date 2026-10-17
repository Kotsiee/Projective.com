import type { JSX } from "preact";
import { type AnchorRegistry, formatContentDate } from "@projective/types/content";
import { CHANGELOG_CATEGORY_LABEL, type ChangelogRelease } from "@projective/types/editorial";
import { AnchorHeading, ContentRenderer, Prose } from "@projective/ui/display/editorial";
import { releaseAnchorId, releasePath } from "../core/changelog-url.ts";
import { ReleaseGallery } from "./ReleaseGallery.tsx";

/** Props for {@link ReleaseEntry}. */
export interface ReleaseEntryProps {
	release: ChangelogRelease;
	/** The newest release of all — its spine dot is the brand colour and it says "Latest". */
	latest: boolean;
	/**
	 * The page's anchor registry: every body on the feed claims its sub-heading ids from ONE registry
	 * (pre-seeded with the layout's ids and every release anchor), so no id repeats on the page.
	 */
	registry: AnchorRegistry;
	/** The first entry on the page: its first picture loads eagerly. */
	first?: boolean;
}

/**
 * ReleaseEntry — one release on the changelog timeline: a `<li>` holding an `<article>` named by its
 * title.
 *
 * The gutter (`chl-entry__aside`) carries the release day as `<time datetime>` and the version as a
 * small link to the release's own page, both in the mono face; from 768px of frame it sits beside
 * the entry and stays in view (sticky) while the entry scrolls, its dot riding the timeline's
 * hairline spine. The content column holds the title — an {@link AnchorHeading} `h2` whose text is
 * a link to its own `#v0-12-0` anchor — the categories as inline middot meta text (never chips: the
 * filters above are the controls), the summary, the body through {@link ContentRenderer}, and the
 * picture grid.
 *
 * Server-rendered and stylesheet-free.
 */
export function ReleaseEntry(
	{ release, latest, registry, first = false }: ReleaseEntryProps,
): JSX.Element {
	const anchor = releaseAnchorId(release.version);
	return (
		<li class="chl-timeline__item">
			<article class="chl-entry" aria-labelledby={anchor} data-latest={latest ? "true" : undefined}>
				<div class="chl-entry__aside">
					<span class="chl-entry__dot" aria-hidden="true" />
					<p class="chl-entry__facts">
						<time class="chl-entry__date" dateTime={release.releasedOn}>
							{formatContentDate(release.releasedOn)}
						</time>
						<a class="chl-entry__version" href={releasePath(release.version)}>
							v{release.version}
							<span class="ui-visually-hidden">, release page</span>
						</a>
						{latest ? <span class="chl-entry__latest">Latest</span> : null}
					</p>
				</div>
				<div class="chl-entry__main">
					<AnchorHeading level={2} id={anchor} class="chl-entry__title">
						{release.title}
					</AnchorHeading>
					<ul class="chl-entry__categories" role="list" aria-label="Categories">
						{release.categories.map((category, i) => (
							<li key={category} class="chl-entry__category">
								{i > 0 ? <span class="chl-entry__sep" aria-hidden="true">·</span> : null}
								{CHANGELOG_CATEGORY_LABEL[category]}
							</li>
						))}
					</ul>
					<p class="chl-entry__summary">{release.summary}</p>
					<Prose class="chl-entry__body">
						<ContentRenderer nodes={release.body} registry={registry} />
					</Prose>
					<ReleaseGallery
						entry={anchor}
						version={release.version}
						images={release.images}
						eager={first}
					/>
				</div>
			</article>
		</li>
	);
}
