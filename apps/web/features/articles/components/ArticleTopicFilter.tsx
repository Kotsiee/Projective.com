import type { JSX } from "preact";
import { useContext } from "preact/hooks";
import {
	EDITORIAL_ARTICLE_TOPIC_LABEL,
	EDITORIAL_ARTICLE_TOPICS,
	type EditorialArticleTopic,
} from "@projective/types/editorial";
import { ArticleGlyphContext } from "../core/article-glyphs.ts";
import { articlesIndexHref, toggleTopicHref } from "../core/index-query.ts";

/** Props for {@link ArticleTopicFilter}. */
export interface ArticleTopicFilterProps {
	/** The topics the index is filtered by now. */
	selected: readonly EditorialArticleTopic[];
	/** Published articles per topic (unfiltered). */
	counts: Readonly<Record<EditorialArticleTopic, number>>;
	/** Published articles in all. */
	total: number;
}

/**
 * ArticleTopicFilter — the index's topic filter: a control group of real links, so it works with no
 * JavaScript and every filter state has an address. "All topics" clears the filter; each topic chip
 * toggles itself in or out of the selection (any-of) and returns to page 1. A chosen chip is
 * `aria-current="true"` and carries a check glyph as well as its solid tonal fill, so the state never
 * rides on colour alone. Each count is the number of published articles under the topic.
 */
export function ArticleTopicFilter(
	{ selected, counts, total }: ArticleTopicFilterProps,
): JSX.Element {
	const none = selected.length === 0;
	return (
		<nav class="artl-topics" aria-labelledby="artl-topics-label">
			<p class="artl-topics__label" id="artl-topics-label">Filter by topic</p>
			<ul class="artl-topics__list" role="list">
				<li>
					<TopicChip
						href={articlesIndexHref()}
						label="All topics"
						count={total}
						current={none}
					/>
				</li>
				{EDITORIAL_ARTICLE_TOPICS.map((topic) => (
					<li key={topic}>
						<TopicChip
							href={toggleTopicHref(selected, topic)}
							label={EDITORIAL_ARTICLE_TOPIC_LABEL[topic]}
							count={counts[topic]}
							current={selected.includes(topic)}
						/>
					</li>
				))}
			</ul>
		</nav>
	);
}

/** One chip: a link whose chosen state is announced (`aria-current`) and drawn (fill + check). */
function TopicChip(
	{ href, label, count, current }: { href: string; label: string; count: number; current: boolean },
): JSX.Element {
	const glyphs = useContext(ArticleGlyphContext);
	return (
		<a class="artl-topic" href={href} aria-current={current ? "true" : undefined}>
			{current
				? glyphs.chosen?.()
				: null}
			<span>{label}</span>
			<span class="artl-topic__count" aria-hidden="true">{count}</span>
			<span class="ui-visually-hidden">
				{`, ${count} ${count === 1 ? "article" : "articles"}`}
			</span>
		</a>
	);
}
