import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "@web/features/shell/styles/user-shell.css";
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
 * re-renders the correct results layout. Dumb island — routes only, no data access.
 */

/** The guest header's filled magnifier path — reused verbatim so the submit glyph matches 1:1. */
const SEARCH_ICON =
	"M8.5 3a5.5 5.5 0 1 0 3.4 9.8l3.6 3.7 1.4-1.4-3.7-3.6A5.5 5.5 0 0 0 8.5 3Zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z";

/** Coerce an arbitrary category token to one of the selector scopes (unknown → neutral `all`). */
function toScope(raw: string): SearchScope {
	return SEARCH_SCOPES.find((s) => s.value === raw)?.value ?? DEFAULT_SEARCH_SCOPE;
}

export default function NavSearchBar() {
	const category = useSignal<SearchScope>(DEFAULT_SEARCH_SCOPE);
	const menuOpen = useSignal(false);
	const query = useSignal("");
	const menuRef = useRef<HTMLDivElement>(null);

	// Reflect the active /explore search when the shell renders over the results page.
	useEffect(() => {
		if (globalThis.location?.pathname !== "/explore") return;
		const sp = new URLSearchParams(globalThis.location.search);
		query.value = sp.get("q") ?? "";
		category.value = toScope((sp.get("category") ?? sp.get("type") ?? "").toLowerCase());
	}, []);

	// Close the scope menu on outside click.
	useEffect(() => {
		const onDoc = (e: MouseEvent) => {
			if (menuOpen.value && menuRef.current && !menuRef.current.contains(e.target as Node)) {
				menuOpen.value = false;
			}
		};
		document.addEventListener("click", onDoc);
		return () => document.removeEventListener("click", onDoc);
	}, []);

	/** Navigate to `/explore` with the active scope + query (omitting the neutral `all` + empty query). */
	function go(q: string) {
		const params = new URLSearchParams();
		if (category.value !== "all") params.set("category", category.value);
		if (q) params.set("q", q);
		const qs = params.toString();
		globalThis.location.href = qs ? `/explore?${qs}` : "/explore";
	}

	return (
		<form
			class="shell-search"
			role="search"
			onSubmit={(e) => {
				e.preventDefault();
				go(query.value.trim());
			}}
		>
			<div class="shell-search__entity" ref={menuRef}>
				<button
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
					<ul class="shell-search__entity-menu" role="listbox" aria-label="Search scope">
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
				)}
			</div>

			<input
				class="shell-search__search-input"
				type="search"
				name="q"
				value={query.value}
				placeholder="Search Projective…"
				aria-label={`Search ${searchScopeLabel(category.value).toLowerCase()}`}
				autoComplete="off"
				onInput={(e) => (query.value = (e.currentTarget as HTMLInputElement).value)}
			/>

			<button type="submit" class="shell-search__search-go" aria-label="Search">
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path d={SEARCH_ICON} fill="currentColor" />
				</svg>
			</button>
		</form>
	);
}
