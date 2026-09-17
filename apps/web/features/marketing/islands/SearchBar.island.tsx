import "../styles/hero-search.css";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import {
	DEFAULT_SEARCH_SCOPE,
	SEARCH_SCOPES,
	type SearchScope,
	searchScopeLabel,
} from "../core/landing-data.ts";

/**
 * SearchBar — the single discovery search used across the app.
 *
 * Both surfaces render this one island (Confirmed Decision — one shared search): the marketing hero
 * (`variant="hero"`, centred and capped at 44rem) and the `/explore` header (`variant="bar"`, a
 * compact full-width bar). Both wear the site header's search anatomy and tokens — one hairline pill
 * on a `--surface-2` tint, a fused scope selector whose trailing edge is the divider, a plain field,
 * and a quiet icon-only magnifier in the pill's own ink (see `hero-search.css`). The placeholder
 * types itself out phrase-by-phrase with a blinking caret, cycling every few seconds; a row of
 * trending queries sits below. The glyphs are the registry's (§B.7), as on the results bar, rather
 * than the header's hand-authored ones. Submitting or
 * choosing a category/trending tag navigates to `/explore` with `?category=` + `?q=` — a real
 * navigation, so the server re-renders the correct layout (Home ↔ Search Results). Reduced-motion
 * shows a static placeholder.
 */

// #region Static config
/**
 * The typewriter phrases per search scope. Keyed by the shared {@link SearchScope} vocabulary so the
 * selector, the placeholder, and the `/explore?category=` navigation all stay in lockstep.
 */
const PHRASES: Record<SearchScope, string[]> = {
	all: ["anything you need", "a helper or a team", "your next big idea", "ready-made goodies"],
	freelancers: ["a motion designer", "a Deno engineer", "a 3D artist", "a product design lead"],
	users: ["a creative director", "a founder to back", "an advisor", "someone to collaborate with"],
	projects: [
		"a fintech MVP build",
		"a mobile app redesign",
		"a commerce migration",
		"a data dashboard",
	],
	services: [
		"a brand identity sprint",
		"a 5-day landing page",
		"a design-system foundation",
		"a launch film",
	],
	products: ["an Aurora UI kit", "Lightroom presets", "dashboard blocks", "a 640-icon set"],
	articles: [
		"growing a small team",
		"keeping payments safe",
		"paying step by step",
		"hiring a whole team",
	],
};

const TRENDING = [
	"Webflow build",
	"Brand refresh",
	"AI product design",
	"Realtime backend",
	"Pitch deck",
];
// #endregion

export interface SearchBarProps {
	/** Visual treatment: the prominent hero bar (default) or the compact `/explore` header bar. */
	variant?: "hero" | "bar";
	/** Pre-selected category token (e.g. the current `/explore?category=`); unknown values → `all`. */
	initialCategory?: string;
	/** Pre-filled query (e.g. reflecting the current `/explore?q=`). */
	initialQuery?: string;
}

/**
 * Coerce an arbitrary category token to one of the selector scopes. Tokens the selector doesn't offer
 * (e.g. `teams`, `businesses`) fall back to the neutral default scope (`all`).
 */
function toScope(raw: string): SearchScope {
	return SEARCH_SCOPES.find((s) => s.value === raw)?.value ?? DEFAULT_SEARCH_SCOPE;
}

export default function SearchBar({
	variant = "hero",
	initialCategory = DEFAULT_SEARCH_SCOPE,
	initialQuery = "",
}: SearchBarProps) {
	const category = useSignal<SearchScope>(toScope(initialCategory));
	const menuOpen = useSignal(false);
	const query = useSignal(initialQuery);
	const typed = useSignal("");
	const menuRef = useRef<HTMLDivElement>(null);

	// #region Typewriter placeholder
	// Retype/erase the phrases for the active category; restarts when the category flips.
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
		// `ReturnType<typeof setTimeout>`, not `number`: under Deno's node-compat typings `setTimeout`
		// returns a `Timeout` object, so a `number` handle fails to typecheck.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const loop = () => {
			const word = phrases[i % phrases.length];
			ch += deleting ? -1 : 1;
			typed.value = word.slice(0, ch);
			if (!deleting && ch === word.length) {
				deleting = true;
				timer = setTimeout(loop, 1900);
				return;
			}
			if (deleting && ch === 0) {
				deleting = false;
				i++;
			}
			timer = setTimeout(loop, deleting ? 38 : 72);
		};
		loop();
		return () => clearTimeout(timer);
	}, [category.value]);
	// #endregion

	// Close the category menu on outside click.
	useEffect(() => {
		const onDoc = (e: MouseEvent) => {
			if (menuOpen.value && menuRef.current && !menuRef.current.contains(e.target as Node)) {
				menuOpen.value = false;
			}
		};
		document.addEventListener("click", onDoc);
		return () => document.removeEventListener("click", onDoc);
	}, []);

	/** Navigate to `/explore` with the active scope + query (omitting the neutral `all` scope + empty query). */
	function go(q: string) {
		const params = new URLSearchParams();
		if (category.value !== "all") params.set("category", category.value);
		if (q) params.set("q", q);
		const qs = params.toString();
		globalThis.location.href = qs ? `/explore?${qs}` : "/explore";
	}

	return (
		<div class={`hero-search hero-search--${variant}`}>
			<form
				class="hero-search__bar"
				role="search"
				onSubmit={(e) => {
					e.preventDefault();
					go(query.value.trim());
				}}
			>
				<div class="hero-search__entity" ref={menuRef}>
					<button
						type="button"
						class="hero-search__entity-btn"
						aria-haspopup="listbox"
						aria-expanded={menuOpen.value}
						onClick={() => (menuOpen.value = !menuOpen.value)}
					>
						{searchScopeLabel(category.value)}
						<Icon name="chevron-down" size="2xs" class="hero-search__chevron" />
					</button>
					{menuOpen.value && (
						<ul class="hero-search__menu" role="listbox" aria-label="Search category">
							{SEARCH_SCOPES.map((opt) => (
								<li
									key={opt.value}
									role="option"
									aria-selected={category.value === opt.value}
									class="hero-search__option"
									tabIndex={0}
									onClick={() => {
										category.value = opt.value;
										menuOpen.value = false;
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
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

				<div class="hero-search__field">
					<input
						class="hero-search__input"
						type="search"
						value={query.value}
						aria-label={`Search ${searchScopeLabel(category.value).toLowerCase()}`}
						onInput={(e) => (query.value = (e.currentTarget as HTMLInputElement).value)}
					/>
					{query.value === "" && (
						<span class="hero-search__ghost" aria-hidden="true">
							<span class="hero-search__ghost-lead">Find</span>
							<span class="hero-search__typed">{typed.value}</span>
							<span class="hero-search__caret" />
						</span>
					)}
				</div>

				<button type="submit" class="hero-search__submit" aria-label="Search">
					<Icon name="search" size="sm" />
				</button>
			</form>

			<div class="hero-search__trending">
				<span class="hero-search__trending-label">Trending</span>
				{TRENDING.map((t) => (
					<button
						key={t}
						type="button"
						class="hero-search__tag"
						data-magnetic
						data-magnetic-strength="0.4"
						onClick={() => go(t)}
					>
						{t}
					</button>
				))}
			</div>
		</div>
	);
}
