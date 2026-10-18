import type { JSX } from "preact";
import { readingMinutes } from "@projective/types/content/text";
import { Breadcrumb } from "@projective/ui/navigation";
import {
	HELP_ROOT,
	helpArticlePath,
	type HelpCentreTopic,
} from "@server/services/editorial/help-library.ts";
import HelpSearch from "../../islands/HelpSearch.island.tsx";
import { HelpStillStuck } from "../../components/HelpStillStuck.tsx";
import { HELP_HUB_TITLE } from "../../core/help-seo.ts";

/** Props for {@link HelpCategoryPage}. */
export interface HelpCategoryPageProps {
	topic: HelpCentreTopic;
	/** The `?q=` the page was requested with (opens the search overlay). */
	query?: string;
	signedIn: boolean;
}

/**
 * HelpCategoryPage — `/help/<category>` (P2 §2): the trail back to the hub, the category's title
 * and description, and its articles in reading order — each a heading link, its summary and its read
 * time in the meta register — then the "Still stuck?" band. A list, not a grid of cards.
 */
export function HelpCategoryPage(props: HelpCategoryPageProps): JSX.Element {
	const { topic, query, signedIn } = props;
	const { category, articles } = topic;
	return (
		<div class="hc hc--category">
			<div class="hc-bar hc-bar--flush">
				<div class="hc-bar__trail">
					<Breadcrumb
						model={[{ label: HELP_HUB_TITLE, url: HELP_ROOT }, { label: category.title }]}
					/>
				</div>
				<div class="hc-bar__search">
					<HelpSearch variant="compact" initialQuery={query} />
				</div>
			</div>

			<header class="hc-category__head">
				<h1 class="hc-title">{category.title}</h1>
				<p class="hc-lead">{category.description}</p>
			</header>

			<ol class="hc-articles" aria-label={`${category.title} articles`}>
				{articles.map((article) => {
					const minutes = readingMinutes(article);
					return (
						<li key={article.slug} class="hc-articles__item">
							<h2 class="hc-articles__title">
								<a class="hc-link" href={helpArticlePath(article)}>{article.title}</a>
							</h2>
							<p class="hc-articles__summary">{article.summary}</p>
							<p class="hc-articles__meta">{minutes} min read</p>
						</li>
					);
				})}
			</ol>

			<HelpStillStuck signedIn={signedIn} />
		</div>
	);
}
