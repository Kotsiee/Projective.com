import type { LandingHero, Suggestions, SuggestQuery } from "@projective/types/explore";

/**
 * landing-hero — the landing hero search's server-derived data as pure functions
 * (`documentation/flows/LANDING.md` §4.1 `[U2]` `[U3]`), behind `ExploreBackendService.landingHero`.
 *
 * - The typewriter's example searches: a generic phrase read off each recommended service and
 *   project title — names and acronyms cut out, so a client's brand never reaches the hero, and the
 *   catalogue's own lower-case vocabulary deciding what an ordinary word is — each kept only when the
 *   typeahead hits it, then topped up from the §4.1 fallbacks, each confirmed the same way.
 * - The trending terms of an empty-query typeahead read (the empty field's Trending rows).
 * - The "Try:" chips: the trending terms, else the confirmed typewriter terms.
 *
 * Deterministic and free of I/O: the caller hands in the catalogue's text and its typeahead read.
 */

// #region Limits
/** The typewriter's fallback examples (§4.1 `[U2]`), each shown only once the typeahead hits it. */
export const FALLBACK_TERMS: readonly string[] = [
	"brand identity",
	"landing page",
	"design system",
	"motion design",
	"mobile app",
];

/** The typewriter shows at most this many examples, one cycle each (§2.7). */
export const HERO_TERMS_MAX = 6;

/** Fewer derived examples than this are topped up from {@link FALLBACK_TERMS}. */
export const HERO_TERMS_MIN = 4;

/** The most titles turned into candidate terms. */
export const HERO_TERM_CANDIDATES_MAX = 8;

/** The "Try:" row shows at most this many chips (§2.3 note 4). */
export const HERO_CHIPS_MAX = 5;

/** A derived term is a phrase of two or three words, at most this many characters. */
const TERM_WORDS_MIN = 2;
const TERM_WORDS_MAX = 3;
export const TERM_CHARS_MAX = 28;
// #endregion

// #region Inputs
/** The text of one catalogue listing that the vocabulary reads (an `ExploreItem` is one). */
export interface CatalogueText {
	title: string;
	summary?: string;
	skills?: readonly { label: string }[];
	category?: unknown;
}

/** The recommended listing titles the typewriter's examples are read off (`HomeFeed.recommended`). */
export interface RecommendedTitles {
	services: readonly { title: string }[];
	projects: readonly { title: string }[];
}

/** The typeahead read terms are confirmed with (`suggestFrom` over the cached catalogue). */
export type SuggestRead = (query: SuggestQuery) => Suggestions;
// #endregion

