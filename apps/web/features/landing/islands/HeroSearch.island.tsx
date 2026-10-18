import "../styles/lp-search.css";
import "../styles/lp-hero.css";
import type { ComponentType, JSX } from "preact";
import { effect, useComputed, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import {
	createSuggestController,
	SUGGEST_DEBOUNCE_MS,
	type SuggestFetcher,
} from "@features/explore/core/suggest-controller.ts";
import { isFocusSearchShortcut } from "@features/shell/core/shortcuts.ts";
import { useSearchShortcut } from "@features/shell/hooks/useSearchShortcut.ts";
import {
	DEFAULT_HERO_CATEGORY,
	flattenRows,
	type HeroCategory,
	heroSearchHref,
	moveActive,
	suggestAnnouncement,
	type SuggestRow,
	suggestSections,
	TYPEWRITER_START,
	typewriterAllowed,
	typewriterCapped,
	type TypewriterState,
	typewriterStep,
	typewriterTurnMs,
	typewriterTyped,
} from "../core/hero-search.ts";
import { heroTurn, heroTurnId, motionAllowed, startHeroTimeline } from "../core/hero-motion.ts";
import { HeroSearchForm, heroSearchIds, optionId } from "../components/HeroSearchForm.tsx";
import type { CategorySheetProps } from "../components/CategorySheet.tsx";

// #region Lazy modules
/**
 * The typeahead's transport, `ExploreService.suggest`, loaded on first use: the field works as a
 * plain form before it, and the client service stays off the hero's initial JavaScript.
 */
const loadExplore = () => import("@features/explore/core/ExploreService.ts");

/** {@link loadExplore}'s `suggest` as the controller's fetcher. */
const lazySuggest: SuggestFetcher = async (query, signal) =>
	(await loadExplore()).ExploreService.suggest(query, signal);

/** The category sheet (the overlay family's Drawer), loaded the first time it opens. */
const loadSheet = () => import("../components/CategorySheet.tsx");

/** The device's recent searches (`search-history`), loaded when the field is first used. */
const loadHistory = () => import("@features/explore/core/search-history.ts");

/** The loaded {@link loadHistory} module. */
type SearchHistory = Awaited<ReturnType<typeof loadHistory>>;

/** `--bp-md`: below it the typewriter's run is capped (§2.7). */
const WIDE_QUERY = "(min-width: 768px)";

/** Room kept between the panel's foot and the visual viewport's (the on-screen keyboard), px. */
const PANEL_FOOT_PX = 12;
// #endregion

// #region Props
/** Props for {@link HeroSearch}. */
export interface HeroSearchProps {
	/** Keeps a second instance's ids unique (`"-final"` for the final call to action). */
	idSuffix?: string;
	/** Bind `/` to this instance and show its hint — the hero instance only (#282). */
	slashFocus?: boolean;
	/** Run the typewriter over the placeholder — the hero instance only. */
	typewriter?: boolean;
	/** The typewriter's examples, confirmed by the server (`ExploreBackendService.landingHero`); empty keeps it off. */
	terms: readonly string[];
	/** The server's trending terms for every category: the empty field's Trending rows. */
	trending: readonly string[];
	/** The picture a person row shows when the payload carries none (`DEFAULT_AVATAR_URL`). */
	avatarFallback: string;
}
// #endregion

// #region Component
/**
 * HeroSearch — the landing's search into Explore (`flows/LANDING.md` §4.1; work order L2), an island
 * over the server-rendered {@link HeroSearchForm}. Without JavaScript that form already searches:
 * `GET /explore?q=…&category=…`. Hydrated, it adds:
 *
 *   - suggestions as you type — the headless `createSuggestController` (200ms debounce, a
 *     superseded request aborted, a sequence guard) over `ExploreService.suggest`, scoped to the
 *     picked category; recent searches (`search-history`) and the server's trending terms on an
 *     empty field. The client service and the history module load on first focus, so neither
 *     weighs on the hero's initial JavaScript; rows grouped People & teams · Services · Projects; the
 *     ARIA combobox keys (arrows, which keep the active row in sight, Enter, Escape, and Delete — or
 *     Backspace on an empty field — on a recent row), and each recent row's remove button;
 *   - Enter and the submit land on `explorePath(category, q)`; a person or listing row opens it the
 *     way Explore's own typeahead does (`profileHref` / `entityHref`). The search navigates even when
 *     the history chunk cannot load: a recent search is a convenience, never a gate;
 *   - below `--bp-md`, the icon button and its category sheet — and the native select back in its
 *     place should the sheet's chunk fail to load;
 *   - `/` focuses the field when `slashFocus` (`useSearchShortcut` + `isFocusSearchShortcut`);
 *   - the typewriter overlay, only on the hero timeline's typewriter turns (`hero-motion.ts`), each
 *     long enough for the longest example (`typewriterTurnMs`), never under either reduced-motion
 *     channel, and capped at five seconds below `--bp-md`. Its characters reach the overlay through a
 *     signal bound to one text node, so typing never re-renders the island.
 *
 * Dumb island: it reads `/api/explore/suggest` through the client service and writes only the
 * device's recent searches. It carries `lp-search.css` and `lp-hero.css` for the whole hero.
 */
export default function HeroSearch(
	{ idSuffix = "", slashFocus = false, typewriter = false, terms, trending, avatarFallback }:
		HeroSearchProps,
): JSX.Element {
	const ids = heroSearchIds(idSuffix);
	const formRef = useRef<HTMLFormElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const query = useSignal("");
	const category = useSignal<HeroCategory>(DEFAULT_HERO_CATEGORY);
	const hydrated = useSignal(false);
	const focused = useSignal(false);
	const open = useSignal(false);
	const active = useSignal(-1);
	const typed = useSignal<string | null>(null);
	const sheetOpen = useSignal(false);
	const sheetFailed = useSignal(false);
	const Sheet = useSignal<ComponentType<CategorySheetProps> | null>(null);
	const history = useSignal<SearchHistory | null>(null);
	const recent = useSignal<readonly string[]>([]);

	const suggest = useMemo(
		() => createSuggestController({ fetcher: lazySuggest, delayMs: SUGGEST_DEBOUNCE_MS }),
		[],
	);

	useSearchShortcut({ scopeRef: formRef, matches: isFocusSearchShortcut, enabled: slashFocus });

	// #region Effects
	useEffect(() => {
		hydrated.value = true;
		let unsubscribe: (() => void) | undefined;
		const stop = effect(() => {
			const loaded = history.value;
			if (!loaded || unsubscribe) return;
			loaded.loadRecentSearches();
			unsubscribe = loaded.recentSearches.subscribe((list) => (recent.value = list));
		});
		return () => {
			stop();
			unsubscribe?.();
			suggest.dispose();
		};
	}, []);

	// The typewriter: one example per typewriter turn of the hero timeline from --bp-md, every
	// example in its one capped turn below it; the static placeholder whenever it is not its turn.
	useEffect(() => {
		if (!typewriter || terms.length === 0) return;
		const release = startHeroTimeline({
			examples: terms.length,
			typewriterMs: typewriterTurnMs(terms),
		});
		const wide = globalThis.matchMedia(WIDE_QUERY).matches;
		let state: TypewriterState = TYPEWRITER_START;
		let turnTerms: readonly string[] = terms;
		let example = -1;
		let seenTurn = -1;
		let startedAt: number | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const hold = () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};
		const allowed = () =>
			typewriterAllowed({ enabled: true, terms: turnTerms, motionAllowed: motionAllowed() }) &&
			!typewriterCapped(startedAt === null ? 0 : Date.now() - startedAt, !wide);
		const tick = () => {
			timer = undefined;
			if (!allowed()) {
				typed.value = null;
				return;
			}
			const step = typewriterStep(state, turnTerms);
			state = step.next;
			typed.value = typewriterTyped(state, turnTerms);
			if (state.phase !== "done") timer = setTimeout(tick, step.delayMs);
		};

		const stop = effect(() => {
			const turn = heroTurn.value;
			const id = heroTurnId.value;
			if (turn !== "typewriter") {
				hold();
				typed.value = null;
				return;
			}
			if (id !== seenTurn) {
				seenTurn = id;
				example += 1;
				turnTerms = wide ? terms.slice(example, example + 1) : terms;
				state = TYPEWRITER_START;
				hold();
			}
			startedAt ??= Date.now();
			if (!allowed() || state.phase === "done") {
				typed.value = null;
				return;
			}
			typed.value = typewriterTyped(state, turnTerms);
			if (timer === undefined) timer = setTimeout(tick, 0);
		});

		return () => {
			stop();
			hold();
			release();
			typed.value = null;
		};
	}, []);

	// While open, the panel ends above the visual viewport's foot — the on-screen keyboard's top.
	useEffect(() => {
		const viewport = globalThis.visualViewport;
		const root = formRef.current?.parentElement;
		if (!viewport || !root) return;
		const fit = () => {
			if (!open.peek()) return;
			const top = root.getBoundingClientRect().bottom;
			const room = viewport.offsetTop + viewport.height - top - PANEL_FOOT_PX;
			root.style.setProperty("--lp-suggest-max", `${Math.max(160, Math.round(room))}px`);
		};
		const stop = effect(() => {
			if (open.value) fit();
		});
		viewport.addEventListener("resize", fit);
		viewport.addEventListener("scroll", fit);
		return () => {
			stop();
			viewport.removeEventListener("resize", fit);
			viewport.removeEventListener("scroll", fit);
		};
	}, []);
	// #endregion

	// #region Derived state
	const typedText = suggest.query.value;
	const trendingRows = suggest.trending.value ??
		(category.value === DEFAULT_HERO_CATEGORY ? trending : null);
	const sections = suggestSections({
		typed: typedText,
		recent: history.value?.matchRecent(recent.value, typedText) ?? [],
		trending: trendingRows,
		status: suggest.status.value,
		data: suggest.data.value,
	});
	const rows = flattenRows(sections);
	const panelOpen = open.value && focused.value && rows.length > 0;
	const status = suggest.status.value;
	const announcement = suggestAnnouncement(panelOpen, { typed: typedText, status }, sections);
	const overlayShown = useComputed(() =>
		query.value === "" && !focused.value && typed.value !== null
	);
	const typewriterText = useComputed(() => typed.value ?? "");
	const shownActive = panelOpen ? active.value : -1;
	const SheetView = Sheet.value;
	// #endregion

	// The active option stays in sight inside the scrolling panel.
	useEffect(() => {
		if (shownActive >= 0) {
			document.getElementById(optionId(ids, shownActive))?.scrollIntoView({ block: "nearest" });
		}
	}, [shownActive]);

	// #region Actions
	/** The history module, loading it on first use. */
	async function historyModule(): Promise<SearchHistory> {
		const loaded = history.peek() ?? await loadHistory();
		history.value = loaded;
		return loaded;
	}

	/** The history module loaded ahead of use; a chunk that fails is tried again on the next use. */
	function warmHistory(): void {
		historyModule().catch(() => {});
	}

	/**
	 * Record a non-empty `term` in the device's recent searches, then follow `href` — whether or not
	 * the history module could load.
	 */
	async function go(href: string, term = ""): Promise<void> {
		if (term) {
			try {
				(await historyModule()).recordSearch(term);
			} catch {
				// The search goes ahead without its recent-search entry.
			}
		}
		globalThis.location.assign(href);
	}

	/** Remove a recent search and keep the active row in range. */
	function removeRecent(term: string, count: number): void {
		history.peek()?.removeRecentSearch(term);
		active.value = Math.min(active.peek(), count - 2);
	}

	function search(term: string): void {
		const q = term.trim();
		void go(heroSearchHref(category.peek(), q), q);
	}

	function choose(row: SuggestRow | undefined): void {
		if (!row) return;
		switch (row.kind) {
			case "recent":
			case "trending":
				query.value = row.term;
				return search(row.term);
			case "search":
				return search(row.q);
			case "person":
			case "listing":
				return void go(row.href, query.peek().trim());
			case "clear-recent":
				history.peek()?.clearRecentSearches();
				active.value = -1;
				return;
		}
	}

	function setCategory(value: HeroCategory): void {
		category.value = value;
		suggest.setScope(value);
		if (!query.peek().trim()) suggest.prime();
	}

	function primeEmpty(): void {
		if (category.peek() !== DEFAULT_HERO_CATEGORY || trending.length === 0) suggest.prime();
	}

	async function openSheet(): Promise<void> {
		try {
			if (!Sheet.peek()) Sheet.value = (await loadSheet()).CategorySheet;
			sheetOpen.value = true;
		} catch {
			// Without its sheet the button cannot work: the native select takes its place again.
			sheetFailed.value = true;
			setTimeout(() => document.getElementById(ids.select)?.focus(), 0);
		}
	}
	// #endregion

	return (
		<>
			<HeroSearchForm
				ids={ids}
				query={query.value}
				category={category.value}
				hydrated={hydrated.value}
				scopeButton={hydrated.value && !sheetFailed.value}
				typewriter={overlayShown.value ? typewriterText : null}
				slashFocus={slashFocus}
				open={panelOpen}
				sections={panelOpen ? sections : []}
				active={panelOpen ? active.value : -1}
				status={status}
				announcement={announcement}
				sheetOpen={sheetOpen.value}
				avatarFallback={avatarFallback}
				glyph={(name) => <Icon name={name} />}
				formRef={formRef}
				inputRef={inputRef}
				on={{
					submit(event) {
						event.preventDefault();
						search(query.peek());
					},
					input(value) {
						query.value = value;
						suggest.setQuery(value);
						active.value = -1;
						open.value = true;
						if (!value.trim()) primeEmpty();
					},
					keyDown(event) {
						const count = rows.length;
						switch (event.key) {
							case "ArrowDown":
							case "ArrowUp":
								event.preventDefault();
								if (!open.peek()) {
									open.value = true;
									active.value = -1;
									return;
								}
								active.value = moveActive(
									active.peek(),
									count,
									event.key === "ArrowDown" ? 1 : -1,
								);
								return;
							case "Enter":
								if (panelOpen && active.peek() >= 0) {
									event.preventDefault();
									choose(rows[active.peek()]);
								}
								return;
							case "Escape":
								if (panelOpen) {
									event.preventDefault();
									open.value = false;
									active.value = -1;
								}
								return;
							case "Delete":
							case "Backspace": {
								// Backspace only while there is no text to delete: the key a Mac labels "delete".
								const field = event.currentTarget as HTMLInputElement;
								if (event.key === "Backspace" && field.value !== "") return;
								const row = panelOpen ? rows[active.peek()] : undefined;
								if (row?.kind === "recent") {
									event.preventDefault();
									removeRecent(row.term, count);
								}
								return;
							}
							case "Tab":
								open.value = false;
								return;
						}
					},
					focus() {
						focused.value = true;
						open.value = true;
						warmHistory();
						loadExplore().catch(() => {});
						if (!query.peek().trim()) primeEmpty();
					},
					focusOut(event) {
						const next = event.relatedTarget;
						const root = event.currentTarget as HTMLElement | null;
						if (next instanceof Node && root?.contains(next)) return;
						focused.value = false;
						open.value = false;
						active.value = -1;
					},
					category: setCategory,
					openSheet: () => void openSheet(),
					choose: (index) => choose(rows[index]),
					hover(index) {
						active.value = index;
					},
					remove(term) {
						history.peek()?.removeRecentSearch(term);
						active.value = -1;
						inputRef.current?.focus();
					},
				}}
			/>
			{SheetView && (
				<SheetView
					visible={sheetOpen}
					value={category.value}
					name={`${ids.select}-sheet`}
					returnFocusRef={inputRef}
					id={ids.sheet}
					onPick={(value) => {
						setCategory(value);
						sheetOpen.value = false;
					}}
				/>
			)}
		</>
	);
}
// #endregion
