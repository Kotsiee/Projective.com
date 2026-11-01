import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "@web/features/shell/styles/user-shell.css";
import SearchSuggest from "@features/explore/islands/SearchSuggest.island.tsx";
import { recordSearch } from "@features/explore/core/search-history.ts";
import {
	headerSearchShortcutLabel,
	isFocusHeaderSearchShortcut,
} from "@web/features/shell/core/shortcuts.ts";
import { useSearchShortcut } from "@web/features/shell/hooks/useSearchShortcut.ts";
import { Icon } from "@projective/ui/icons";
import { Kbd } from "@ui/utils/components/Kbd.tsx";
import { DEFAULT_SEARCH_SCOPE } from "@features/marketing/core/landing-data.ts";

/**
 * NavSearchBar — the unified header's integrated discovery search (DESIGN_SYSTEM.md Part D.1, "Left
 * Block"). It is the guest header's pill search in the signed-in shell (Decisions #347 and #348,
 * which carry #47's parity over): a faint tint and one hairline at rest, a decorative glyph, the
 * static "Search Projective…" placeholder and the shortcut hint at its end; focused or holding a
 * query it widens and lifts onto the solid surface. The field is the shared `SearchSuggest`
 * typeahead over every category, focused from anywhere by Ctrl+/ (Cmd+/ on macOS); Enter is a real
 * navigation to `/explore?q=`, so the server renders the results layout. Dumb island — routes only,
 * no data access.
 */
export default function NavSearchBar() {
	const query = useSignal("");
	const shortcutLabel = useSignal(headerSearchShortcutLabel(""));
	const formRef = useRef<HTMLFormElement>(null);

	useSearchShortcut({ scopeRef: formRef, matches: isFocusHeaderSearchShortcut, fromFields: true });

	// The server renders "Ctrl /"; the user agent names the platform once hydrated.
	useEffect(() => {
		shortcutLabel.value = headerSearchShortcutLabel(globalThis.navigator.userAgent);
	}, []);

	/** Navigate to `/explore` with the query (an empty one lands on the feed). */
	function go(q: string) {
		if (q) recordSearch(q);
		globalThis.location.href = q ? `/explore?q=${encodeURIComponent(q)}` : "/explore";
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
				scope={DEFAULT_SEARCH_SCOPE}
				name="q"
				inputClass="shell-search__search-input"
				anchorRef={formRef}
				placeholder="Search Projective…"
				aria-label="Search Projective"
				onSearch={go}
			/>
			<span class="shell-search__hint" aria-hidden="true">
				<Kbd size="sm">{shortcutLabel.value}</Kbd>
			</span>
		</form>
	);
}
