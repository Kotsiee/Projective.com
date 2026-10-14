import type { JSX } from "preact";
import { type SerpInput, serpSnippet } from "../../types/catalogue-types.ts";

/**
 * SerpPreview — how the listing reads as a search result: title, address and description from
 * {@link serpSnippet}, each cut on a word boundary where a search engine would cut it. Pure
 * display; a `figure` so it is announced as a preview, not as a result the seller could follow.
 */
export function SerpPreview(props: { input: SerpInput }): JSX.Element {
	const snippet = serpSnippet(props.input);
	return (
		<figure class="cat-seo__serp">
			<figcaption class="cat-seo__serp-caption">Search result preview</figcaption>
			<p class="cat-seo__serp-url">{snippet.url}</p>
			<p class="cat-seo__serp-title">{snippet.title}</p>
			<p class="cat-seo__serp-desc">
				{snippet.description || "Add a description so searchers know what they get."}
			</p>
		</figure>
	);
}
