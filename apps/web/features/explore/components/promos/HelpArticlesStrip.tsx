import type { JSX } from "preact";
import type { HelpArticle } from "../../types/explore-types.ts";

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
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
									<circle cx="12" cy="12" r="9" />
									<path
										d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .8-1 1.7"
										stroke-linecap="round"
									/>
									<circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
								</svg>
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
