/**
 * Marketing landing — SEO surface.
 *
 * Holds the canonical meta copy and the JSON-LD graph injected into the live DOM (root CLAUDE.md §5,
 * "schema injections inside the live DOM"). Copy is deliberately plain-language ("team of helpers",
 * "pay step by step", "safe money box") so the human and machine layers agree on the same friendly,
 * non-jargon description of the product.
 */

/** Page-level meta consumed by the route handler → `state.title` / `state.description`. */
export const LANDING_META = {
	title: "Projective — build the perfect team of helpers",
	description:
		"Tell Projective what you need and get a ready-made team of helpers. Pay safely, a little at a " +
		"time, and only when you're happy with each step.",
} as const;

/**
 * schema.org JSON-LD graph for the landing page. Serialised into a `<script type="application/ld+json">`
 * so crawlers and answer engines read the organisation, the software product, and the primary FAQ
 * intents without scraping prose. Kept in one graph to avoid duplicate `@context` blocks.
 */
export function landingJsonLd(origin = "https://projective.app"): string {
	const graph = {
		"@context": "https://schema.org",
		"@graph": [
			{
				"@type": "Organization",
				"@id": `${origin}/#org`,
				name: "Projective",
				url: origin,
				description:
					"A friendly place to hire a whole team of helpers and pay safely, a little at a time.",
			},
			{
				"@type": "WebSite",
				"@id": `${origin}/#site`,
				url: origin,
				name: "Projective",
				publisher: { "@id": `${origin}/#org` },
			},
			{
				"@type": "SoftwareApplication",
				name: "Projective",
				applicationCategory: "BusinessApplication",
				operatingSystem: "Web",
				description:
					"Hire a team of helpers and pay safely, a little at a time — only when you're happy with each step.",
				offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
			},
			{
				"@type": "FAQPage",
				mainEntity: [
					{
						"@type": "Question",
						name: "How does hiring a team on Projective work?",
						acceptedAnswer: {
							"@type": "Answer",
							text:
								"Tell Projective what you need and it puts together the perfect team of helpers for you. You work with everyone as one friendly group, and pay through one simple, safe arrangement.",
						},
					},
					{
						"@type": "Question",
						name: "How does paying step by step work?",
						acceptedAnswer: {
							"@type": "Answer",
							text:
								"The work is split into small steps. You pop the money for each step into a safe money box, and it's only handed over once that step is done and you're happy with it.",
						},
					},
				],
			},
		],
	};
	return JSON.stringify(graph);
}
