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
 * Every public page, the landing included, builds its head and graph from these primitives: the
 * landing's copy lives with it (`features/landing/core/landing-seo.ts`, `flows/LANDING.md` §4.0),
 * not here.
 *
 * Kept client-safe: it value-imports nothing that builds schemas or reads the environment — the
 * plain-text projection comes from the schema-free `@projective/types/content/text` sub-path, the
 * content types are type-only, and the request-origin policy lives server-side (`site-origin.ts`) —
 * so an island may import it without pulling either into the client bundle.
 */
import type { ContentAuthor, ContentImage, FaqItem } from "@projective/types/content";
import { nodesText } from "@projective/types/content/text";

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

/**
 * Any picture a route can hand to the meta and JSON-LD builders: a {@link PageMetaImage}, a content
 * module's `ContentImage` (`{ src, alt, w, h }` — an article cover, as is), or a bare path / URL with
 * no alt text (avoid).
 */
export type MetaImageInput = PageMetaImage | ContentImage | string;

/** Normalise a {@link MetaImageInput} to `{ src, alt, width?, height? }`. */
export function metaImage(image: MetaImageInput): PageMetaImage {
	if (typeof image === "string") return { src: image, alt: "" };
	if ("w" in image) return { src: image.src, alt: image.alt, width: image.w, height: image.h };
	return image;
}

/**
 * An alternate representation of the page, written as `<link rel="alternate">` in the head — the
 * changelog's RSS / Atom feed (`type: "application/rss+xml"`).
 */
export interface PageAlternate {
	/** The media type (`application/rss+xml`, `application/atom+xml`, `application/feed+json`). */
	type: string;
	/** A same-origin path or an absolute URL; made absolute. */
	href: string;
	/** A human name (`Projective changelog`). */
	title?: string;
}

/** What a route knows about its page. */
export interface PageMetaInput {
	/** The page's own title, without the brand (`Privacy Policy`). */
	title: string;
	/** One or two sentences — the meta description and the preview text. */
	description: string;
	/** The canonical path (`/legal/privacy`). Query and fragment are dropped. */
	path: string;
	/**
	 * The site's public origin — pass `siteOrigin(ctx.url)` (`core/site-origin.ts`): `APP_URL` when
	 * deployed, the request's own origin in development. Never `ctx.url.origin` alone in production,
	 * where it reflects the Host header (a proxy's internal host, or a spoofed one).
	 */
	origin: string;
	/** Keep the page out of search indexes (`noindex, follow`) — e.g. a legal draft not yet reviewed. */
	noindex?: boolean;
	/** The preview image (see {@link MetaImageInput}). */
	ogImage?: MetaImageInput;
	/** `article` for a dated document (articles, changelog entries); `website` otherwise. */
	ogType?: "website" | "article";
	/** ISO date or date-time the document was first published (`article:published_time`). */
	publishedAt?: string;
	/** ISO date or date-time it last changed (`article:modified_time`). */
	modifiedAt?: string;
	/** Alternate representations (feeds) — `<link rel="alternate">` each. */
	alternates?: readonly PageAlternate[];
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
	/** Alternate representations, every `href` absolute. Empty when there are none. */
	alternates: ReadonlyArray<{ type: string; href: string; title?: string }>;
}

/**
 * Build a page's `<head>` facts. Pure: the route passes its own origin, so the same call is
 * testable and gives the same answer in every environment.
 *
 * @example
 * ```ts
 * applyPageMeta(ctx.state, pageMeta({
 *   title: doc.title, description: doc.summary, path: `/legal/${doc.slug}`,
 *   origin: siteOrigin(ctx.url), noindex: doc.reviewedAt === null,
 * }));
 * ```
 */
