import "../styles/hero-search.css";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { SEARCH_ENTITIES, type SearchEntity } from "../core/landing-data.ts";

/**
 * HeroSearch — the prominent hero search. An entity-type selector (Freelancers / Services / Projects
 * / Products / Articles) fused to a large input whose placeholder types itself out phrase-by-phrase
 * with a blinking caret, cycling every few seconds; a row of trending queries sits below. Submitting
 * routes to `/explore` with the chosen type + query. Reduced-motion shows a static placeholder.
 */
const PHRASES: Record<SearchEntity, string[]> = {
	Freelancers: ["a motion designer", "a Deno engineer", "a 3D artist", "a product design lead"],
	Services: [
		"a brand identity sprint",
		"a 5-day landing page",
		"a design-system foundation",
		"a launch film",
	],
	Projects: [
		"a fintech MVP build",
		"a mobile app redesign",
		"a commerce migration",
		"a data dashboard",
	],
	Products: ["an Aurora UI kit", "Lightroom presets", "dashboard blocks", "a 640-icon set"],
	Articles: [
		"growing a small team",
		"keeping payments safe",
		"paying step by step",
		"hiring a team of helpers",
	],
};

const TRENDING = [
	"Webflow build",
	"Brand refresh",
	"AI product design",
	"Realtime backend",
	"Pitch deck",
];

export default function HeroSearch() {
	const entity = useSignal<SearchEntity>("Services");
	const menuOpen = useSignal(false);
	const query = useSignal("");
	const typed = useSignal("");
	const menuRef = useRef<HTMLDivElement>(null);

	// Typewriter placeholder — retype/erase phrases for the active entity. Restarts when entity flips.
	useEffect(() => {
		const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		const phrases = PHRASES[entity.value];
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
	}, [entity.value]);

	// Close the entity menu on outside click.
	useEffect(() => {
		const onDoc = (e: MouseEvent) => {
			if (menuOpen.value && menuRef.current && !menuRef.current.contains(e.target as Node)) {
				menuOpen.value = false;
			}
		};
		document.addEventListener("click", onDoc);
		return () => document.removeEventListener("click", onDoc);
	}, []);

	function go(q: string) {
		const dest = `/explore?type=${entity.value.toLowerCase()}${
			q ? `&q=${encodeURIComponent(q)}` : ""
		}`;
		globalThis.location.href = dest;
	}

	return (
		<div class="hero-search">
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
						{entity.value}
						<span class="hero-search__chevron" aria-hidden="true" />
					</button>
					{menuOpen.value && (
						<ul class="hero-search__menu" role="listbox" aria-label="Search type">
							{SEARCH_ENTITIES.map((opt) => (
								<li
									key={opt}
									role="option"
									aria-selected={entity.value === opt}
									class="hero-search__option"
									tabIndex={0}
									onClick={() => {
										entity.value = opt;
										menuOpen.value = false;
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											entity.value = opt;
											menuOpen.value = false;
										}
									}}
								>
									{opt}
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
						aria-label={`Search for a ${entity.value.toLowerCase()}`}
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

				<button
					type="submit"
					class="hero-search__submit"
					data-magnetic
					data-magnetic-strength="0.25"
					aria-label="Search"
				>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path
							d="M8.5 3a5.5 5.5 0 1 0 3.4 9.8l3.6 3.7 1.4-1.4-3.7-3.6A5.5 5.5 0 0 0 8.5 3Zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z"
							fill="currentColor"
						/>
					</svg>
					<span class="hero-search__submit-label">Search</span>
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
