import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "@web/features/shell/styles/user-shell.css";
import SearchSuggest from "@features/explore/islands/SearchSuggest.island.tsx";
import { ScopeSelect } from "@features/explore/components/ScopeSelect.tsx";
import { recordSearch } from "@features/explore/core/search-history.ts";
import { isFocusHeaderSearchShortcut } from "@web/features/shell/core/shortcuts.ts";
import { useSearchShortcut } from "@web/features/shell/hooks/useSearchShortcut.ts";
import { Icon } from "@projective/ui/icons";
import { DEFAULT_SEARCH_SCOPE, type SearchScope } from "@features/marketing/core/landing-data.ts";

/**
 * NavSearchBar — the unified header's integrated discovery search (DESIGN_SYSTEM.md Part D.1, "Left
 * Block"). The guest header's pill (Decisions #347 and #348) set wider, lower and centred in the
 * signed-in shell: a faint tint and one hairline at rest, a decorative glyph, the static "Search
 * Projective…" placeholder and the shared ghost `ScopeSelect` at its end; focused or holding a query
 * it widens and lifts onto the solid surface. The field is the shared `SearchSuggest` typeahead over
 * the picked scope, focused from anywhere by Ctrl+/ (Cmd+/ on macOS); Enter is a real navigation to
 * `/explore?q=` (+ `&category=` off "All"), so the server renders the results layout. Dumb island —
 * routes only, no data access.
 */
export default function NavSearchBar() {
	const query = useSignal("");
	const scope = useSignal<SearchScope>(DEFAULT_SEARCH_SCOPE);
	const formRef = useRef<HTMLFormElement>(null);

	useSearchShortcut({ scopeRef: formRef, matches: isFocusHeaderSearchShortcut, fromFields: true });

	/** Navigate to `/explore` with the query and scope (neither lands on the feed). */
	function go(q: string) {
		if (q) recordSearch(q);
		const params = new URLSearchParams();
		if (q) params.set("q", q);
		if (scope.value !== DEFAULT_SEARCH_SCOPE) params.set("category", scope.value);
		const search = params.toString();
		globalThis.location.href = search ? `/explore?${search}` : "/explore";
	}

	return (
		<form
			ref={formRef}
			class="shell-search"
			role="search"
			onSubmit={(e) => {
				e.preventDefault();
				go(query.value.trim());
			}}
		>
			<Icon name="search" size="sm" class="shell-search__icon" />
			<SearchSuggest
				value={query}
				scope={scope.value}
				name="q"
				inputClass="shell-search__search-input"
				anchorRef={formRef}
				placeholder="Search Projective…"
				aria-label="Search Projective"
				onSearch={go}
			/>
			<ScopeSelect
				class="shell-search__scope"
				value={scope.value}
				onPick={(next) => (scope.value = next)}
			/>
		</form>
	);
}
