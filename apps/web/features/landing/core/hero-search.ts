/**
 * hero-search — the landing hero's search, as data and pure functions (`flows/LANDING.md` §4.1,
 * build prompts L2): the category picker's options, the URL a search lands on, the "Try:" chips'
 * links, the typewriter's step model and turn length, the calls to action each viewer is offered,
 * and the suggestion rows grouped by kind. The typewriter's terms and the chips themselves are
 * derived on the server (`ExploreBackendService.landingHero`).
 *
 * Shared by the server (`routes/(public)/index.tsx`, `LandingHero`) and the `HeroSearch` island, so
 * it imports nothing that touches the database or the DOM. Every search URL goes through
 * {@link explorePath}, Explore's real `?category=&q=` contract (decision (k)); the typeahead's own
 * `scope` is the same category value.
 */
import type {
	ExploreCategory,
	SuggestHandle,
	SuggestHit,
	Suggestions,
} from "@projective/types/explore";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { entityHref, profileHref } from "@features/explore/core/routing.ts";

// #region Copy
/** The search bar's fixed copy (`flows/LANDING.md` §4.1). */
export const HERO_SEARCH_COPY = {
	/** The hero search landmark's name; the page's second search is named by its own heading. */
	landmark: "Search Projective",
	/** The input's visually hidden `<label>`. */
	label: "Search freelancers, teams, services and projects",
	/** The real placeholder: screen readers, no JavaScript, both reduced-motion channels. `[U1]` */
	placeholder: "Search teams, services and projects",
	/** The desktop picker's accessible name; a native select announces its own value after it. */
	picker: "Search in",
	/** The mobile picker sheet's title. */
	sheetTitle: "Search in",
	submit: "Search",
	/** The suggestions listbox's accessible name. */
	listbox: "Suggestions",
	chipsLabel: "Try:",
	chipsNav: "Suggested searches",
	recent: "Recent searches",
	trending: "Trending",
	people: "People & teams",
	services: "Services",
	projects: "Projects",
	clearRecent: "Clear recent searches",
	/** A recent row's description: how to remove it from the keyboard. */
	removeHint: "Press Delete to remove",
	/** The words after the `/` key in the shortcut hint. */
	shortcutHint: "to search",
	searching: "Searching…",
	failed: "Suggestions aren't available right now. Press Enter to search.",
} as const;

/** "Remove “{term}” from recent searches" — a recent row's remove button. */
export function removeRecentLabel(term: string): string {
	return `Remove “${term}” from recent searches`;
}

/** The trailing row while typing: "Search Explore for “{q}”". */
export function searchAnywayLabel(q: string): string {
	return `Search Explore for “${q}”`;
}

/** The trailing row's visible text when nothing matched. */
export const NO_MATCHES_TEXT = "No matches — search anyway";

/** The no-match row's accessible name: "No matches for “{q}”. Search anyway". */
export function noMatchesLabel(q: string): string {
	return `No matches for “${q}”. Search anyway`;
}
// #endregion

// #region Categories
/**
 * The hero picker's categories: the real Explore values minus `products` (no digital-product
 * delivery until W2, #281 flag k). Teams fold into `freelancers` the way Explore's own scopes do
 * (`detail-nav.ts` `scopeOf`, the backend's `CATEGORY_TYPES`).
 */
export type HeroCategory = Extract<
	ExploreCategory,
	"all" | "freelancers" | "services" | "projects" | "businesses"
>;

/**
 * The registry icons the search draws (`@projective/ui/icons`), named here rather than typed from the
 * package so this module loads under `deno test` (the icon component imports its stylesheet).
 */
export type HeroGlyph =
	| "explore"
	| "members"
	| "service"
	| "projects"
	| "building"
	| "search"
	| "chevron-down"
	| "history"
	| "arrow-up-right"
	| "close";

/** One picker option: the real value, its human label and the glyph the mobile button shows. */
export interface HeroCategoryOption {
	value: HeroCategory;
	label: string;
	glyph: HeroGlyph;
}

