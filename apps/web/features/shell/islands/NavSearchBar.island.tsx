import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "@web/features/shell/styles/user-shell.css";
import {
	DEFAULT_SEARCH_SCOPE,
	SEARCH_SCOPES,
	type SearchScope,
	searchScopeLabel,
} from "@features/marketing/core/landing-data.ts";
import { NavIcon } from "@web/features/shell/core/nav-icons.tsx";

/**
 * NavSearchBar — the unified header's integrated discovery search (DESIGN_SYSTEM.md Part D.1, "Left
 * Block"). The same modular pattern the guest header uses — a fused **entity/scope selector** + a
 * large field whose placeholder **types itself out** phrase-by-phrase with a blinking caret, cycling
 * every few seconds per scope — packaged as a compact, hydrating island so the authenticated shell
 * gets the identical component (scope vocabulary shared via `landing-data`, so selector + placeholder
 * + `/explore?category=` navigation stay in lockstep). Submitting or picking a scope is a real
 * navigation to `/explore`, so the server re-renders the correct results layout. Reduced motion shows
 * a static placeholder. Dumb island — routes only, no data access.
 */

// #region Typewriter phrases
/** Placeholder phrases per scope — keyed by the shared {@link SearchScope} vocabulary. */
const PHRASES: Record<SearchScope, string[]> = {
	all: ["anything you need", "a helper or a team", "your next big idea", "ready-made goodies"],
	freelancers: ["a motion designer", "a Deno engineer", "a 3D artist", "a product design lead"],
	users: ["a creative director", "a founder to back", "an advisor", "someone to collaborate with"],
	projects: ["a fintech MVP build", "a mobile app redesign", "a commerce migration", "a dashboard"],
	services: ["a brand identity sprint", "a 5-day landing page", "a design system", "a launch film"],
	products: ["an Aurora UI kit", "Lightroom presets", "dashboard blocks", "a 640-icon set"],
	articles: ["growing a small team", "keeping payments safe", "paying step by step", "hiring a team"],
};
// #endregion

/** Coerce an arbitrary category token to one of the selector scopes (unknown → neutral `all`). */
function toScope(raw: string): SearchScope {
	return SEARCH_SCOPES.find((s) => s.value === raw)?.value ?? DEFAULT_SEARCH_SCOPE;
}

export default function NavSearchBar() {
	const category = useSignal<SearchScope>(DEFAULT_SEARCH_SCOPE);
	const menuOpen = useSignal(false);
	const query = useSignal("");
	const typed = useSignal("");
	const menuRef = useRef<HTMLDivElement>(null);

	// #region Typewriter placeholder — retype/erase the active scope's phrases; restart when it flips.
	useEffect(() => {
		const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		const phrases = PHRASES[category.value];
		if (reduce) {
			typed.value = phrases[0];
			return;
		}
		let i = 0;
		let ch = 0;
		let deleting = false;
		let timer = 0;
		const loop = () => {
			const word = phrases[i % phrases.length];
			ch += deleting ? -1 : 1;
			typed.value = word.slice(0, ch);
			if (!deleting && ch === word.length) {
				deleting = true;
				timer = setTimeout(loop, 1900) as unknown as number;
				return;
			}
			if (deleting && ch === 0) {
				deleting = false;
				i++;
			}
			timer = setTimeout(loop, deleting ? 38 : 72) as unknown as number;
		};
		loop();
		return () => clearTimeout(timer);
	}, [category.value]);
	// #endregion

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
			<div class="shell-search__scope" ref={menuRef}>
				<button
					type="button"
					class="shell-search__scope-btn"
					aria-haspopup="listbox"
					aria-expanded={menuOpen.value}
					onClick={() => (menuOpen.value = !menuOpen.value)}
				>
					{searchScopeLabel(category.value)}
					<span class="shell-search__scope-caret" aria-hidden="true" />
				</button>
				{menuOpen.value && (
					<ul class="shell-search__menu" role="listbox" aria-label="Search scope">
						{SEARCH_SCOPES.map((opt) => (
							<li
								key={opt.value}
								role="option"
								aria-selected={category.value === opt.value}
								class="shell-search__option"
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

			<div class="shell-search__field">
				<input
					class="shell-search__input"
					type="search"
					value={query.value}
					aria-label={`Search ${searchScopeLabel(category.value).toLowerCase()}`}
					autoComplete="off"
					onInput={(e) => (query.value = (e.currentTarget as HTMLInputElement).value)}
				/>
				{query.value === "" && (
					<span class="shell-search__ghost" aria-hidden="true">
						<span class="shell-search__ghost-lead">Find</span>
						<span class="shell-search__typed">{typed.value}</span>
						<span class="shell-search__caret" />
					</span>
				)}
			</div>

			<button type="submit" class="shell-search__submit" aria-label="Search">
				<NavIcon name="search" />
			</button>
		</form>
	);
}
