import type { JSX } from "preact";
import type { ArticleCta as ArticleCtaModel } from "../core/article-cta.ts";

/** Props for {@link ArticleCta}. */
export interface ArticleCtaProps {
	cta: ArticleCtaModel;
}

/**
 * ArticleCta — the article's one call to action, set inside the reading after ~60% of the body: a
 * line, a sentence and the region's only filled button — tier 3 brand primary (DESIGN_SYSTEM §B.8.1),
 * since joining or creating a project is a workflow step, not a payment. An `<aside>` named by its
 * line, so it is skippable and never mistaken for the article's own words; its line is not a heading,
 * so it stays out of the article's outline and table of contents.
 */
export function ArticleCta({ cta }: ArticleCtaProps): JSX.Element {
	return (
		<aside class="artl-cta" aria-labelledby="artl-cta-title">
			<p class="artl-cta__title" id="artl-cta-title">{cta.title}</p>
			<p class="artl-cta__body">{cta.body}</p>
			<a
				class="ui-button ui-button--primary ui-button--filled ui-button--size-md artl-cta__action"
				href={cta.href}
			>
				<span class="ui-button__label">{cta.label}</span>
			</a>
		</aside>
	);
}
