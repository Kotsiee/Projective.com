import { CONTACT_INTENTS } from "@projective/types/contact";
import {
	absoluteUrl,
	contactPageJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	type JsonLdNode,
	organizationJsonLd,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import { INTENT_COPY } from "./contact-copy.ts";
import { CONTACT_PATH, contactHref } from "./contact-url.ts";

/**
 * contact-jsonld — `/contact`'s structured data (Decision #276): a `ContactPage` that is part of the
 * site, and the publishing `Organization` with one `contactPoint` per intent (sales, customer support,
 * dispute resolution, security), each pointing at that intent's form. No telephone or email is
 * published, because none exists to publish — a contact point is its URL. Pure: the route passes its
 * own origin.
 */

/** The organisation node with its contact points. */
export function contactOrganizationJsonLd(origin: string): JsonLdNode {
	return {
		...organizationJsonLd(origin),
		contactPoint: CONTACT_INTENTS.map((intent) => ({
			"@type": "ContactPoint",
			contactType: INTENT_COPY[intent].contactType,
			url: absoluteUrl(origin, contactHref(intent)),
			availableLanguage: ["en"],
		})),
	};
}

/** The page's whole graph. */
export function contactJsonLd(origin: string, description: string): JsonLdGraph {
	return jsonLdGraph(
		contactPageJsonLd({ origin, path: CONTACT_PATH, name: "Contact Projective", description }),
		webSiteJsonLd(origin),
		contactOrganizationJsonLd(origin),
	);
}
