import type { ChangelogRelease } from "@projective/types/editorial";
import { nodesText, wordCount } from "@projective/types/content/text";
import {
	breadcrumbListJsonLd,
	collectionPageJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	organizationJsonLd,
	type PageMetaInput,
	techArticleJsonLd,
	webPageJsonLd,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import { CHANGELOG_DESCRIPTION, CHANGELOG_RSS_TITLE } from "./rss.ts";
import { CHANGELOG_PATH, CHANGELOG_RSS_PATH, releasePath } from "./changelog-url.ts";

/**
 * changelog-meta.ts — the changelog's `<head>` facts and structured data (P5, Decision #278), built
 * from what the service returned so a route only applies them.
 *
 *  - The feed is a `CollectionPage` whose `ItemList` is the releases on the page, each pointing at
 *    its canonical release URL; every feed view (a filter, page 2) names `/changelog` as canonical,
 *    because each release's own page is its canonical home.
 *  - A release is a `TechArticle` about the `SoftwareApplication` Projective at that
 *    `softwareVersion`, on a `WebPage` with a two-step breadcrumb.
 *  - Both advertise the RSS feed with `<link rel="alternate" type="application/rss+xml">`.
 */

// #region Shared
/** The feed's display title. */
export const CHANGELOG_TITLE = "Changelog";

/**
 * The feed's preview image — a placeholder until a real social card is designed (listed in the
 * P5 notes); a `placehold.co` card at the 1200 × 630 Open Graph size.
 */
export const CHANGELOG_OG_IMAGE = {
	src: "https://placehold.co/1200x630?text=Projective+changelog",
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

/** `v0.12.0 — Funding before work`: how a release is named in lists and the feed's item list. */
export function releaseLabel(release: Pick<ChangelogRelease, "version" | "title">): string {
	return `v${release.version} — ${release.title}`;
}
// #endregion

// #region Feed
/** The feed's page meta (every view of the feed shares one canonical, `/changelog`). */
export function feedPageMeta(origin: string): PageMetaInput {
	return {
		title: CHANGELOG_TITLE,
		description: CHANGELOG_DESCRIPTION,
		path: CHANGELOG_PATH,
		origin,
		ogImage: CHANGELOG_OG_IMAGE,
		alternates: [RSS_ALTERNATE],
	};
}

/** The feed's graph: the organisation, the site, and a CollectionPage listing this page's releases. */
export function feedJsonLd(
	origin: string,
	releases: readonly ChangelogRelease[],
	latest: string | null,
): JsonLdGraph {
	return jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		collectionPageJsonLd({
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
/** A release page's meta: an `article` dated by its release day, its first picture as the preview. */
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
		...(cover ? { ogImage: cover } : {}),
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
