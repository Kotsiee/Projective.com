import type { JSX } from "preact";
import type { PageMeta } from "../core/seo.ts";

/** Props for {@link PageMetaTags}. */
export interface PageMetaTagsProps {
	/** The page's meta (`pageMeta(...)`, put on state by `applyPageMeta`). */
	meta: PageMeta;
}

/**
 * PageMetaTags — the `<head>` tags a {@link PageMeta} stands for, beyond the title and description
 * the root `_app` already writes: the canonical link (one per page), any alternate representations
 * (a feed's `<link rel="alternate">`), robots, the Open Graph block (with `article:*` times for a
 * dated document) and the Twitter card kind. Rendered by `_app` inside `<head>`; a page never writes
 * these itself.
 */
export function PageMetaTags({ meta }: PageMetaTagsProps): JSX.Element {
	const { og } = meta;
	return (
		<>
			<link rel="canonical" href={meta.canonical} />
			{(meta.alternates ?? []).map((alt) => (
				<link key={alt.href} rel="alternate" type={alt.type} href={alt.href} title={alt.title} />
			))}
			<meta name="robots" content={meta.robots} />
			<meta property="og:type" content={og.type} />
			<meta property="og:site_name" content={og.siteName} />
			<meta property="og:title" content={og.title} />
			<meta property="og:description" content={og.description} />
			<meta property="og:url" content={og.url} />
			{og.image ? <meta property="og:image" content={og.image.url} /> : null}
			{og.image?.alt ? <meta property="og:image:alt" content={og.image.alt} /> : null}
			{og.image?.width ? <meta property="og:image:width" content={String(og.image.width)} /> : null}
			{og.image?.height
				? <meta property="og:image:height" content={String(og.image.height)} />
				: null}
			{og.publishedAt ? <meta property="article:published_time" content={og.publishedAt} /> : null}
			{og.modifiedAt ? <meta property="article:modified_time" content={og.modifiedAt} /> : null}
			<meta name="twitter:card" content={meta.twitterCard} />
		</>
	);
}
