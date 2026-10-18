import type { JSX } from "preact";
import type { EditorialArticleTopic } from "@projective/types/editorial";
import { articlesIndexHref } from "../core/index-query.ts";

/** Props for {@link ArticlePagination}. */
export interface ArticlePaginationProps {
	page: number;
	pageCount: number;
	/** The filter the pages belong to — each link keeps it. */
	topics: readonly EditorialArticleTopic[];
}

/** The tier-4 utility class set a pager link wears (DESIGN_SYSTEM §B.8.1: neutral outlined). */
const PAGER_LINK = "ui-button ui-button--neutral ui-button--outlined ui-button--size-md";

/**
 * ArticlePagination — Previous · "Page n of m" · Next, as real links (`rel="prev"` / `rel="next"`)
 * that keep the topic filter. Nothing renders on a single page, and a link that would lead nowhere
 * (Previous on page 1) is left out rather than drawn disabled — a control that renders must act.
 */
export function ArticlePagination(
	{ page, pageCount, topics }: ArticlePaginationProps,
): JSX.Element | null {
	if (pageCount <= 1) return null;
	return (
		<nav class="artl-pager" aria-label="Pages of articles">
			<div class="artl-pager__slot">
				{page > 1
					? (
						<a
							class={PAGER_LINK}
							rel="prev"
							href={articlesIndexHref({ topics: [...topics], page: page - 1 })}
						>
							<span class="ui-button__label">
								<span aria-hidden="true">←</span> Previous
							</span>
						</a>
					)
					: null}
			</div>
			<p class="artl-pager__status">Page {page} of {pageCount}</p>
			<div class="artl-pager__slot artl-pager__slot--next">
				{page < pageCount
					? (
						<a
							class={PAGER_LINK}
							rel="next"
							href={articlesIndexHref({ topics: [...topics], page: page + 1 })}
						>
							<span class="ui-button__label">
								Next <span aria-hidden="true">→</span>
							</span>
						</a>
					)
					: null}
			</div>
		</nav>
	);
}
