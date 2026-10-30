import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "@web/features/shell/styles/user-shell.css";
import SearchSuggest from "@features/explore/islands/SearchSuggest.island.tsx";
import { recordSearch } from "@features/explore/core/search-history.ts";
import { isFocusHeaderSearchShortcut } from "@web/features/shell/core/shortcuts.ts";
import { useSearchShortcut } from "@web/features/shell/hooks/useSearchShortcut.ts";
import { useDismiss, useEdgeDetection, useOverlayStack } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import { BodyPortal } from "@projective/ui/overlay";
import {
	DEFAULT_SEARCH_SCOPE,
	SEARCH_SCOPES,
	type SearchScope,
	searchScopeLabel,
} from "@features/marketing/core/landing-data.ts";

/**
 * NavSearchBar — the unified header's integrated discovery search (DESIGN_SYSTEM.md Part D.1, "Left
 * Block"). Its markup, layout, icon, placeholder, and styling **mirror the guest `site-header__search`
 * bar 1:1** (root CLAUDE.md Decision #47): a fused entity/scope selector + a field with the static
 * "Search Projective…" placeholder + a filled magnifier submit — the two bars are visually identical
 * so the authenticated shell's discovery search reads exactly as the guest's. The scope vocabulary is
 * shared via `landing-data`, so selector + `/explore?category=` navigation stay in lockstep with the
 * guest header; submitting or picking a scope is a real navigation to `/explore`, so the server
 * re-renders the correct results layout. The field is the shared `SearchSuggest` typeahead, focused
 * from anywhere by Ctrl+/ (Cmd+/ on macOS). Dumb island — routes only, no data access.
 */

/** Coerce an arbitrary category token to one of the selector scopes (unknown → neutral `all`). */
function toScope(raw: string): SearchScope {
	return SEARCH_SCOPES.find((s) => s.value === raw)?.value ?? DEFAULT_SEARCH_SCOPE;
}

export default function NavSearchBar() {
	const category = useSignal<SearchScope>(DEFAULT_SEARCH_SCOPE);
	const menuOpen = useSignal(false);
	const query = useSignal("");
	const formRef = useRef<HTMLFormElement>(null);

	useSearchShortcut({ scopeRef: formRef, matches: isFocusHeaderSearchShortcut, fromFields: true });

	// Reflect the active /explore search when the shell renders over the results page.
	useEffect(() => {
		if (globalThis.location?.pathname !== "/explore") return;
		const sp = new URLSearchParams(globalThis.location.search);
		query.value = sp.get("q") ?? "";
		category.value = toScope((sp.get("category") ?? sp.get("type") ?? "").toLowerCase());
	}, []);

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

	/** Navigate to `/explore` with the active scope + query (omitting the neutral `all` + empty query). */
	function go(q: string) {
		const params = new URLSearchParams();
		if (category.value !== "all") params.set("category", category.value);
		if (q) {
			params.set("q", q);
			recordSearch(q);
		}
		const qs = params.toString();
		globalThis.location.href = qs ? `/explore?${qs}` : "/explore";
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
			<div class="shell-search__entity">
				<button
					ref={menu.triggerRef}
					type="button"
					class="shell-search__entity-btn"
					aria-haspopup="listbox"
					aria-expanded={menuOpen.value}
					onClick={() => (menuOpen.value = !menuOpen.value)}
				>
					{searchScopeLabel(category.value)}
					<span class="shell-search__chevron" aria-hidden="true" />
				</button>
				{menuOpen.value && (
					<BodyPortal>
						<ul
							ref={menu.ref}
							class="ui-anchored shell-search__entity-menu"
							role="listbox"
							aria-label="Search scope"
							style={menu.style}
						>
							{SEARCH_SCOPES.map((opt) => (
								<li
									key={opt.value}
									role="option"
									aria-selected={category.value === opt.value}
									class="shell-search__entity-option"
									tabIndex={0}
									onClick={() => {
										category.value = opt.value;
										menuOpen.value = false;
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											category.value = opt.value;
											menuOpen.value = false;
										}
									}}
								>
									{opt.label}
								</li>
							))}
						</ul>
					</BodyPortal>
				)}
			</div>

			<button type="submit" class="shell-search__search-go" aria-label="Search">
				<Icon name="search" size="sm" />
			</button>

			<SearchSuggest
				value={query}
				scope={category.value}
				name="q"
				inputClass="shell-search__search-input"
				anchorRef={formRef}
				placeholder="Search Projective…"
				aria-label={`Search ${searchScopeLabel(category.value).toLowerCase()}`}
				onSearch={go}
			/>
		</form>
	);
}
