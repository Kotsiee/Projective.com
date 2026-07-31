import type { JSX } from "preact";
import type { HelpArticle } from "../../types/explore-types.ts";
import { Icon } from "@projective/ui/icons";

/**
 * HelpArticlesStrip — a reserved informative section pointing to help/support articles. Non-interactive
 * grouping (a titled panel of links), so separation is a tonal surface + a single hairline heading rule,
 * not a four-sided border (separation hierarchy). Each row is an anchor.
 */
export function HelpArticlesStrip({ articles }: { articles: HelpArticle[] }): JSX.Element {
	return (
		<section class="ex-help" aria-labelledby="ex-help-title">
			<div class="ex-help__head">
				<h3 class="ex-help__title" id="ex-help-title">New here? Start with these</h3>
				<a class="ex-viewall" href="/help">All help articles →</a>
			</div>
			<ul class="ex-help__list" role="list">
				{articles.map((a) => (
					<li key={a.id}>
						<a class="ex-help__link" href={a.href}>
							<span class="ex-help__glyph" aria-hidden="true">
								<Icon name="help" />
							</span>
							<span class="ex-help__text">{a.title}</span>
							<span class="ex-help__meta">{a.minutes} min</span>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}
