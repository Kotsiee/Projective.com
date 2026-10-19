import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import {
	applyPageMeta,
	breadcrumbListJsonLd,
	jsonLdGraph,
	organizationJsonLd,
	pageMeta,
	webPageJsonLd,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import {
	EDITORIAL_ICONS,
	ReadingProgress,
	TableOfContents,
} from "@projective/ui/display/editorial-islands";
import { currentVersion, legalFamily, legalToday } from "../../core/registry.ts";
import { type LegalDocumentView, resolveLegalDocument } from "../../core/view.ts";
import { LEGAL_HUB_HREF, legalDocumentHref } from "../../core/versions.ts";
import {
	LegalDocumentViewComponent,
	type LegalIslands,
} from "../../components/LegalDocumentView.tsx";
import { type LegalMissingDocument, LegalMissingView } from "../../components/LegalMissingView.tsx";
import LegalVersionControls from "../../islands/LegalVersionControls.island.tsx";
import LegalStyleAnchor from "../../islands/LegalStyleAnchor.island.tsx";

/** The real islands: the editorial pair, the registry glyphs and the version controls. */
const LIVE_LEGAL_ISLANDS: LegalIslands = {
	TableOfContents,
	ReadingProgress,
	glyphs: EDITORIAL_ICONS,
	VersionControls: LegalVersionControls,
};

/** What the document page renders: the document, or the not-found notice in the same frame. */
type LegalDocumentData =
	| { kind: "document"; view: LegalDocumentView; today: string; origin: string }
	| { kind: "missing"; document: LegalMissingDocument | null };

/** The tab title: the document, and the version or comparison when the address names one. */
function pageTitle(view: LegalDocumentView): string {
	if (view.compare) {
		return `${view.doc.title}: changes from ${view.compare.version} to ${view.doc.version}`;
	}
	return view.pinned && view.shown.status !== "current"
		? `${view.doc.title} (version ${view.doc.version})`
		: view.doc.title;
}

/**
 * `/legal/:slug` — one legal document (Decision #270), re-exported by
 * `routes/(public)/legal/[slug]/index.tsx`. Thin controller: resolve the slug and the query
 * (`resolveLegalDocument` — `?v=` pins a version, `?compare=` diffs against an older one), answer an
 * unknown document or version with a real 404 — rendered in the reading frame (inside the public
 * shell), `noindex`, with its own h1 and the way back — and an empty or reversed parameter with a 303
 * to the clean address, then set the meta: the canonical is always the bare `/legal/:slug`, and the
 * page is `noindex` while its version is a draft, pinned or compared.
 */
export const handler = define.handlers({
	GET(ctx) {
		const today = legalToday();
		const request = resolveLegalDocument(ctx.params.slug, ctx.url.searchParams, today);
		const origin = siteOrigin(ctx.url);
		if (request.kind === "not-found") {
			// A known document whose ?v= / ?compare= names no version, or no document at all.
			const family = legalFamily(ctx.params.slug);
			const document = family
				? { title: currentVersion(family, today).title, href: legalDocumentHref(family.slug) }
				: null;
			applyPageMeta(
				ctx.state,
				pageMeta({
					title: document ? `Version not found · ${document.title}` : "Document not found · Legal",
					description: document
						? `That version of the ${document.title} doesn't exist.`
						: "That legal document doesn't exist.",
					path: document?.href ?? LEGAL_HUB_HREF,
					origin,
					noindex: true,
				}),
			);
			return page<LegalDocumentData>({ kind: "missing", document }, { status: 404 });
		}
		if (request.kind === "redirect") {
			return new Response(null, {
				status: 303,
				headers: { location: new URL(request.location, ctx.url).href },
			});
		}
		const { view } = request;
		applyPageMeta(
			ctx.state,
			pageMeta({
				title: pageTitle(view),
				description: view.doc.summary,
				path: legalDocumentHref(view.family.slug),
				origin,
				noindex: view.noindex,
				// The canonical (bare) address's version, as the JSON-LD below.
				modifiedAt: view.current.updatedAt,
			}),
		);
		return page<LegalDocumentData>({ kind: "document", view, today, origin });
	},
});

export default define.page<typeof handler>(function LegalDocumentScreen({ data }) {
	if (data.kind === "missing") {
		return <LegalMissingView document={data.document} carrier={<LegalStyleAnchor />} />;
	}
	const { view, origin } = data;
	const path = legalDocumentHref(view.family.slug);
	// The graph names the canonical bare address, so it describes the version that address shows —
	// the one in effect today — even on a pinned or compared view of another.
	const canonical = view.current;
	const graph = jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		webPageJsonLd({
			origin,
			path,
			name: canonical.title,
			description: canonical.summary,
			dateModified: canonical.updatedAt,
			version: canonical.version,
			inLanguage: "en",
			breadcrumb: true,
		}),
		breadcrumbListJsonLd(origin, [
			{ name: "Projective", path: "/" },
			{ name: "Legal", path: LEGAL_HUB_HREF },
			{ name: canonical.title, path },
		]),
	);
	return (
		<>
			<LegalDocumentViewComponent view={view} today={data.today} islands={LIVE_LEGAL_ISLANDS} />
			<JsonLd graph={graph} />
		</>
	);
});
