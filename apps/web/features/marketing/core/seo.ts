/**
 * The public site's SEO surface.
 *
 * Two layers:
 *  - **Page meta** — {@link pageMeta} builds a route's `<head>` facts (document title, description,
 *    canonical URL, robots, Open Graph, Twitter card) and {@link applyPageMeta} puts them on request
 *    state, which the root `_app` renders. That is the one mechanism this Fresh 2 app has for the
 *    head: handlers set `ctx.state`, `_app` writes it.
 *  - **Structured data** — typed schema.org JSON-LD builders (Organization, WebSite, WebPage and its
 *    About / Contact / Collection kinds, BreadcrumbList, Article / TechArticle, FAQPage) composed
 *    with {@link jsonLdGraph} and rendered by the `JsonLd` component, which emits the server copy and
 *    mounts the `SchemaInjector` island so the graph also survives hydration (root CLAUDE.md §5,
 *    "schema injections inside the live DOM"). Pages never hand-write a `<script>` tag.
 *
 * The landing page's own copy and graph ({@link LANDING_META}, {@link landingJsonLd}) are unchanged
 * and still plain-language ("team of helpers", "pay step by step") so the human and machine layers
 * agree on the same friendly description of the product.
 */
import { type FaqItem, nodesText } from "@projective/types/content";

/** Page-level meta consumed by the route handler → `state.title` / `state.description`. */
export const LANDING_META = {
	title: "Projective — build the perfect team of helpers",
	description:
		"Tell Projective what you need and get a ready-made team of helpers. Pay safely, a little at a " +
		"time, and only when you're happy with each step.",
} as const;

/**
 * schema.org JSON-LD graph for the landing page. Serialised into a `<script type="application/ld+json">`
 * so crawlers and answer engines read the company, the software product, and the primary FAQ
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

// #region Site & URLs
/** The product name every document title and Open Graph block carries. */
export const SITE_NAME = "Projective";

/**
 * Join an origin and a path into an absolute URL. An already-absolute `http(s)` URL is returned as
 * is, so a caller may pass either a path (`/test_images/banner_1.jpg`) or a full image URL.
 */
export function absoluteUrl(origin: string, pathOrUrl: string): string {
	if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
	const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
	return `${origin.replace(/\/+$/, "")}${path}`;
}

/**
 * The canonical URL of a page: absolute, with no query and no fragment, duplicate slashes collapsed
 * and no trailing slash (except the root). One page, one canonical — two spellings of the same path
 * (`/legal/terms/`, `/legal/terms?ref=footer`) must name the same URL.
 */
