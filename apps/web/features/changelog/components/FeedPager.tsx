import type { JSX } from "preact";
import type { ChangelogCategory } from "@projective/types/editorial";
import { feedHref } from "../core/changelog-url.ts";

/** Props for {@link FeedPager}. */
export interface FeedPagerProps {
	page: number;
	pageCount: number;
	/** The current filter, kept on both links. */
	categories: readonly ChangelogCategory[];
}

/**
 * FeedPager — "Newer releases" and "Older releases" as plain links (never infinite scroll), with the
 * page position between them. A link renders only when its page exists (gate 11), and nothing
 * renders for a single page. Neutral outlined links (§B.8.1 tier 4: utility navigation), with
 * `rel="prev"` / `rel="next"`. Server-rendered and stylesheet-free.
 */
export function FeedPager({ page, pageCount, categories }: FeedPagerProps): JSX.Element | null {
	if (pageCount <= 1) return null;
	const button = "ui-button ui-button--neutral ui-button--outlined ui-button--size-md";
	return (
		<nav class="chl-pager" aria-label="More releases" data-print="hide">
			{page > 1
				? (
					<a class={`${button} chl-pager__newer`} href={feedHref(categories, page - 1)} rel="prev">
						<span class="ui-button__label">Newer releases</span>
					</a>
				)
				: null}
			<p class="chl-pager__position">
				Page {page} of {pageCount}
			</p>
			{page < pageCount
				? (
					<a class={`${button} chl-pager__older`} href={feedHref(categories, page + 1)} rel="next">
						<span class="ui-button__label">Older releases</span>
					</a>
				)
				: null}
		</nav>
	);
}
