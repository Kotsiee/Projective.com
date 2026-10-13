import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { useDismiss, useEdgeDetection, useOverlayStack } from "@projective/ui/hooks";
import { BodyPortal } from "@projective/ui/overlay";
import {
	DEFAULT_SEARCH_SCOPE,
	SEARCH_SCOPES,
	type SearchScope,
	searchScopeLabel,
} from "@features/marketing/core/landing-data.ts";
import { isFocusSearchShortcut } from "@features/shell/core/shortcuts.ts";
import { useSearchShortcut } from "@features/shell/hooks/useSearchShortcut.ts";
import SearchSuggest from "../islands/SearchSuggest.island.tsx";
import type { ExploreCategory } from "../types/explore-types.ts";

/** The scope the results page is currently in, or the neutral default when it names no scope. */
function scopeOf(category: ExploreCategory): SearchScope {
	return SEARCH_SCOPES.find((s) => s.value === category)?.value ?? DEFAULT_SEARCH_SCOPE;
}

/**
 * ResultsHeader — the Dribbble-style header for the Search Results page: the active query rendered
 * large in a thin display weight, a search bar in the SAME shape as the site header's
 * (`site-header__search`: a fused scope selector → the field → a submit glyph, plus a clear control
 * once something is typed), and a minimal row of clickable "Related" search tags. The scope
 * vocabulary is the shared `SEARCH_SCOPES`, so the two bars offer the same choices and the results
 * page can re-scope in place. The field is the shared `SearchSuggest` typeahead; `/` focuses it from
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
	const menuOpen = useSignal(false);
	const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
	const formRef = useRef<HTMLFormElement>(null);

	useSearchShortcut({ scopeRef: formRef, matches: isFocusSearchShortcut });

	useEffect(() => {
		draft.value = query;
	}, [query]);
	useEffect(() => {
		scope.value = scopeOf(category);
	}, [category]);

	// Outside press and Escape through the shared overlay stack, which also sets its z-index.
	const stack = useOverlayStack({ active: menuOpen.value });
	// Portalled and anchored, so no sticky or glass ancestor can clip the list or re-base it (§B.10.4).
	const menu = useEdgeDetection<HTMLButtonElement, HTMLUListElement>({
		open: menuOpen.value,
		offset: 8,
		zIndex: stack.zIndex,
	});
	useDismiss({
		open: menuOpen.value,
		enabled: stack.isTop,
		onDismiss: () => (menuOpen.value = false),
		panelRef: menu.ref,
		triggerRef: menu.triggerRef,
	});

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
		menuOpen.value = false;
		if (value !== scopeOf(category)) onSearch(draft.value.trim(), value);
	};
	const focusOption = (index: number) => {
		const n = SEARCH_SCOPES.length;
		optionRefs.current[((index % n) + n) % n]?.focus();
	};
	const onOptionKey =
		(index: number, value: SearchScope) => (e: JSX.TargetedKeyboardEvent<HTMLLIElement>) => {
			switch (e.key) {
				case "Enter":
				case " ":
					e.preventDefault();
					pick(value);
					break;
				case "ArrowDown":
					e.preventDefault();
					focusOption(index + 1);
					break;
				case "ArrowUp":
					e.preventDefault();
					focusOption(index - 1);
					break;
				case "Home":
					e.preventDefault();
					focusOption(0);
					break;
				case "End":
					e.preventDefault();
					focusOption(SEARCH_SCOPES.length - 1);
					break;
			}
		};

	return (
		<header class="ex-results-head">
			<h1 class="ex-results-head__q">{title}</h1>
			<form ref={formRef} class="ex-results-head__search" role="search" onSubmit={submit}>
				<div class="ex-results-head__entity">
					<button
						ref={menu.triggerRef}
						type="button"
						class="ex-results-head__entity-btn"
						aria-haspopup="listbox"
						aria-expanded={menuOpen.value}
						aria-label={`Search scope: ${searchScopeLabel(scope.value)}`}
						onClick={() => (menuOpen.value = !menuOpen.value)}
						onKeyDown={(e) => {
							if (e.key === "ArrowDown") {
								e.preventDefault();
								menuOpen.value = true;
								requestAnimationFrame(() => focusOption(0));
							}
						}}
					>
						{searchScopeLabel(scope.value)}
						<Icon name="chevron-down" size="2xs" class="ex-results-head__entity-caret" />
					</button>
					{menuOpen.value && (
						<BodyPortal>
							<ul
								ref={menu.ref}
								class="ui-anchored ex-results-head__entity-menu"
								role="listbox"
								aria-label="Search scope"
								style={menu.style}
							>
								{SEARCH_SCOPES.map((opt, i) => (
									<li
										key={opt.value}
										ref={(el) => {
											optionRefs.current[i] = el;
										}}
										role="option"
										aria-selected={scope.value === opt.value}
										class="ex-results-head__entity-option"
										tabIndex={0}
										onClick={() => pick(opt.value)}
										onKeyDown={onOptionKey(i, opt.value)}
									>
										{opt.label}
									</li>
								))}
							</ul>
						</BodyPortal>
					)}
				</div>
				<SearchSuggest
					value={draft}
					scope={scope.value}
					name="q"
					inputClass="ex-results-head__input"
					anchorRef={formRef}
					placeholder="Refine this search…"
					aria-label="Search within results"
					onSearch={(term) => onSearch(term, scope.value)}
				/>
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
				<button type="submit" class="ex-results-head__go" aria-label="Search">
					<Icon name="search" size="sm" />
				</button>
			</form>
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
