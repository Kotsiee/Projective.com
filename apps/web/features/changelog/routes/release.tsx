import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { applyPageMeta, type JsonLdGraph, pageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { EDITORIAL_ICONS } from "@projective/ui/display/editorial-islands";
import {
	ChangelogBackendService,
	type ChangelogReleaseView as ReleaseData,
} from "@server/services/editorial/ChangelogBackendService.ts";
import ChangelogLightbox from "../islands/ChangelogLightbox.island.tsx";
import { ChangelogReleaseView } from "../components/ChangelogReleaseView.tsx";
import { type ChangelogNoticeKind, ChangelogNoticeView } from "../components/ChangelogNotice.tsx";
import { CHANGELOG_PATH, readVersionSegment, releasePath } from "../core/changelog-url.ts";
import { releaseJsonLd, releasePageMeta } from "../core/changelog-meta.ts";
import { galleriesFor } from "../core/galleries.ts";
import type { ChangelogGallery } from "../types/gallery.ts";

/** What the release page renders: the release, or a notice (no such release, or the read failed). */
type ReleasePageData =
	| { kind: "release"; data: ReleaseData; galleries: ChangelogGallery[]; graph: JsonLdGraph }
	| { kind: "notice"; notice: ChangelogNoticeKind; retryHref: string };

/**
 * `/changelog/[version]` — a release's canonical page (P5, Decision #278), re-exported by
 * `routes/(public)/changelog/[version].tsx`.
 *
 * Thin: `v0.12.0` (any case) answers a 308 to `/changelog/0.12.0`; a segment that is not a version,
 * and a version that is unknown, withdrawn or not out yet, is one 404 notice; an unreadable
 * changelog is a 503 notice. Otherwise the release, its neighbours, its page meta (an `article`,
 * canonical at its own path) and its TechArticle graph.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const segment = readVersionSegment(ctx.params.version ?? "");
		if (segment && !segment.canonical) {
			return new Response(null, {
				status: 308,
				headers: { location: `${releasePath(segment.version)}${ctx.url.search}` },
			});
		}
		const origin = siteOrigin(ctx.url);
		const result = segment
			? await ChangelogBackendService.release(segment.version)
			: { ok: false, status: 404 } as const;
		if (!result.ok || !result.data) {
			const notice: ChangelogNoticeKind = result.status === 404 ? "release-missing" : "unavailable";
			applyPageMeta(
				ctx.state,
				pageMeta({
					title: notice === "release-missing"
						? "Release not found · Changelog"
						: "Changelog unavailable",
					description: "The Projective changelog.",
					path: CHANGELOG_PATH,
					origin,
					noindex: true,
				}),
			);
			return page<ReleasePageData>(
				{ kind: "notice", notice, retryHref: ctx.url.pathname + ctx.url.search },
				{ status: notice === "release-missing" ? 404 : 503 },
			);
		}
		const data = result.data;
		applyPageMeta(ctx.state, pageMeta(releasePageMeta(origin, data.release)));
		return page<ReleasePageData>({
			kind: "release",
			data,
			galleries: galleriesFor([data.release]),
			graph: releaseJsonLd(origin, data.release),
		});
	},
});

export default define.page<typeof handler>(function ChangelogReleasePage({ data }) {
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
			<ChangelogReleaseView
				data={data.data}
				glyphs={EDITORIAL_ICONS}
				lightbox={<ChangelogLightbox galleries={data.galleries} />}
			/>
			<JsonLd graph={data.graph} />
		</>
	);
});
