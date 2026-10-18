import type {
	ChangelogCategory,
	ChangelogImage,
	ChangelogRelease,
} from "@projective/types/editorial";
import { nodesText, wordCount } from "@projective/types/content/text";
import {
	absoluteUrl,
	breadcrumbListJsonLd,
	collectionPageJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	organizationJsonLd,
	type PageMeta,
	pageMeta,
	type PageMetaImage,
	type PageMetaInput,
	techArticleJsonLd,
	webPageJsonLd,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import { CHANGELOG_DESCRIPTION, CHANGELOG_RSS_TITLE } from "./rss.ts";
import { CHANGELOG_PATH, CHANGELOG_RSS_PATH, feedHref, releasePath } from "./changelog-url.ts";

/**
 * changelog-meta.ts — the changelog's `<head>` facts and structured data (P5, Decision #278), built
 * from what the service returned so a route only applies them.
 *
 *  - The feed's first page is a `CollectionPage` whose `ItemList` is its releases, each pointing at
 *    its canonical release URL. Each later page of the series is its own canonical
 *    (`/changelog?page=2`, titled "Changelog · page 2") with no CollectionPage of its own, so no two
 *    views describe one `@id` differently; a filtered view is a subset of the feed and names
 *    `/changelog` as canonical.
 *  - A release is a `TechArticle` about the `SoftwareApplication` Projective at that
 *    `softwareVersion`, on a `WebPage` with a two-step breadcrumb.
 *  - Both advertise the RSS feed with `<link rel="alternate" type="application/rss+xml">`.
 */

// #region Shared
/** The feed's display title. */
export const CHANGELOG_TITLE = "Changelog";

/**
 * The feed's preview image — a placeholder until a real social card is designed (listed in the
 * P5 notes); a `placehold.co` card at the 1200 × 630 Open Graph size, asked for as PNG because
 * placehold.co answers SVG by default and link-preview scrapers do not render SVG.
 */
export const CHANGELOG_OG_IMAGE = {
	src: "https://placehold.co/1200x630.png?text=Projective+changelog",
	alt: "Projective changelog",
	width: 1200,
	height: 630,
} as const;

/** The RSS alternate every changelog page advertises. */
const RSS_ALTERNATE = {
	type: "application/rss+xml",
	href: CHANGELOG_RSS_PATH,
	title: CHANGELOG_RSS_TITLE,
} as const;

/**
 * A picture as a link preview can show it. Open Graph and Twitter cards take raster images only; a
 * `placehold.co` placeholder is SVG unless its size names a format, so one is asked for as PNG. Any
 * other source (a real capture) passes through unchanged.
 */
export function previewImage(image: ChangelogImage | PageMetaImage): PageMetaImage {
	const width = "w" in image ? image.w : image.width;
	const height = "h" in image ? image.h : image.height;
	const src = image.src.replace(/^(https:\/\/placehold\.co\/\d+x\d+)(?=\?|$)/, "$1.png");
	return {
		src,
		alt: image.alt,
		...(width ? { width } : {}),
		...(height ? { height } : {}),
	};
}

/** `v0.12.0 — Funding before work`: how a release is named in lists and the feed's item list. */
export function releaseLabel(release: Pick<ChangelogRelease, "version" | "title">): string {
	return `v${release.version} — ${release.title}`;
}
// #endregion

// #region Feed
/** One view of the feed: the selected categories (filter order) and the page number. */
export interface FeedView {
	categories: readonly ChangelogCategory[];
	page: number;
}

/** The feed itself: page 1 with no filter. */
const FEED_HOME: FeedView = { categories: [], page: 1 };

/**
 * Whether a view is its own canonical page: an unfiltered page of the series. A filtered view is a
 * subset of the feed and consolidates to `/changelog`.
 */
export function isSelfCanonicalFeedView(view: FeedView): boolean {
	return view.categories.length === 0;
}

/**
 * The feed's page meta input: the title says the page from 2 on (`Changelog · page 2`). The path
 * is `/changelog`; {@link feedViewMeta} gives a later page its own canonical.
 */
export function feedPageMeta(origin: string, page = 1): PageMetaInput {
	return {
		title: page > 1 ? `${CHANGELOG_TITLE} · page ${page}` : CHANGELOG_TITLE,
		description: CHANGELOG_DESCRIPTION,
		path: CHANGELOG_PATH,
		origin,
		ogImage: CHANGELOG_OG_IMAGE,
		alternates: [RSS_ALTERNATE],
	};
}

/**
 * The `<head>` facts for one view of the feed. Page 1 and every filtered view are canonical at
 * `/changelog`; an unfiltered page n > 1 is canonical at itself (`/changelog?page=n`), the one query
 * a canonical keeps — `pageMeta` drops queries, so this view sets the URL after it.
 */
export function feedViewMeta(origin: string, view: FeedView): PageMeta {
	const meta = pageMeta(feedPageMeta(origin, view.page));
	if (view.page === 1 || !isSelfCanonicalFeedView(view)) return meta;
	const canonical = absoluteUrl(origin, feedHref([], view.page));
	return { ...meta, canonical, og: { ...meta.og, url: canonical } };
}

/**
 * The feed's graph: the organisation and the site, plus — on the feed itself (page 1, no filter)
 * only — a CollectionPage listing its releases. Every other view keeps to the first two, so the
 * CollectionPage at `/changelog#webpage` is described once, by the page that is canonical for it.
 */
export function feedJsonLd(
	origin: string,
	releases: readonly ChangelogRelease[],
	latest: string | null,
	view: FeedView = FEED_HOME,
): JsonLdGraph {
	const home = view.page === 1 && view.categories.length === 0;
	return jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		home && collectionPageJsonLd({
			origin,
			path: CHANGELOG_PATH,
			name: CHANGELOG_TITLE,
			description: CHANGELOG_DESCRIPTION,
			...(latest ? { dateModified: latest } : {}),
			items: releases.map((release) => ({
				name: releaseLabel(release),
				path: releasePath(release.version),
			})),
		}),
	);
}
// #endregion