/** The picker's options in display order (`flows/LANDING.md` §4.1). */
export const HERO_CATEGORIES: readonly HeroCategoryOption[] = [
	{ value: "all", label: "All", glyph: "explore" },
	{ value: "freelancers", label: "Freelancers & teams", glyph: "members" },
	{ value: "services", label: "Services", glyph: "service" },
	{ value: "projects", label: "Projects", glyph: "projects" },
	{ value: "businesses", label: "Businesses", glyph: "building" },
];

/** The picker's starting value. */
export const DEFAULT_HERO_CATEGORY: HeroCategory = "all";

/** The option for `value`. */
export function heroCategory(value: HeroCategory): HeroCategoryOption {
	return HERO_CATEGORIES.find((option) => option.value === value) ?? HERO_CATEGORIES[0];
}

/** Coerce any token (a select's value, a stale radio) to a picker category; unknown → `all`. */
export function toHeroCategory(raw: string | null | undefined): HeroCategory {
	return HERO_CATEGORIES.find((option) => option.value === raw)?.value ?? DEFAULT_HERO_CATEGORY;
}

/** The mobile picker button's accessible name: "Choose what to search (now: {label})". */
export function sheetButtonLabel(value: HeroCategory): string {
	return `Choose what to search (now: ${heroCategory(value).label})`;
}

/**
 * Where a hero search lands: `explorePath(category, q)` — `/explore`, `/explore?q=…` or
 * `/explore?category=…&q=…` — with the term trimmed; an empty term opens the category's Explore.
 */
export function heroSearchHref(category: HeroCategory, q: string): string {
	return explorePath(category, q.trim());
}
// #endregion