export function canonicalUrl(origin: string, path: string): string {
	const bare = path.split(/[?#]/)[0].replace(/\/{2,}/g, "/");
	const trimmed = bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
	return absoluteUrl(origin, trimmed === "" ? "/" : trimmed);
}

/** The `<title>` for a page: `Page · Projective`, unless the title already carries the brand. */
export function documentTitle(title: string): string {
	return title === SITE_NAME || title.includes(`${SITE_NAME} —`) || title.endsWith(`· ${SITE_NAME}`)
		? title
		: `${title} · ${SITE_NAME}`;
}
// #endregion

// #region Page meta
/** An Open Graph / Twitter preview image. Dimensions let a crawler lay the card out without fetching. */
export interface PageMetaImage {
	/** A same-origin path or an absolute URL. */
	src: string;
	alt: string;
	width?: number;
	height?: number;
}

/** What a route knows about its page. */
export interface PageMetaInput {
	/** The page's own title, without the brand (`Privacy Policy`). */
	title: string;
	/** One or two sentences — the meta description and the preview text. */
	description: string;
	/** The canonical path (`/legal/privacy`). Query and fragment are dropped. */
	path: string;
	/** The request origin — pass `ctx.url.origin`. */
	origin: string;
	/** Keep the page out of search indexes (`noindex, follow`) — e.g. a legal draft not yet reviewed. */
	noindex?: boolean;
	/** The preview image; a bare string is a path or URL with no alt text (avoid). */
	ogImage?: PageMetaImage | string;
	/** `article` for a dated document (articles, changelog entries); `website` otherwise. */
	ogType?: "website" | "article";
	/** ISO date or date-time the document was first published (`article:published_time`). */
	publishedAt?: string;
	/** ISO date or date-time it last changed (`article:modified_time`). */
	modifiedAt?: string;
}

/** The `<head>` facts `_app` renders for a page (see {@link pageMeta}). */
export interface PageMeta {
	/** The full `<title>` (`Privacy Policy · Projective`). */
	title: string;
	description: string;
	/** Absolute canonical URL. */
	canonical: string;
	/** `index, follow` or `noindex, follow`. */
	robots: string;
	/** Open Graph block. */
	og: {
		type: "website" | "article";
		siteName: string;
		title: string;
		description: string;
		url: string;
		image?: { url: string; alt?: string; width?: number; height?: number };
		publishedAt?: string;
		modifiedAt?: string;
	};
	/** Twitter card kind: a large image card when there is an image. */
	twitterCard: "summary" | "summary_large_image";
}

/**
 * Build a page's `<head>` facts. Pure: the route passes its own origin, so the same call is
 * testable and gives the same answer in every environment.
 *
 * @example
 * ```ts
 * applyPageMeta(ctx.state, pageMeta({
 *   title: doc.title, description: doc.summary, path: `/legal/${doc.slug}`,
 *   origin: ctx.url.origin, noindex: doc.reviewedAt === null,
 * }));
 * ```
 */
export function pageMeta(input: PageMetaInput): PageMeta {
	const canonical = canonicalUrl(input.origin, input.path);
	const image = typeof input.ogImage === "string" ? { src: input.ogImage, alt: "" } : input.ogImage;
	return {
		title: documentTitle(input.title),
		description: input.description,
		canonical,
		robots: input.noindex ? "noindex, follow" : "index, follow",
		og: {
			type: input.ogType ?? "website",
			siteName: SITE_NAME,
			title: input.title,
			description: input.description,
			url: canonical,
			...(image
				? {
					image: {
						url: absoluteUrl(input.origin, image.src),
						...(image.alt ? { alt: image.alt } : {}),
						...(image.width ? { width: image.width } : {}),
						...(image.height ? { height: image.height } : {}),
					},
				}
				: {}),
			...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
			...(input.modifiedAt ? { modifiedAt: input.modifiedAt } : {}),
		},
		twitterCard: image ? "summary_large_image" : "summary",
	};
}

/**
 * Put a page's meta on request state for the root `_app` to render: the full `meta` (canonical,
 * robots, Open Graph) plus the `title` / `description` pair every other route already sets.
 */
export function applyPageMeta(
	state: { title?: string; description?: string; meta?: PageMeta },
	meta: PageMeta,
): void {
	state.title = meta.title;
	state.description = meta.description;
	state.meta = meta;
}
// #endregion

// #region JSON-LD
/** One schema.org node. */
export type JsonLdNode = { "@type": string; "@id"?: string } & Record<string, unknown>;

/** A schema.org graph — one `@context`, every node of the page in `@graph`. */
export interface JsonLdGraph {
	"@context": "https://schema.org";
	"@graph": JsonLdNode[];
}

/** Compose nodes into one graph (falsy entries are skipped, so optional nodes inline cleanly). */
export function jsonLdGraph(...nodes: Array<JsonLdNode | null | undefined | false>): JsonLdGraph {
	return {
		"@context": "https://schema.org",
		"@graph": nodes.filter((node): node is JsonLdNode => Boolean(node)),
	};
}

/** U+2028 / U+2029, spelled by code point so no tool can turn them into raw characters. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * Serialise structured data for a `<script type="application/ld+json">` body. `JSON.stringify` alone
 * is not safe there: an HTML parser ends the script at a literal `</` whatever the JSON quoting, so
 * `<`, `>` and `&` are written as their `\u` escapes (JSON-legal, parsed back to the same string), as
 * are the two line separators JavaScript string literals reject.
 */
export function serializeJsonLd(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replaceAll(LINE_SEPARATOR, "\\u2028")
		.replaceAll(PARAGRAPH_SEPARATOR, "\\u2029");
}

/** The organisation node's id on `origin` (`https://…/#org`). */
export function organizationId(origin: string): string {
	return `${absoluteUrl(origin, "/")}#org`;
}

/** The website node's id on `origin` (`https://…/#site`). */
export function websiteId(origin: string): string {
	return `${absoluteUrl(origin, "/")}#site`;
}

/** The platform as an `Organization` — the publisher every other node points at by `@id`. */
export function organizationJsonLd(origin: string): JsonLdNode {
	return {
		"@type": "Organization",
		"@id": organizationId(origin),
		name: SITE_NAME,
		url: absoluteUrl(origin, "/"),
		logo: {
			"@type": "ImageObject",
			url: absoluteUrl(origin, "/icon-512.png"),
			width: 512,
			height: 512,
		},
	};
}

/** The site as a `WebSite`, published by the organisation. */
export function webSiteJsonLd(origin: string): JsonLdNode {
	return {
		"@type": "WebSite",
		"@id": websiteId(origin),
		url: absoluteUrl(origin, "/"),
		name: SITE_NAME,
		publisher: { "@id": organizationId(origin) },
	};
}

/** The page kinds {@link webPageJsonLd} can declare. */
export type WebPageKind = "WebPage" | "AboutPage" | "ContactPage" | "CollectionPage";

/** Input for {@link webPageJsonLd}. */
export interface WebPageJsonLdInput {
	origin: string;
	/** The page's canonical path. */
	path: string;
	name: string;
	description: string;
	/** ISO date the page last changed. */
	dateModified?: string;
	/** Link the page to its breadcrumb trail (emit a {@link breadcrumbListJsonLd} for the same path). */
	breadcrumb?: boolean;
	/** For a `CollectionPage`: the items it lists, in order. */
	items?: ReadonlyArray<{ name: string; path: string }>;
	/** BCP 47 language (default `en`). */
	inLanguage?: string;
}

/** The `@id` of the page node at `path` (`https://…/legal/terms#webpage`). */
export function webPageId(origin: string, path: string): string {
	return `${canonicalUrl(origin, path)}#webpage`;
}

/** The `@id` of the breadcrumb trail at `path`. */
export function breadcrumbId(origin: string, path: string): string {
	return `${canonicalUrl(origin, path)}#breadcrumb`;
}

/** A page node, part of the website, of the given {@link WebPageKind}. */
export function webPageJsonLd(
	input: WebPageJsonLdInput,
	kind: WebPageKind = "WebPage",
): JsonLdNode {
	const url = canonicalUrl(input.origin, input.path);
	return {
		"@type": kind,
		"@id": webPageId(input.origin, input.path),
		url,
		name: input.name,
		description: input.description,
		inLanguage: input.inLanguage ?? "en",
		isPartOf: { "@id": websiteId(input.origin) },
		publisher: { "@id": organizationId(input.origin) },
		...(input.dateModified ? { dateModified: input.dateModified } : {}),
		...(input.breadcrumb ? { breadcrumb: { "@id": breadcrumbId(input.origin, input.path) } } : {}),
		...(input.items && input.items.length > 0
			? {
				mainEntity: {
					"@type": "ItemList",
					itemListElement: input.items.map((item, i) => ({
						"@type": "ListItem",
						position: i + 1,
						name: item.name,
						url: canonicalUrl(input.origin, item.path),
					})),
				},
			}
			: {}),
	};
}

/** `/about` — an `AboutPage`. */
export function aboutPageJsonLd(input: WebPageJsonLdInput): JsonLdNode {
	return webPageJsonLd(input, "AboutPage");
}

/** `/contact` — a `ContactPage`. */
export function contactPageJsonLd(input: WebPageJsonLdInput): JsonLdNode {
	return webPageJsonLd(input, "ContactPage");
}

/** A hub that lists documents (`/legal`, `/help`, `/changelog`, `/articles`) — a `CollectionPage`. */
export function collectionPageJsonLd(input: WebPageJsonLdInput): JsonLdNode {
	return webPageJsonLd(input, "CollectionPage");
}

/** One step of a breadcrumb trail. */
export interface Crumb {
	name: string;
	path: string;
}

/**
 * A `BreadcrumbList` for the page at `path` (default: the last crumb's path), each crumb an absolute
 * canonical URL in order from the root.
 */
export function breadcrumbListJsonLd(
	origin: string,
	crumbs: readonly Crumb[],
	path?: string,
): JsonLdNode {
	const at = path ?? crumbs[crumbs.length - 1]?.path ?? "/";
	return {
		"@type": "BreadcrumbList",
		"@id": breadcrumbId(origin, at),
		itemListElement: crumbs.map((crumb, i) => ({
			"@type": "ListItem",
			position: i + 1,
			name: crumb.name,
			item: canonicalUrl(origin, crumb.path),
		})),
	};
}

/** Who wrote an article: a person (with a profile URL), or the platform when omitted. */
export interface JsonLdAuthor {
	name: string;
	/** A path or URL of the author's page. */
	url?: string;
	/** `Organization` for a team byline; `Person` by default. */
	kind?: "Person" | "Organization";
}

/** Input for {@link articleJsonLd}. */
export interface ArticleJsonLdInput {
	origin: string;
	/** The article's canonical path. */
	path: string;
	/** Its title (schema.org truncates headlines over 110 characters; so does this builder). */
	headline: string;
	description: string;
	/** ISO date or date-time first published. */
	datePublished: string;
	/** ISO date or date-time last changed (default `datePublished`). */
	dateModified?: string;
	/** Authors; omitted, the platform is the author. */
	authors?: readonly JsonLdAuthor[];
	/** A cover image path or URL. */
	image?: string;
	/** A section name (`Payments`, `Product updates`). */
	section?: string;
	/** The body's word count. */
	wordCount?: number;
}

/** An `Article` (or a `TechArticle`, through {@link techArticleJsonLd}) published by the platform. */
export function articleJsonLd(
	input: ArticleJsonLdInput,
	kind: "Article" | "TechArticle" = "Article",
): JsonLdNode {
	const url = canonicalUrl(input.origin, input.path);
	const authors = input.authors && input.authors.length > 0
		? input.authors.map((author) => ({
			"@type": author.kind ?? "Person",
			name: author.name,
			...(author.url ? { url: absoluteUrl(input.origin, author.url) } : {}),
		}))
		: [{ "@id": organizationId(input.origin) }];
	return {
		"@type": kind,
		"@id": `${url}#article`,
		headline: input.headline.length > 110 ? `${input.headline.slice(0, 109)}…` : input.headline,
		description: input.description,
		url,
		mainEntityOfPage: { "@id": webPageId(input.origin, input.path) },
		datePublished: input.datePublished,
		dateModified: input.dateModified ?? input.datePublished,
		author: authors.length === 1 ? authors[0] : authors,
		publisher: { "@id": organizationId(input.origin) },
		inLanguage: "en",
		...(input.image ? { image: absoluteUrl(input.origin, input.image) } : {}),
		...(input.section ? { articleSection: input.section } : {}),
		...(input.wordCount ? { wordCount: input.wordCount } : {}),
	};
}

/** A `TechArticle` — a help article or a how-to. */
export function techArticleJsonLd(input: ArticleJsonLdInput): JsonLdNode {
	return articleJsonLd(input, "TechArticle");
}

/** One FAQ entry as structured data: the question and its answer as plain text. */
export interface FaqJsonLdItem {
	question: string;
	answer: string;
}

/** Content-module FAQ items (`@projective/types/content`) as {@link FaqJsonLdItem}s. */
export function faqJsonLdItems(items: readonly FaqItem[]): FaqJsonLdItem[] {
	return items.map((item) => ({ question: item.question, answer: nodesText(item.answer) }));
}

/** An `FAQPage` whose main entity is its questions, each with one accepted answer. */
export function faqPageJsonLd(
	input: { origin: string; path: string; items: readonly FaqJsonLdItem[] },
): JsonLdNode {
	return {
		"@type": "FAQPage",
		"@id": `${canonicalUrl(input.origin, input.path)}#faq`,
		mainEntity: input.items.map((item) => ({
			"@type": "Question",
			name: item.question,
			acceptedAnswer: { "@type": "Answer", text: item.answer },
		})),
	};
}
// #endregion
