import type { ComponentType, JSX } from "preact";
import { useContext } from "preact/hooks";
import type { Doc } from "@projective/types/content";
import {
	EDITORIAL_ARTICLE_TOPIC_LABEL,
	type EditorialArticleAuthor,
	type EditorialArticleCard,
	type EditorialArticlePage,
	type EditorialArticleView,
} from "@projective/types/editorial";
import { DocumentDate } from "@projective/ui/display/editorial";
import type { DocumentPageProps } from "@features/marketing/components/DocumentPageView.tsx";
import { articleCtaFor, ctaSectionIndex } from "../core/article-cta.ts";
import { readTimeLabel, updatedAfterPublishing } from "../core/article-format.ts";
import { ArticleGlyphContext } from "../core/article-glyphs.ts";
import { articlesIndexHref } from "../core/index-query.ts";
import { ArticleByline } from "./ArticleByline.tsx";
import { ArticleCta } from "./ArticleCta.tsx";
import { ArticleTile } from "./ArticleTile.tsx";

// #region Props
/** Props for {@link ArticleReaderView}. */
export interface ArticleReaderViewProps {
	page: EditorialArticlePage;
	/** Whether the reader is signed in — it picks the call to action's destination. */
	signedIn: boolean;
	/**
	 * The document composite to render through: the route passes P0's `DocumentPage` (with its
	 * islands); a render test passes `DocumentPageView` bound to `STATIC_DOCUMENT_ISLANDS`.
	 */
	Document: ComponentType<DocumentPageProps>;
}
// #endregion

/** Ids this page renders outside the article body, so no generated heading anchor takes one. */
const READER_IDS = ["artl-cta-title", "artl-author-title", "artl-related-title"] as const;

/** The article as the shared document core P0's reader renders. */
export function articleDoc(article: EditorialArticleView): Doc {
	return {
		id: article.slug,
		slug: article.slug,
		title: article.title,
		summary: article.standfirst,
		updatedAt: article.updatedAt.slice(0, 10),
		version: article.updatedAt.slice(0, 10),
		sections: article.sections,
	};
}

/**
 * ArticleReaderView — `/articles/[slug]` on P0's document reader (`DocumentPage`, the article
 * variant `ui-doc--article`): the reading-progress bar; the primary topic as the eyebrow, the title
 * and standfirst; one Meta-register line (date · reading time · updated); the byline as the article's
 * `<address>`; the cover (the page's largest paint — eager and high priority, its box reserved); the
 * "On this page" table of contents derived from the sections; the body; the one call to action after
 * ~60% of it; then the author, the article's topics, related reading and the way back.
 *
 * Free of islands so a test can render it whole; the route adds the stylesheet-carrying island and
 * the structured data.
 */
export function ArticleReaderView(
	{ page, signedIn, Document }: ArticleReaderViewProps,
): JSX.Element {
	const { article, author, related } = page;
	const ctaAt = ctaSectionIndex(article.sections);
	const cta = articleCtaFor(article.topics[0], signedIn);
	return (
		<Document
			doc={articleDoc(article)}
			class="ui-doc--article"
			eyebrow={EDITORIAL_ARTICLE_TOPIC_LABEL[article.topics[0]]}
			meta={[
				<DocumentDate key="published" iso={article.publishedAt} />,
				readTimeLabel(article.readMinutes),
				updatedAfterPublishing(article)
					? <DocumentDate key="updated" prefix="Updated" iso={article.updatedAt} />
					: null,
			]}
			notice={<ArticleByline author={author} />}
			before={<ArticleCover article={article} />}
			reserved={READER_IDS}
			sectionSlots={(_section, i) => i === ctaAt ? { after: <ArticleCta cta={cta} /> } : undefined}
			after={<ArticleFooter article={article} author={author} related={related} />}
		/>
	);
}

/** The cover: the page's largest paint, so loaded eagerly at high priority, its box reserved. */
function ArticleCover({ article }: { article: EditorialArticleView }): JSX.Element {
	return (
		<figure class="artl-cover">
			<img
				class="artl-cover__img"
				src={article.cover.src}
				alt={article.cover.alt}
				width={article.cover.w}
				height={article.cover.h}
				loading="eager"
				fetchpriority="high"
				decoding="async"
			/>
		</figure>
	);
}

/** After the body: the author, the topics as links into the index, related reading, the way back. */
function ArticleFooter(
	{ article, author, related }: {
		article: EditorialArticleView;
		author: EditorialArticleAuthor;
		related: EditorialArticleCard[];
	},
): JSX.Element {
	const glyphs = useContext(ArticleGlyphContext);
	return (
		<div class="artl-footer" data-print="hide">
			<section aria-labelledby="artl-author-title">
				<h2 class="artl-footer__title" id="artl-author-title">About the author</h2>
				<ArticleByline author={author} size="lg" />
				<p class="artl-author__bio">{author.bio}</p>
			</section>
			<p class="artl-footer__topics">
				Filed under {article.topics.map((topic, i) => (
					<span key={topic}>
						<a href={articlesIndexHref({ topics: [topic] })}>
							{EDITORIAL_ARTICLE_TOPIC_LABEL[topic]}
						</a>
						{i < article.topics.length - 1
							? <span class="artl-meta__sep" aria-hidden="true">·</span>
							: null}
					</span>
				))}
			</p>
			{related.length > 0
				? (
					<section aria-labelledby="artl-related-title">
						<h2 class="artl-footer__title" id="artl-related-title">Related reading</h2>
						<ul class="artl-related" role="list">
							{related.map((card) => (
								<li key={card.slug}>
									<ArticleTile card={card} variant="compact" level={3} />
								</li>
							))}
						</ul>
					</section>
				)
				: null}
			<a class="artl-footer__back" href={articlesIndexHref()}>
				{glyphs.back?.()} All articles
			</a>
		</div>
	);
}
