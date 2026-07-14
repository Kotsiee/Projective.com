import type { JSX } from "preact";

/**
 * ResultsHeader — the Dribbble-style header for the Search Results page: the active query rendered
 * large in a thin display weight, with a minimal row of clickable "Related" search tags beneath.
 * Presentational — the parent island owns the query state; `onRelated` re-runs the search for a tag.
 */
export function ResultsHeader(
	{ title, related, onRelated }: {
		title: string;
		related: string[];
		onRelated: (term: string) => void;
	},
): JSX.Element {
	return (
		<header class="ex-results-head">
			<h1 class="ex-results-head__q">{title}</h1>
			{related.length > 0 && (
				<div class="ex-results-head__related">
					<span class="ex-results-head__related-label">Related</span>
					<div class="ex-results-head__tags">
						{related.map((term) => (
							<button
								type="button"
								class="ex-results-head__tag"
								key={term}
								onClick={() => onRelated(term)}
							>
								{term}
							</button>
						))}
					</div>
				</div>
			)}
		</header>
	);
}
