import type { JSX } from "preact";
import { readingMinutes } from "@projective/types/content/text";
import type { HelpCentreArticle, HelpCentreCategory } from "@projective/types/editorial";
import { DocumentDate } from "@projective/ui/display/editorial";
import { Breadcrumb } from "@projective/ui/navigation";
import { DocumentPage } from "@features/marketing/components/DocumentPage.tsx";
import {
	HELP_ROOT,
	helpArticlePath,
	helpCategoryPath,
	type HelpCentreLibrary,
} from "@server/services/editorial/help-library.ts";
import HelpSearch from "../../islands/HelpSearch.island.tsx";
import HelpfulnessPrompt from "../../islands/HelpfulnessPrompt.island.tsx";
import { HELP_HUB_TITLE } from "../../core/help-seo.ts";
import { audienceLine } from "../../core/help-view.ts";
import { FEEDBACK_ANCHOR } from "../../core/feedback-form.ts";

/** The ids this page renders beside the article body, so no generated heading anchor takes one. */
export const HELP_ARTICLE_PAGE_IDS = [FEEDBACK_ANCHOR, "related-articles"] as const;

/** Props for {@link HelpArticlePage}. */
export interface HelpArticlePageProps {
	library: HelpCentreLibrary;
	article: HelpCentreArticle;
	category: HelpCentreCategory;
	/** The `?q=` the page was requested with (opens the search overlay). */
	query?: string;
	/** The outcome of a no-JavaScript "Was this helpful?" post. */
	outcome?: "thanks" | "error";
}

/**
 * HelpArticlePage — `/help/<category>/<article>` (P2 §2): the trail and the compact search above P0's
 * `DocumentPage` (sticky nested table of contents, reading progress), the meta line (updated · read
 * time · who it is for), and after the body: "Was this helpful?", the related articles and the
 * previous and next article in the category. Readable with no JavaScript at all.
 */
export function HelpArticlePage(props: HelpArticlePageProps): JSX.Element {
	const { library, article, category, query, outcome } = props;
	const related = library.related(article);
	const { previous, next } = library.neighbours(article);
	const path = helpArticlePath(article);

	return (
		<div class="hc hc--article">
			<div class="hc-bar">
				<div class="hc-bar__trail">
					<Breadcrumb
						model={[
							{ label: HELP_HUB_TITLE, url: HELP_ROOT },
							{ label: category.title, url: helpCategoryPath(category.slug) },
							{ label: article.title },
						]}
					/>
				</div>
				<div class="hc-bar__search">
					<HelpSearch variant="compact" initialQuery={query} />
				</div>
			</div>

			<DocumentPage
				doc={article}
				meta={[
					<DocumentDate key="updated" prefix="Updated" iso={article.updatedAt} />,
					`${readingMinutes(article)} min read`,
					audienceLine(article.roles),
				]}
				reserved={HELP_ARTICLE_PAGE_IDS}
				after={
					<div class="hc-after">
						<HelpfulnessPrompt slug={article.slug} path={path} outcome={outcome} />

						{related.length > 0 && (
							<section aria-labelledby="related-articles">
								<h2 id="related-articles" class="hc-after__title">Related articles</h2>
								<ul class="hc-related">
									{related.map((r) => (
										<li key={r.slug}>
											<a class="hc-link hc-related__title" href={helpArticlePath(r)}>{r.title}</a>
											<p class="hc-related__summary">{r.summary}</p>
										</li>
									))}
								</ul>
							</section>
						)}

						{(previous || next) && (
							<nav class="hc-pager" aria-label={`More in ${category.title}`}>
								{previous && (
									<a class="hc-pager__link" href={helpArticlePath(previous)} rel="prev">
										<span class="hc-pager__dir">Previous</span>
										<span class="hc-pager__title">{previous.title}</span>
									</a>
								)}
								{next && (
									<a
										class="hc-pager__link hc-pager__link--next"
										href={helpArticlePath(next)}
										rel="next"
									>
										<span class="hc-pager__dir">Next</span>
										<span class="hc-pager__title">{next.title}</span>
									</a>
								)}
							</nav>
						)}
					</div>
				}
			/>
		</div>
	);
}