// #region Release
/**
 * A release page's meta: an `article` dated by its release day, its first picture as the preview
 * (as a raster, {@link previewImage}).
 */
export function releasePageMeta(origin: string, release: ChangelogRelease): PageMetaInput {
	const cover = release.images[0];
	return {
		title: `${release.title} · v${release.version}`,
		description: release.summary,
		path: releasePath(release.version),
		origin,
		ogType: "article",
		publishedAt: release.releasedOn,
		modifiedAt: release.releasedOn,
		...(cover ? { ogImage: previewImage(cover) } : {}),
		alternates: [RSS_ALTERNATE],
	};
}

/**
 * A release page's graph: the organisation and site, the page with its breadcrumb (Changelog →
 * v0.12.0), and the TechArticle about Projective at this version.
 */
export function releaseJsonLd(origin: string, release: ChangelogRelease): JsonLdGraph {
	const path = releasePath(release.version);
	const cover = release.images[0];
	return jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		webPageJsonLd({
			origin,
			path,
			name: releaseLabel(release),
			description: release.summary,
			dateModified: release.releasedOn,
			breadcrumb: true,
		}),
		breadcrumbListJsonLd(origin, [
			{ name: CHANGELOG_TITLE, path: CHANGELOG_PATH },
			{ name: `v${release.version}`, path },
		]),
		techArticleJsonLd({
			origin,
			path,
			headline: release.title,
			description: release.summary,
			datePublished: release.releasedOn,
			...(cover ? { image: cover } : {}),
			section: CHANGELOG_TITLE,
			wordCount: wordCount(`${release.summary}\n\n${nodesText(release.body)}`),
			version: release.version,
			about: {
				"@type": "SoftwareApplication",
				name: "Projective",
				applicationCategory: "BusinessApplication",
				operatingSystem: "Web",
				softwareVersion: release.version,
			},
		}),
	);
}
// #endregion