// #region Vocabulary
/** Where a title stops reading as a search: a dash, a colon or bracket, or a joining word. */
const TITLE_CUT = /\s[—–-]\s|[:|(·]|\s(?:in|for|with|by|from|on|at|and)\s/i;

/** Where a sentence of a summary ends. */
const SENTENCE_END = /[.!?]\s+/;

/** The words of `text`: runs of letters, digits, apostrophes and hyphens. */
function wordsOf(text: string): string[] {
	return text.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter((word) =>
		/[\p{L}\p{N}]/u.test(word)
	);
}

/** Written in lower case, with at least one letter. */
function isLower(word: string): boolean {
	return word === word.toLowerCase() && /\p{L}/u.test(word);
}

/** Two or more capitals (`UI`, `MVP`, `iOS`): an acronym or a brand's casing, never an ordinary word. */
function isAcronym(word: string): boolean {
	return /\p{Lu}.*\p{Lu}/u.test(word);
}

/** What the catalogue's own text says about its words. */
export interface Vocabulary {
	/** Words the catalogue writes in lower case somewhere: ordinary words. */
	lower: ReadonlySet<string>;
	/** Words a summary capitalises mid-sentence: names, keyed lower-case. */
	named: ReadonlySet<string>;
}

/**
 * The catalogue's vocabulary: every word written in lower case in a title, summary, skill or
 * category, and every word a summary capitalises inside a sentence (a name). A title's capitals
 * prove nothing on their own — its first word is always one.
 */
export function vocabularyOf(items: readonly CatalogueText[]): Vocabulary {
	const lower = new Set<string>();
	const named = new Set<string>();
	const addLower = (text: string) => {
		for (const word of wordsOf(text)) if (isLower(word)) lower.add(word);
	};
	for (const item of items) {
		addLower(item.title);
		for (const skill of item.skills ?? []) addLower(skill.label);
		if (typeof item.category === "string") addLower(item.category);
		for (const sentence of (item.summary ?? "").split(SENTENCE_END)) {
			const words = wordsOf(sentence);
			words.forEach((word, i) => {
				if (isLower(word)) lower.add(word);
				else if (i > 0 && !isAcronym(word)) named.add(word.toLowerCase());
			});
		}
	}
	return { lower, named };
}

/** An ordinary word: lower case as written, or a capital the catalogue also writes in lower case and never as a name. */
function isOrdinary(word: string, vocabulary: Vocabulary): boolean {
	if (isLower(word)) return true;
	if (isAcronym(word)) return false;
	const key = word.toLowerCase();
	return vocabulary.lower.has(key) && !vocabulary.named.has(key);
}
// #endregion

// #region Terms
/** Same term, ignoring case and spacing. */
function sameTerm(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** `terms` without blanks and case-insensitive repeats, in order. */
export function uniqueTerms(terms: Iterable<string>): string[] {
	const out: string[] = [];
	for (const raw of terms) {
		const term = raw.trim().replace(/\s+/g, " ");
		if (term && !out.some((kept) => sameTerm(kept, term))) out.push(term);
	}
	return out;
}

/**
 * A generic search read off a listing title, or `null`: the title's lead phrase (cut at a dash, a
 * colon or a joining word), then its first run of two or more ordinary words, at most three — a name
 * or an acronym breaks the run, so "Verdant brand refresh" reads "brand refresh" and "Aurora UI kit"
 * gives nothing. Lower case, at most {@link TERM_CHARS_MAX} characters.
 */
export function termFromTitle(title: string, vocabulary: Vocabulary): string | null {
	const head = title.split(TITLE_CUT)[0] ?? "";
	let run: string[] = [];
	for (const word of wordsOf(head)) {
		if (isOrdinary(word, vocabulary)) {
			run.push(word.toLowerCase());
			if (run.length === TERM_WORDS_MAX) break;
		} else if (run.length >= TERM_WORDS_MIN) {
			break;
		} else {
			run = [];
		}
	}
	if (run.length < TERM_WORDS_MIN) return null;
	const term = run.join(" ");
	return term.length <= TERM_CHARS_MAX ? term : null;
}

/**
 * Candidate typewriter terms from the recommended services and projects, interleaved so neither
 * kind crowds out the other, de-duplicated and capped at {@link HERO_TERM_CANDIDATES_MAX}. Products
 * are left out with the picker's Products option (#281 flag k).
 */
export function candidateTerms(
	recommended: RecommendedTitles | null,
	vocabulary: Vocabulary,
): string[] {
	if (!recommended) return [];
	const { services, projects } = recommended;
	const terms: string[] = [];
	for (let i = 0; i < Math.max(services.length, projects.length); i++) {
		for (const item of [services[i], projects[i]]) {
			const term = item ? termFromTitle(item.title, vocabulary) : null;
			if (term) terms.push(term);
		}
	}
	return uniqueTerms(terms).slice(0, HERO_TERM_CANDIDATES_MAX);
}

/** The terms of `candidates` the typeahead hits across every category, in order, at most `max`. */
function confirmed(read: SuggestRead, candidates: readonly string[], max: number): string[] {
	if (max <= 0) return [];
	return candidates.filter((q) => read({ q, scope: "all" }).hits.length > 0).slice(0, max);
}

/**
 * The typewriter's examples (`[U2]`): the confirmed {@link candidateTerms}, topped up from
 * {@link FALLBACK_TERMS} (each confirmed the same way) while fewer than {@link HERO_TERMS_MIN}
 * survive; at most {@link HERO_TERMS_MAX}. Empty keeps the typewriter off.
 */
export function heroTerms(
	recommended: RecommendedTitles | null,
	vocabulary: Vocabulary,
	read: SuggestRead,
): string[] {
	const derived = confirmed(read, candidateTerms(recommended, vocabulary), HERO_TERMS_MAX);
	if (derived.length >= HERO_TERMS_MIN) return derived;
	const extra = FALLBACK_TERMS.filter((term) => !derived.some((kept) => sameTerm(kept, term)));
	return [...derived, ...confirmed(read, extra, HERO_TERMS_MAX - derived.length)];
}

/**
 * The "Try:" chips (`[U3]`): the trending terms, else the typewriter terms; at most
 * {@link HERO_CHIPS_MAX}. Empty omits the row (known at render, so nothing shifts).
 */
export function heroChips(trending: readonly string[], terms: readonly string[]): string[] {
	const live = uniqueTerms(trending);
	return (live.length > 0 ? live : uniqueTerms(terms)).slice(0, HERO_CHIPS_MAX);
}

/** The whole {@link LandingHero} from the catalogue's text, its recommended titles and its typeahead. */
export function landingHeroFrom(
	items: readonly CatalogueText[],
	recommended: RecommendedTitles | null,
	read: SuggestRead,
): LandingHero {
	const trending = uniqueTerms(read({ q: "", scope: "all" }).trending);
	const terms = heroTerms(recommended, vocabularyOf(items), read);
	return { terms, trending, chips: heroChips(trending, terms) };
}
// #endregion
