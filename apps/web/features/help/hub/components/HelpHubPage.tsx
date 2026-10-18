import type { JSX } from "preact";
import { CONTENT_AUDIENCE_LABEL, type ContentAudience } from "@projective/types/content";
import type { HelpCentreSearchResult } from "@projective/types/editorial";
import { Icon } from "@projective/ui/icons";
import {
	helpArticlePath,
	helpCategoryPath,
	type HelpCentreLibrary,
} from "@server/services/editorial/help-library.ts";
import HelpSearch from "../../islands/HelpSearch.island.tsx";
import { HelpStillStuck } from "../../components/HelpStillStuck.tsx";
import { HELP_HUB_TITLE } from "../../core/help-seo.ts";
import { faqSuggestions } from "../../core/help-view.ts";

/** The roles the hub's "Start here" columns are written for, in the product's order (ruling (c)). */
const ROLES: readonly ContentAudience[] = ["client", "freelancer", "team", "business"];

/** Props for {@link HelpHubPage}. */
export interface HelpHubPageProps {
	library: HelpCentreLibrary;
	/** The `?q=` the hub was requested with. */
	query?: string;
	/** The server's results for it — the search's no-JavaScript road. */
	results?: HelpCentreSearchResult[];
	signedIn: boolean;
}

/**
 * HelpHubPage — `/help` (P2 §2): the display title and the omnibar, "Start here by role" as four text
 * lists, the eight topics as link rows with their article counts, the eight most-asked questions as
 * native disclosures whose answers link to the full article, and the "Still stuck?" band. Fully
 * server-rendered; only the search is an island.
 */
export function HelpHubPage(props: HelpHubPageProps): JSX.Element {
	const { library, query, results, signedIn } = props;
	const faq = library.faq();
	const roles = ROLES.map((role) => ({ role, articles: library.startHere(role).slice(0, 6) }))
		.filter((column) => column.articles.length > 0);

	return (
		<div class="hc hc--hub">
			<header class="hc-hub__head">
				<p class="hc-eyebrow">{HELP_HUB_TITLE}</p>
				<h1 class="hc-title">How can we help?</h1>
				<p class="hc-lead">
					Answers about projects, payments and payouts, written from how Projective actually works.
				</p>
				<HelpSearch
					variant="hero"
					initialQuery={query}
					initialResults={results}
					suggestions={faqSuggestions(library)}
				/>
			</header>

			{roles.length > 0 && (
				<section class="hc-section" aria-labelledby="hc-roles-title">
					<h2 id="hc-roles-title" class="hc-section__title">Start here by role</h2>
					<ul class="hc-roles">
						{roles.map(({ role, articles }) => (
							<li key={role}>
								<h3 id={`hc-role-${role}`} class="hc-roles__label">
									{CONTENT_AUDIENCE_LABEL[role]}
								</h3>
								<ul class="hc-roles__list" aria-labelledby={`hc-role-${role}`}>
									{articles.map((article) => (
										<li key={article.slug}>
											<a class="hc-link" href={helpArticlePath(article)}>{article.title}</a>
										</li>
									))}
								</ul>
							</li>
						))}
					</ul>
				</section>
			)}

			<section class="hc-section" aria-labelledby="hc-topics-title">
				<h2 id="hc-topics-title" class="hc-section__title">Topics</h2>
				<ul class="hc-topics">
					{library.topics.map(({ category, articles }) => (
						<li key={category.slug} class="hc-topics__item">
							<a class="hc-topic" href={helpCategoryPath(category.slug)}>
								<span class="hc-topic__icon" aria-hidden="true">
									<Icon name={category.icon} />
								</span>
								<span class="hc-topic__title">{category.title}</span>
								<span class="hc-topic__desc">{category.description}</span>
								<span class="hc-topic__count">
									{articles.length} {articles.length === 1 ? "article" : "articles"}
								</span>
							</a>
						</li>
					))}
				</ul>
			</section>

			{faq.length > 0 && (
				<section class="hc-section" aria-labelledby="hc-faq-title">
					<h2 id="hc-faq-title" class="hc-section__title">Frequently asked questions</h2>
					<ul class="hc-faq">
						{faq.map((article) => (
							<li key={article.slug} class="hc-faq__item">
								<details class="hc-faq__details">
									<summary class="hc-faq__question">
										<span>{article.faq!.question}</span>
										<span class="hc-faq__chevron" aria-hidden="true">
											<Icon name="chevron-down" />
										</span>
									</summary>
									<div class="hc-faq__answer">
										<p>{article.summary}</p>
										<a class="hc-link hc-faq__more" href={helpArticlePath(article)}>
											Read the full article: {article.title}
										</a>
									</div>
								</details>
							</li>
						))}
					</ul>
				</section>
			)}

			<HelpStillStuck signedIn={signedIn} />
		</div>
	);
}
