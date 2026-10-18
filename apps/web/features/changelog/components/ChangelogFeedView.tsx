import { type ComponentChildren, Fragment, type JSX } from "preact";
import {
	createAnchorRegistry,
	formatContentDate,
	RESERVED_ANCHOR_IDS,
} from "@projective/types/content";
import type { ChangelogRelease } from "@projective/types/editorial";
import {
	DocumentHeader,
	DocumentLayout,
	EditorialGlyphContext,
	type EditorialGlyphs,
} from "@projective/ui/display/editorial";
import type { ChangelogFeed } from "@server/services/editorial/ChangelogBackendService.ts";
import { CHANGELOG_RSS_PATH, feedHref, releaseAnchorId } from "../core/changelog-url.ts";
import { CHANGELOG_DESCRIPTION } from "../core/rss.ts";
import { CHANGELOG_TITLE } from "../core/changelog-meta.ts";
import { CategoryFilters } from "./CategoryFilters.tsx";
import { FeedPager } from "./FeedPager.tsx";
import { ReleaseEntry } from "./ReleaseEntry.tsx";

/**
 * The ids this page renders itself; no generated heading anchor may take one (they are reserved in
 * the page's anchor registry beside the layout's own and every release anchor).
 */
export const CHANGELOG_PAGE_IDS = [
	"chl-filters-label",
	"chl-releases",
	"chl-subscribe-label",
] as const;

/** Props for {@link ChangelogFeedView}. */
export interface ChangelogFeedViewProps {
	feed: ChangelogFeed;
	/**
	 * The newsletter capture (`<NewsletterForm topic="changelog" source="changelog" />` in the route;
	 * omitted in tests).
	 */
	newsletter?: ComponentChildren;
	/** The lightbox island (the route's; omitted in tests). Rendered after the document. */
	lightbox?: ComponentChildren;
	/** The anchor glyph the headings draw (`EDITORIAL_ICONS` in the route; none in tests). */
	glyphs?: EditorialGlyphs;
}

/**
 * ChangelogFeedView — `/changelog`: the editorial reading frame (`DocumentLayout`, `ui-doc--feed`)
 * holding the display title and standfirst, the subscribe row (an RSS link and the changelog's
 * newsletter capture), the category filters, then the releases as an `<ol>` timeline of
 * `<article>`s, ten to a page, and the pager.
 *
 * Every release body claims its sub-heading ids from ONE anchor registry, pre-seeded with the
 * layout's reserved ids, this page's own and every release anchor on the page, so two releases'
 * "Under the hood" headings get `under-the-hood` and `under-the-hood-2`.
 *
 * Injectable islands, so a render test mounts it with none; the route passes the real ones.
 */
export function ChangelogFeedView(
	{ feed, newsletter, lightbox, glyphs = {} }: ChangelogFeedViewProps,
): JSX.Element {
	const registry = createAnchorRegistry([
		...RESERVED_ANCHOR_IDS,
		...CHANGELOG_PAGE_IDS,
		...feed.releases.map((release: ChangelogRelease) => releaseAnchorId(release.version)),
	]);
	const filtered = feed.selected.length > 0;
	const meta = [
		`${feed.allCount} ${feed.allCount === 1 ? "release" : "releases"}`,
		feed.latest
			? (
				<Fragment key="latest">
					Latest <span class="chl-mono">v{feed.latest.version}</span>
				</Fragment>
			)
			: null,
		feed.latest
			? (
				<Fragment key="updated">
					Updated{" "}
					<time class="chl-mono" dateTime={feed.latest.releasedOn}>
						{formatContentDate(feed.latest.releasedOn)}
					</time>
				</Fragment>
			)
			: null,
	];
	return (
		<EditorialGlyphContext.Provider value={glyphs}>
			<DocumentLayout
				class="ui-doc--feed"
				header={
					<DocumentHeader title={CHANGELOG_TITLE} summary={CHANGELOG_DESCRIPTION} meta={meta}>
						<div
							class="chl-subscribe"
							role="group"
							aria-labelledby="chl-subscribe-label"
							data-print="hide"
						>
							<p id="chl-subscribe-label" class="chl-subscribe__label">Follow releases</p>
							<div class="chl-subscribe__row">
								<a
									class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md chl-subscribe__rss"
									href={CHANGELOG_RSS_PATH}
									type="application/rss+xml"
								>
									<span class="ui-button__label">RSS feed</span>
								</a>
								{newsletter ? <div class="chl-subscribe__email">{newsletter}</div> : null}
							</div>
							<p class="chl-subscribe__hint">
								The RSS feed updates when a release ships; an email address joins the changelog
								list.
							</p>
						</div>
					</DocumentHeader>
				}
				footer={
					<FeedPager page={feed.page} pageCount={feed.pageCount} categories={feed.selected} />
				}
			>
				<CategoryFilters
					selected={feed.selected}
					counts={feed.categories}
					allCount={feed.allCount}
				/>
				{feed.releases.length > 0
					? (
						<ol id="chl-releases" class="chl-timeline" aria-label="Releases, newest first">
							{feed.releases.map((release) => (
								<ReleaseEntry
									key={release.version}
									release={release}
									latest={release.version === feed.latest?.version}
									registry={registry}
								/>
							))}
						</ol>
					)
					: (
						<p class="chl-empty" role="status">
							{filtered ? "No release matches these categories yet. " : "No releases yet. "}
							{filtered ? <a href={feedHref([])}>Show every release</a> : null}
						</p>
					)}
			</DocumentLayout>
			{lightbox}
		</EditorialGlyphContext.Provider>
	);
}
