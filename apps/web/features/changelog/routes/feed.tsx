import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { applyPageMeta, type JsonLdGraph, pageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import NewsletterForm from "@features/marketing/islands/NewsletterForm.island.tsx";
import { EDITORIAL_ICONS } from "@projective/ui/display/editorial-islands";
import {
	ChangelogBackendService,
	type ChangelogFeed,
} from "@server/services/editorial/ChangelogBackendService.ts";
import ChangelogLightbox from "../islands/ChangelogLightbox.island.tsx";
import { ChangelogFeedView } from "../components/ChangelogFeedView.tsx";
import { type ChangelogNoticeKind, ChangelogNoticeView } from "../components/ChangelogNotice.tsx";
import { parseFeedQuery } from "../core/changelog-url.ts";
import { feedJsonLd, feedPageMeta } from "../core/changelog-meta.ts";
import { galleriesFor } from "../core/galleries.ts";
import type { ChangelogGallery } from "../types/gallery.ts";

/** What the feed page renders: the feed, or a notice (no such page, or the read failed). */
type FeedPageData =
	| { kind: "feed"; feed: ChangelogFeed; galleries: ChangelogGallery[]; graph: JsonLdGraph }
	| { kind: "notice"; notice: ChangelogNoticeKind; retryHref: string };

/**
 * `/changelog` — the feed (P5, Decision #278), re-exported by `routes/(public)/changelog/index.tsx`.
 *
 * Thin: the handler parses the query (`?category=` repeatable, `?page=n`), answers a non-canonical
 * spelling with a 308 to the canonical one, asks {@link ChangelogBackendService.feed} for the page
 * and applies the page meta (canonical `/changelog`, the RSS alternate). A page past the last is a
 * 404 notice and an unreadable changelog a 503 notice, both `noindex`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const query = parseFeedQuery(ctx.url);
		if (query.redirect) {
			return new Response(null, { status: 308, headers: { location: query.redirect } });
		}
		const origin = siteOrigin(ctx.url);
		const result = await ChangelogBackendService.feed(query);
		if (!result.ok || !result.data) {
			const notice: ChangelogNoticeKind = result.status === 404 ? "page-missing" : "unavailable";
			applyPageMeta(
				ctx.state,
				pageMeta({
					...feedPageMeta(origin),
					title: notice === "page-missing" ? "Page not found · Changelog" : "Changelog unavailable",
					noindex: true,
				}),
			);
			return page<FeedPageData>(
				{ kind: "notice", notice, retryHref: ctx.url.pathname + ctx.url.search },
				{ status: notice === "page-missing" ? 404 : 503 },
			);
		}
		applyPageMeta(ctx.state, pageMeta(feedPageMeta(origin)));
		const feed = result.data;
		return page<FeedPageData>({
			kind: "feed",
			feed,
			galleries: galleriesFor(feed.releases),
			graph: feedJsonLd(origin, feed.releases, feed.latest?.releasedOn ?? null),
		});
	},
});

export default define.page<typeof handler>(function ChangelogFeedPage({ data }) {
	if (data.kind === "notice") {
		return (
			<ChangelogNoticeView
				kind={data.notice}
				retryHref={data.retryHref}
				carrier={<ChangelogLightbox galleries={[]} />}
			/>
		);
	}
	return (
		<>
			<ChangelogFeedView
				feed={data.feed}
				glyphs={EDITORIAL_ICONS}
				newsletter={<NewsletterForm topic="changelog" />}
				lightbox={<ChangelogLightbox galleries={data.galleries} />}
			/>
			<JsonLd graph={data.graph} />
		</>
	);
});