export function pageMeta(input: PageMetaInput): PageMeta {
	const canonical = canonicalUrl(input.origin, input.path);
	const image = input.ogImage === undefined ? undefined : metaImage(input.ogImage);
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
		alternates: (input.alternates ?? []).map((alt) => ({
			type: alt.type,
			href: absoluteUrl(input.origin, alt.href),
			...(alt.title ? { title: alt.title } : {}),
		})),
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
	/** The document's version label (a legal document's `2.1`) — schema.org `version`. */
	version?: string;
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
		...(input.version ? { version: input.version } : {}),
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

/** A content module's author (`ContentAuthor`: `name`, `href`) as a {@link JsonLdAuthor}. */
export function jsonLdAuthor(
	author: ContentAuthor,
	kind: JsonLdAuthor["kind"] = "Person",
): JsonLdAuthor {
	return { name: author.name, ...(author.href ? { url: author.href } : {}), kind };
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
	/** Authors; omitted, the platform is the author. A content author maps through {@link jsonLdAuthor}. */
	authors?: readonly JsonLdAuthor[];
	/**
	 * The cover: a path or URL, or a `ContentImage` / {@link PageMetaImage} — which becomes an
	 * `ImageObject` carrying its width and height.
	 */
	image?: MetaImageInput;
	/** A section name (`Payments`, `Product updates`). */
	section?: string;
	/** The body's word count. */
	wordCount?: number;
	/** The document's version (a release's `1.4.0`) — schema.org `version`. */
	version?: string;
	/**
	 * What the article is about, as a node — a release note's
	 * `{ "@type": "SoftwareApplication", name: "Projective", softwareVersion: "1.4.0" }`.
	 */
	about?: JsonLdNode;
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
		...(input.image ? { image: imageNode(input.origin, input.image) } : {}),
		...(input.section ? { articleSection: input.section } : {}),
		...(input.wordCount ? { wordCount: input.wordCount } : {}),
		...(input.version ? { version: input.version } : {}),
		...(input.about ? { about: input.about } : {}),
	};
}

/**
 * An image as structured data: a bare URL when its size is unknown (a path or a URL string), else
 * an `ImageObject` with its intrinsic `width` and `height`.
 */
function imageNode(origin: string, image: MetaImageInput): string | JsonLdNode {
	const { src, width, height } = metaImage(image);
	const url = absoluteUrl(origin, src);
	return width && height ? { "@type": "ImageObject", url, width, height } : url;
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

// #region Item list
/** One entry of an {@link itemListJsonLd}: what the page prints for it. */
export interface ItemListEntry {
	/** Its visible name. */
	name: string;
	/** Its visible description, when the page prints one. */
	description?: string;
	/** Where it is: a path (made absolute, its fragment kept — `/features#work-board`) or a URL. */
	url?: string;
}

/** Input for {@link itemListJsonLd}. */
export interface ItemListJsonLdInput {
	origin: string;
	/** The page the list is printed on; the list's `@id` hangs off its canonical URL. */
	path: string;
	/** The list's own name, when it has one. */
	name?: string;
	/** The entries, in the page's order. */
	items: readonly ItemListEntry[];
}

/** The `@id` of the item list printed on the page at `path` (`https://…/features#items`). */
export function itemListId(origin: string, path: string): string {
	return `${canonicalUrl(origin, path)}#items`;
}

/**
 * A standalone `ItemList` of the entries a page prints — each a `ListItem` with its position, name,
 * and, when given, its description and its absolute URL — for a page node to name as its
 * `mainEntity` by {@link itemListId}. A hub whose items are pages of their own uses
 * {@link webPageJsonLd}'s `items` instead.
 */
export function itemListJsonLd(input: ItemListJsonLdInput): JsonLdNode {
	return {
		"@type": "ItemList",
		"@id": itemListId(input.origin, input.path),
		...(input.name ? { name: input.name } : {}),
		numberOfItems: input.items.length,
		itemListElement: input.items.map((item, i) => ({
			"@type": "ListItem",
			position: i + 1,
			name: item.name,
			...(item.description ? { description: item.description } : {}),
			...(item.url ? { url: absoluteUrl(input.origin, item.url) } : {}),
		})),
	};
}
// #endregion
