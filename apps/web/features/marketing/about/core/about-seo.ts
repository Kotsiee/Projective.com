import {
	aboutPageJsonLd,
	breadcrumbListJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	organizationId,
	organizationJsonLd,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import { ABOUT_META, ABOUT_PATH } from "./about-content.ts";

/**
 * The `/about` structured data: the `AboutPage` whose main entity is the `Organization` (name, url,
 * logo), the `WebSite` it is part of and its breadcrumb trail. The founders join the organisation
 * as `founder` `Person` nodes only once their real names are supplied — a placeholder name is never
 * published as structured data (Decision #277).
 */
export function aboutJsonLd(origin: string): JsonLdGraph {
	return jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		{
			...aboutPageJsonLd({
				origin,
				path: ABOUT_PATH,
				name: "About Projective",
				description: ABOUT_META.description,
				breadcrumb: true,
			}),
			mainEntity: { "@id": organizationId(origin) },
		},
		breadcrumbListJsonLd(origin, [{ name: "Home", path: "/" }, {
			name: "About",
			path: ABOUT_PATH,
		}]),
	);
}
