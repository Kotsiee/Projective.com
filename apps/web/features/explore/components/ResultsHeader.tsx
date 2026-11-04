import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { Button } from "@projective/ui/fields";
import "@features/marketing/styles/hero-search.css";
import {
	DEFAULT_SEARCH_SCOPE,
	SEARCH_SCOPES,
	type SearchScope,
} from "@features/marketing/core/landing-data.ts";
import { isFocusSearchShortcut } from "@features/shell/core/shortcuts.ts";
import { useSearchShortcut } from "@features/shell/hooks/useSearchShortcut.ts";
import HeroWeave from "../islands/HeroWeave.island.tsx";
import SearchSuggest from "../islands/SearchSuggest.island.tsx";
import { ScopeSelect } from "./ScopeSelect.tsx";
import type { ExploreCategory } from "../types/explore-types.ts";

/** The scope the results page is currently in, or the neutral default when it names no scope. */
function scopeOf(category: ExploreCategory): SearchScope {
	return SEARCH_SCOPES.find((s) => s.value === category)?.value ?? DEFAULT_SEARCH_SCOPE;
}

/**
 * ResultsHeader — the Search Results page's header, a quieter sibling of the Home hero (Decision #357):
 * on the page canvas with no band and no bottom rule, over the same strapwork stencil (`HeroWeave`,
 * under the same two-pool mask) but without the glow, the active query rendered large in a thin
 * display weight, the SAME search bar as the hero's `SearchBar` — its `hero-search--hero` markup and
 * styles (Decision #358): a
 * fused scope selector → the field → a submit glyph, plus a clear control once something is typed;
 * the headers' bars are scope-less ghosts since Decision #347), and a row of "Related" searches as
 * the house `text` `Button` — muted ink, `--on-surface` (white) on hover in dark mode, `--primary`
 * on hover in light. The scope vocabulary is the shared `SEARCH_SCOPES`, so the two in-page bars
 * offer the same choices and the results page can re-scope in place. The field is the shared `SearchSuggest` typeahead; `/` focuses it from
 * anywhere on the page outside a field. Presentational —
 * the parent island owns the query state; `onSearch` re-runs the search with a term + scope (Enter,
 * a suggestion, a scope pick, or the clear control), and `onRelated` re-runs it for a tag.
 */
export function ResultsHeader(
	{ title, query, category, related, onSearch, onRelated }: {
		title: string;
		/** The committed free-text query — seeds the field and re-syncs it after back/forward. */
		query: string;
		/** The committed category — seeds the scope selector and re-syncs it after back/forward. */
		category: ExploreCategory;
		related: string[];
		onSearch: (query: string, category: ExploreCategory) => void;
		onRelated: (term: string) => void;
	},
): JSX.Element {
	const draft = useSignal(query);
	const scope = useSignal<SearchScope>(scopeOf(category));
	const formRef = useRef<HTMLFormElement>(null);

	useSearchShortcut({
		scopeRef: formRef,
		matches: isFocusSearchShortcut,
		shortcut: "focus-search",
	});

	useEffect(() => {
		draft.value = query;
	}, [query]);
	useEffect(() => {
		scope.value = scopeOf(category);
	}, [category]);

	const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
		e.preventDefault();
		const next = draft.value.trim();
		if (next !== query || scope.value !== scopeOf(category)) onSearch(next, scope.value);
	};
	const clear = () => {
		draft.value = "";
		if (query) onSearch("", scope.value);
	};
	const pick = (value: SearchScope) => {
		scope.value = value;
		if (value !== scopeOf(category)) onSearch(draft.value.trim(), value);
	};

	return (
		<header class="ex-results-head">
			<div class="ex-results-head__stencil" aria-hidden="true">
				<HeroWeave />
			</div>
			<h1 class="ex-results-head__q">{title}</h1>
			<div class="hero-search hero-search--hero ex-results-head__search">
				<form ref={formRef} class="hero-search__bar" role="search" onSubmit={submit}>
					<ScopeSelect class="hero-search__entity" value={scope.value} onPick={pick} />
					<div class="hero-search__field">
						<SearchSuggest
							value={draft}
							scope={scope.value}
							name="q"
							inputClass="hero-search__input"
							anchorRef={formRef}
							placeholder="Refine this search…"
							aria-label="Search within results"
							onSearch={(term) => onSearch(term, scope.value)}
						/>
					</div>
					{draft.value.length > 0 && (
						<button
							type="button"
							class="ex-results-head__clear"
							aria-label="Clear search"
							onClick={clear}
						>
							<Icon name="close" size="xs" />
						</button>
					)}
					<button type="submit" class="hero-search__submit" aria-label="Search">
						<Icon name="search" size="sm" />
					</button>
				</form>
			</div>
			{related.length > 0 && (
				<div class="ex-results-head__related">
					<span class="ex-results-head__related-label">Related</span>
					<div class="ex-results-head__tags">
						{related.map((term) => (
							<Button
								key={term}
								variant="text"
								size="sm"
								rounded
								class="ex-results-head__tag"
								label={term}
								onClick={() => onRelated(term)}
							/>
						))}
					</div>
				</div>
			)}
		</header>
	);
}
