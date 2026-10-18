import type { JSX } from "preact";
import {
	EDITORIAL_ARTICLE_TOPIC_LABEL,
	type EditorialArticleIndex,
} from "@projective/types/editorial";
import { arrangeIndexPage } from "../core/article-format.ts";
import { ARTICLES_INDEX_DESCRIPTION } from "../core/article-seo.ts";
import { articlesIndexHref } from "../core/index-query.ts";
import { ArticleTile } from "./ArticleTile.tsx";
import { ArticleTopicFilter } from "./ArticleTopicFilter.tsx";
import { ArticlePagination } from "./ArticlePagination.tsx";

/** Props for {@link ArticlesIndexView}. */
export interface ArticlesIndexViewProps {
	index: EditorialArticleIndex;
}

/** "6 articles", "2 articles on Value pricing", "1 article on Agile delivery or Team structure". */
export function indexSummary(index: Pick<EditorialArticleIndex, "total" | "topics">): string {
	const count = `${index.total} ${index.total === 1 ? "article" : "articles"}`;
	if (index.topics.length === 0) return count;
	const labels = index.topics.map((topic) => EDITORIAL_ARTICLE_TOPIC_LABEL[topic]);
	const named = labels.length === 1
		? labels[0]
		: `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
	return `${count} on ${named}`;
}

/**
 * ArticlesIndexView — `/articles`, server-rendered and free of islands (the route adds the
 * stylesheet-carrying island and the structured data). The page's one `<h1>`, the lead paragraph,
 * the topic filter, then page 1's lead story and two features and the grid of the rest (a later page
 * is the grid alone), and the pager. When nothing matches, an empty state names the filter and
 * offers every topic instead. Static content is unboxed; only the tiles, which are links, are cards.
 */
export function ArticlesIndexView({ index }: ArticlesIndexViewProps): JSX.Element {
	const { lead, features, grid } = arrangeIndexPage(index.items, index.page);
	const filtered = index.topics.length > 0;
	return (
		<div class="artl-index">
			<div class="artl-index__inner">
				<header class="artl-index__header">
					<h1 class="artl-index__title">Articles</h1>
					<p class="artl-index__lead">{ARTICLES_INDEX_DESCRIPTION}</p>
				</header>

				<ArticleTopicFilter
					selected={index.topics}
					counts={index.topicCounts}
					total={index.publishedTotal}
				/>
				<p class="artl-index__summary">{indexSummary(index)}</p>

				{index.items.length === 0
					? (
						<div class="artl-empty">
							<h2 class="artl-empty__title">
								{filtered ? "Nothing on these topics yet" : "No articles yet"}
							</h2>
							<p class="artl-empty__body">
								{filtered
									? "Try another topic, or read everything we have published so far."
									: "The first articles are on their way. Check back soon."}
							</p>
							{filtered
								? (
									<a
										class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md"
										href={articlesIndexHref()}
									>
										<span class="ui-button__label">Show every topic</span>
									</a>
								)
								: null}
						</div>
					)
					: null}

				{lead || features.length > 0
					? (
						<section class="artl-index__stories" aria-label="Latest">
							{lead ? <ArticleTile card={lead} variant="lead" level={2} priority /> : null}
							{features.length > 0
								? (
									<ul class="artl-index__features" role="list">
										{features.map((card) => (
											<li key={card.slug}>
												<ArticleTile card={card} variant="feature" level={2} />
											</li>
										))}
									</ul>
								)
								: null}
						</section>
					)
					: null}

				{grid.length > 0
					? (
						<section aria-labelledby="artl-more">
							<h2 class="artl-index__section-title" id="artl-more">
								{index.page > 1 ? `Page ${index.page}` : "More articles"}
							</h2>
							<ul class="artl-index__grid" role="list">
								{grid.map((card) => (
									<li key={card.slug}>
										<ArticleTile card={card} variant="grid" level={3} />
									</li>
								))}
							</ul>
						</section>
					)
					: null}

				<ArticlePagination page={index.page} pageCount={index.pageCount} topics={index.topics} />
			</div>
		</div>
	);
}
