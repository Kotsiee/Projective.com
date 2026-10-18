import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import {
	applyPageMeta,
	breadcrumbListJsonLd,
	collectionPageJsonLd,
	jsonLdGraph,
	organizationJsonLd,
	pageMeta,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { currentVersion, LEGAL_GROUPS, legalFamily, legalToday } from "../../core/registry.ts";
import { LEGAL_HUB_HREF, legalDocumentHref } from "../../core/versions.ts";
import { type LegalHubGroup, LegalHubView } from "../../components/LegalHubView.tsx";
import LegalStyleAnchor from "../../islands/LegalStyleAnchor.island.tsx";

/** The hub's meta description. */
const DESCRIPTION =
	"Projective's Terms of Service, Privacy Policy, Cookie Policy, Acceptable Use Policy, Escrow Terms and IP Transfer Deed — every version, with a plain-English summary of every clause.";

/**
 * `/legal` — the legal hub (Decision #270), re-exported by `routes/(public)/legal/index.tsx`. Thin
 * controller: list every document's version in effect today, in the hub's two groups, and set the
 * page's meta. The page is `noindex` while every document is still a draft (owner ruling (e)): a
 * search result should not land on a library with nothing reviewed in it.
 */
export const handler = define.handlers({
	GET(ctx) {
		const today = legalToday();
		const groups: LegalHubGroup[] = LEGAL_GROUPS.map((group) => ({
			id: group.id,
			label: group.label,
			entries: group.slugs.map((slug) => ({ doc: currentVersion(legalFamily(slug)!, today) })),
		}));
		const docs = groups.flatMap((group) => group.entries.map((entry) => entry.doc));
		const origin = siteOrigin(ctx.url);
		applyPageMeta(
			ctx.state,
			pageMeta({
				title: "Legal",
				description: DESCRIPTION,
				path: LEGAL_HUB_HREF,
				origin,
				noindex: docs.every((doc) => doc.reviewedAt === null),
			}),
		);
		return page({
			groups,
			draft: docs.some((doc) => doc.reviewedAt === null),
			origin,
			modified: docs.map((doc) => doc.updatedAt).sort().at(-1),
		});
	},
});

export default define.page<typeof handler>(function LegalHubScreen({ data }) {
	const { origin, groups } = data;
	const items = groups.flatMap((group) =>
		group.entries.map(({ doc }) => ({ name: doc.title, path: legalDocumentHref(doc.slug) }))
	);
	const graph = jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		collectionPageJsonLd({
			origin,
			path: LEGAL_HUB_HREF,
			name: "Legal",
			description: DESCRIPTION,
			dateModified: data.modified,
			breadcrumb: true,
			items,
		}),
		breadcrumbListJsonLd(origin, [
			{ name: "Projective", path: "/" },
			{ name: "Legal", path: LEGAL_HUB_HREF },
		]),
	);
	return (
		<>
			<LegalHubView groups={groups} draft={data.draft} styleAnchor={<LegalStyleAnchor />} />
			<JsonLd graph={graph} />
		</>
	);
});
