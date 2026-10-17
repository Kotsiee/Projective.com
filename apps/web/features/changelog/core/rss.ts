import { CHANGELOG_CATEGORY_LABEL, type ChangelogRelease } from "@projective/types/editorial";
import { absoluteUrl } from "@features/marketing/core/seo.ts";
import { CHANGELOG_PATH, CHANGELOG_RSS_PATH, releasePath } from "./changelog-url.ts";

/**
 * rss.ts — the changelog as an RSS 2.0 document (P5, Decision #278), served at
 * `/changelog/rss.xml` as `application/rss+xml`.
 *
 * One `<item>` per release, newest first: its title, the canonical release URL as both `<link>` and
 * a permalink `<guid>`, the release day as an RFC-822 `<pubDate>`, the summary as `<description>`
 * and one `<category>` per category. Every URL is absolute on the origin the route passes
 * (`siteOrigin`), and the channel names itself with `atom:link rel="self"`. `lastBuildDate` is the
 * newest release's day — not the request time — so the document is stable between releases and
 * caches well.
 *
 * Pure: the same releases and origin always give the same bytes.
 */

// #region XML
/** Escape text for an XML element or a double-quoted attribute. */
export function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
		// Characters XML 1.0 cannot carry at all (C0 controls other than tab, LF, CR).
		// deno-lint-ignore no-control-regex
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** `<name>text</name>`, the text escaped. */
function element(name: string, text: string): string {
	return `<${name}>${escapeXml(text)}</${name}>`;
}

/**
 * A `YYYY-MM-DD` day as an RFC-822 date at midnight UTC (`Sun, 11 Oct 2026 00:00:00 GMT`), the form
 * RSS 2.0 requires for `pubDate` and `lastBuildDate`.
 */
export function rfc822Day(isoDay: string): string {
	return new Date(`${isoDay.slice(0, 10)}T00:00:00Z`).toUTCString();
}
// #endregion

// #region Feed
/** What the feed needs besides its releases. */
export interface ChangelogRssOptions {
	/** The public origin every URL is made absolute on (`siteOrigin(ctx.url)`). */
	origin: string;
	/** At most this many items, newest first (default 50). */
	limit?: number;
}

/** The channel's title. */
export const CHANGELOG_RSS_TITLE = "Projective changelog";

/** The channel's description (and the feed page's standfirst). */
export const CHANGELOG_DESCRIPTION =
	"Every release of Projective, newest first: what changed for clients, freelancers, teams and businesses.";

/**
 * The RSS 2.0 document for `releases` (already ordered newest first, already visible). An empty list
 * is a valid channel with no items.
 */
export function buildChangelogRss(
	releases: readonly ChangelogRelease[],
	{ origin, limit = 50 }: ChangelogRssOptions,
): string {
	const items = releases.slice(0, Math.max(0, limit));
	const channelLink = absoluteUrl(origin, CHANGELOG_PATH);
	const self = absoluteUrl(origin, CHANGELOG_RSS_PATH);
	const lines = [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
		`<channel>`,
		element("title", CHANGELOG_RSS_TITLE),
		element("link", channelLink),
		element("description", CHANGELOG_DESCRIPTION),
		element("language", "en"),
		...(items.length > 0 ? [element("lastBuildDate", rfc822Day(items[0].releasedOn))] : []),
		`<atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>`,
		...items.map((release) => {
			const url = absoluteUrl(origin, releasePath(release.version));
			return [
				`<item>`,
				element("title", `v${release.version} — ${release.title}`),
				element("link", url),
				`<guid isPermaLink="true">${escapeXml(url)}</guid>`,
				element("pubDate", rfc822Day(release.releasedOn)),
				element("description", release.summary),
				...release.categories.map((category) =>
					element("category", CHANGELOG_CATEGORY_LABEL[category])
				),
				`</item>`,
			].join("\n");
		}),
		`</channel>`,
		`</rss>`,
	];
	return `${lines.join("\n")}\n`;
}
// #endregion