// #region Terms and chips
/** Same term, ignoring case and spacing. */
function sameTerm(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** `terms` without blanks and case-insensitive repeats, in order. */
function uniqueTerms(terms: Iterable<string>): string[] {
	const out: string[] = [];
	for (const raw of terms) {
		const term = raw.trim().replace(/\s+/g, " ");
		if (term && !out.some((kept) => sameTerm(kept, term))) out.push(term);
	}
	return out;
}

/** A chip's link: the term across every category, `explorePath('all', term)`. */
export function chipHref(term: string): string {
	return heroSearchHref("all", term);
}
// #endregion

// #region Typewriter
/** The typewriter's clock (ms): per typed and erased character, the hold, the gap between terms. */
export const TYPEWRITER_TIMING = {
	typeMs: 70,
	eraseMs: 32,
	holdMs: 1600,
	gapMs: 400,
	/** Below `--bp-md` the whole run stops after this long (WCAG 2.2.2; §2.7). */
	narrowCapMs: 5000,
} as const;

/** Where the typewriter is: typing, holding the whole term, erasing, or finished. */
export type TypewriterPhase = "typing" | "holding" | "erasing" | "done";

/** The typewriter's position: which term, how many of its characters show, and the phase. */
export interface TypewriterState {
	index: number;
	chars: number;
	phase: TypewriterPhase;
}

/** The first frame: nothing typed yet of the first term. */
export const TYPEWRITER_START: TypewriterState = { index: 0, chars: 0, phase: "typing" };

/** What decides whether the typewriter may run at all. */
export interface TypewriterGate {
	/** The instance asks for it (the final-CTA instance does not). */
	enabled: boolean;
	terms: readonly string[];
	/** Neither reduced-motion channel is on (`hero-motion.ts` `motionAllowed()`). */
	motionAllowed: boolean;
}

/**
 * Whether the typewriter may run: asked for, with at least one confirmed term, and neither
 * reduced-motion channel on. Otherwise the input shows its static placeholder only.
 */
export function typewriterAllowed(gate: TypewriterGate): boolean {
	return gate.enabled && gate.terms.length > 0 && gate.motionAllowed;
}

/**
 * The frame after `state`, and how long to wait before it. Each term types, holds, erases and hands
 * on to the next once; after the last one the typewriter is `done` (one cycle per example, §2.7).
 */
export function typewriterStep(
	state: TypewriterState,
	terms: readonly string[],
): { next: TypewriterState; delayMs: number } {
	const term = terms[state.index] ?? "";
	switch (state.phase) {
		case "typing": {
			const chars = Math.min(state.chars + 1, term.length);
			return chars >= term.length
				? { next: { ...state, chars, phase: "holding" }, delayMs: TYPEWRITER_TIMING.holdMs }
				: { next: { ...state, chars }, delayMs: TYPEWRITER_TIMING.typeMs };
		}
		case "holding":
			return { next: { ...state, phase: "erasing" }, delayMs: TYPEWRITER_TIMING.eraseMs };
		case "erasing": {
			const chars = Math.max(state.chars - 1, 0);
			if (chars > 0) return { next: { ...state, chars }, delayMs: TYPEWRITER_TIMING.eraseMs };
			const index = state.index + 1;
			return index >= terms.length
				? { next: { index, chars: 0, phase: "done" }, delayMs: 0 }
				: { next: { index, chars: 0, phase: "typing" }, delayMs: TYPEWRITER_TIMING.gapMs };
		}
		case "done":
			return { next: state, delayMs: 0 };
	}
}

/**
 * How long one term's cycle takes from its first character to its last one erased:
 * {@link typewriterStep}'s delays for that term — typed, held, then erased.
 */
export function typewriterCycleMs(term: string): number {
	const steps = Math.max(0, term.length - 1);
	return steps * (TYPEWRITER_TIMING.typeMs + TYPEWRITER_TIMING.eraseMs) + TYPEWRITER_TIMING.holdMs +
		TYPEWRITER_TIMING.eraseMs;
}

/**
 * How long a typewriter turn of the hero timeline must last so the longest of `terms` finishes its
 * cycle with the gap to spare (`startHeroTimeline`'s `typewriterMs`); the timeline never makes a turn
 * shorter than its own default.
 */
export function typewriterTurnMs(terms: readonly string[]): number {
	return terms.reduce(
		(longest, term) => Math.max(longest, typewriterCycleMs(term) + TYPEWRITER_TIMING.gapMs),
		0,
	);
}

/** The current term's typed part (`brand ide`), or `null` once the run is done. */
export function typewriterTyped(state: TypewriterState, terms: readonly string[]): string | null {
	if (state.phase === "done") return null;
	return (terms[state.index] ?? "").slice(0, state.chars);
}

/** The overlay sentence's frame around the typed part: "Try “" … "”" (§4.1). */
export const TYPEWRITER_FRAME = { open: "Try “", close: "”" } as const;

/** The whole overlay sentence for a typed part: "Try “brand identity”". */
export function typewriterSentence(typed: string): string {
	return `${TYPEWRITER_FRAME.open}${typed}${TYPEWRITER_FRAME.close}`;
}

/**
 * Whether a narrow viewport's run is over: below `--bp-md` the typewriter is the hero's only motion
 * and stops for good {@link TYPEWRITER_TIMING.narrowCapMs} after it started, so no pause control is
 * needed there (WCAG 2.2.2).
 */
export function typewriterCapped(elapsedMs: number, narrow: boolean): boolean {
	return narrow && elapsedMs >= TYPEWRITER_TIMING.narrowCapMs;
}
// #endregion

// #region Calls to action
/** The few viewer facts the calls to action depend on (from `ctx.state`, never the whole context). */
export interface HeroViewer {
	authenticated: boolean;
	/** Can already offer work (`UserContext.isFreelancer`). */
	isFreelancer: boolean;
	/** 13–17: may explore, not sell (`isRestrictedRequest`: `UserContext.restricted`, or the dev age override). */
	restricted: boolean;
}

/** A guest. */
export const GUEST_VIEWER: HeroViewer = {
	authenticated: false,
	isFreelancer: false,
	restricted: false,
};

/**
 * The viewer facts of a request: a guest unless signed in with resolved facts. The route reads
 * `restricted` through `isRestrictedRequest`, so the Dev Context Switcher's age override applies.
 */
export function heroViewerOf(
	authenticated: boolean,
	facts?: { isFreelancer: boolean; restricted: boolean } | null,
): HeroViewer {
	if (!authenticated || !facts) return GUEST_VIEWER;
	return {
		authenticated: true,
		isFreelancer: facts.isFreelancer === true,
		restricted: facts.restricted === true,
	};
}

/** One call to action: its label and where it goes. */
export interface HeroCta {
	label: string;
	href: string;
}

/**
 * The hero's two calls to action (`flows/LANDING.md` §4.1 table): "Hire a team" →
 * `explorePath('teams')` for everyone; "Offer your skills" → `/join?intent=freelancer` for a guest
 * (`/become-partner` is auth-guarded), `/become-partner` for a signed-in client, "Find work" →
 * `explorePath('projects')` for a freelancer, and nothing for a 13–17 account.
 */
export function heroCtas(viewer: HeroViewer): { hire: HeroCta; offer: HeroCta | null } {
	const hire = { label: "Hire a team", href: explorePath("teams") };
	if (viewer.restricted) return { hire, offer: null };
	if (!viewer.authenticated) {
		return { hire, offer: { label: "Offer your skills", href: "/join?intent=freelancer" } };
	}
	if (viewer.isFreelancer) {
		return { hire, offer: { label: "Find work", href: explorePath("projects") } };
	}
	return { hire, offer: { label: "Offer your skills", href: "/become-partner" } };
}
// #endregion

// #region Suggestions
/** One row of the suggestions listbox. */
export type SuggestRow =
	| { kind: "recent"; term: string }
	| { kind: "clear-recent" }
	| { kind: "trending"; term: string }
	| { kind: "person"; name: string; meta: string; avatar: string | null; href: string }
	| { kind: "listing"; title: string; meta: string; media: string | null; href: string }
	| { kind: "search"; q: string; empty: boolean };

/** The listbox's groups, in order (`flows/LANDING.md` §4.1; no Products until W2). */
export type SuggestSectionId =
	| "recent"
	| "trending"
	| "people"
	| "services"
	| "projects"
	| "search";

/** One labelled group of rows; the trailing search row's group has no label. */
export interface SuggestSection {
	id: SuggestSectionId;
	label: string | null;
	rows: SuggestRow[];
}

/** The typeahead's request state (`suggest-controller.ts` `SuggestStatus`). */
export type SuggestPhase = "idle" | "loading" | "ready" | "error";

/** What the listbox is built from. */
export interface SuggestInput {
	/** The text as typed. */
	typed: string;
	/**
	 * The device's recent searches to list, most recent first, already matched to the text
	 * (`search-history.ts` `matchRecent`: all of them on an empty field, prefix matches while typing).
	 */
	recent: readonly string[];
	/** Trending terms for the scope, or `null` until known. */
	trending: readonly string[] | null;
	status: SuggestPhase;
	/** The latest answer (kept while a newer one loads). */
	data: Suggestions | null;
}

/** The most trending rows the empty field lists (the suggest route's own cap). */
const TRENDING_ROWS_MAX = 6;

const PROFILE_KIND: Record<SuggestHandle["kind"], string> = {
	user: "Person",
	freelancer: "Freelancer",
	team: "Team",
	business: "Business",
};

const PROFILE_TYPE: Partial<Record<SuggestHit["type"], string>> = {
	users: "Person",
	freelancers: "Freelancer",
	teams: "Team",
	businesses: "Business",
};

/** People and teams: the matched handles, then profile hits not already listed by handle. */
function peopleRows(data: Suggestions): SuggestRow[] {
	const rows: SuggestRow[] = data.handles.map((handle) => ({
		kind: "person",
		name: handle.name,
		meta: PROFILE_KIND[handle.kind],
		avatar: handle.avatar || null,
		href: profileHref(handle.handle),
	}));
	for (const hit of data.hits) {
		const kind = PROFILE_TYPE[hit.type];
		if (!kind || data.handles.some((handle) => sameTerm(handle.handle, hit.ownerHandle))) continue;
		rows.push({
			kind: "person",
			name: hit.title,
			meta: kind,
			avatar: hit.media || null,
			href: entityHref(hit),
		});
	}
	return rows;
}

/** The listing hits of one entity type, linked the way Explore links a typeahead hit. */
function listingRows(data: Suggestions, type: "services" | "projects"): SuggestRow[] {
	return data.hits.filter((hit) => hit.type === type).map((hit) => ({
		kind: "listing",
		title: hit.title,
		meta: hit.ownerName,
		media: hit.media || null,
		href: entityHref(hit),
	}));
}

/**
 * The listbox's groups. An empty field lists Recent searches (removable, with Clear) and Trending.
 * While typing: the recent searches that match the text, then People & teams, Services and
 * Projects from the answer (products and articles are not offered), then one trailing row —
 * "Search Explore for “q”", or "No matches — search anyway" once an answer came back with nothing.
 */
export function suggestSections(input: SuggestInput): SuggestSection[] {
	const typed = input.typed.trim();
	const sections: SuggestSection[] = [];
	const recent = uniqueTerms(input.recent);

	if (!typed) {
		if (recent.length > 0) {
			sections.push({
				id: "recent",
				label: HERO_SEARCH_COPY.recent,
				rows: [
					...recent.map((term): SuggestRow => ({ kind: "recent", term })),
					{ kind: "clear-recent" },
				],
			});
		}
		const trending = uniqueTerms(input.trending ?? []).slice(0, TRENDING_ROWS_MAX);
		if (trending.length > 0) {
			sections.push({
				id: "trending",
				label: HERO_SEARCH_COPY.trending,
				rows: trending.map((term): SuggestRow => ({ kind: "trending", term })),
			});
		}
		return sections;
	}

	if (recent.length > 0) {
		sections.push({
			id: "recent",
			label: HERO_SEARCH_COPY.recent,
			rows: recent.map((term): SuggestRow => ({ kind: "recent", term })),
		});
	}
	const data = input.status === "error" ? null : input.data;
	if (data) {
		const groups: Array<[SuggestSectionId, string, SuggestRow[]]> = [
			["people", HERO_SEARCH_COPY.people, peopleRows(data)],
			["services", HERO_SEARCH_COPY.services, listingRows(data, "services")],
			["projects", HERO_SEARCH_COPY.projects, listingRows(data, "projects")],
		];
		for (const [id, label, rows] of groups) {
			if (rows.length > 0) sections.push({ id, label, rows });
		}
	}
	const empty = input.status === "ready" && sections.length === 0;
	sections.push({ id: "search", label: null, rows: [{ kind: "search", q: typed, empty }] });
	return sections;
}

/** Every row of `sections` in listbox order: the order the arrow keys move through. */
export function flattenRows(sections: readonly SuggestSection[]): SuggestRow[] {
	return sections.flatMap((section) => section.rows);
}

/** The arrow keys' next active row: down from none is the first, up from none the last; it wraps. */
export function moveActive(current: number, count: number, step: 1 | -1): number {
	if (count <= 0) return -1;
	if (current < 0) return step === 1 ? 0 : count - 1;
	return (current + step + count) % count;
}

/**
 * What the polite status region says (`flows/LANDING.md` §4.1): "Searching…" while a typed query
 * is out, the failure sentence, "{n} suggestions. Use the up and down arrows to choose.", the
 * no-match row's name, or nothing while the panel is closed.
 */
export function suggestAnnouncement(
	open: boolean,
	input: Pick<SuggestInput, "typed" | "status">,
	sections: readonly SuggestSection[],
): string {
	if (!open) return "";
	const typed = input.typed.trim();
	if (typed && input.status === "error") return HERO_SEARCH_COPY.failed;
	const choices =
		flattenRows(sections).filter((row) => row.kind !== "search" && row.kind !== "clear-recent")
			.length;
	if (typed && input.status === "loading" && choices === 0) return HERO_SEARCH_COPY.searching;
	if (choices > 0) {
		return `${choices} ${
			choices === 1 ? "suggestion" : "suggestions"
		}. Use the up and down arrows to choose.`;
	}
	return typed && input.status === "ready" ? noMatchesLabel(typed) : "";
}
// #endregion
