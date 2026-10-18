import { inlineText, nodesText } from "@projective/types/content/text";
import {
	HELP_CENTRE_QUERY_MAX,
	HELP_CENTRE_RESULT_LIMIT,
	type HelpCentreArticle,
	type HelpCentreHighlight,
	type HelpCentreSearchResult,
} from "@projective/types/editorial";
import { helpArticlePath, type HelpCentreLibrary } from "./help-library.ts";

/**
 * help-search.ts — the help centre's search: an in-memory index over the articles and the scoring
 * that ranks them (P2). Pure and dependency-free — no search library — so it runs identically on the
 * live rows and the fixture records, and every rule below is unit-tested (`help-search.test.ts`).
 *
 * ## Matching
 *
 * Text is folded the same way on both sides — Unicode-decomposed with diacritics stripped, lower-cased,
 * cut into runs of letters and digits — so `Résumé`, `resume` and `RESUME` are one term. Each query
 * word matches an indexed term as:
 *
 *   exact   the same term                                     × 1.0
 *   prefix  the term starts with the word (2+ characters)     × 0.75   ("escr" → escrow)
 *   typo    one edit away (two for 8+ letters), 4+ letters    × 0.5    ("escorw" → escrow)
 *
 * where an edit is an insertion, a deletion, a substitution or a swap of two neighbouring letters,
 * and a typo of a word still being typed is matched against the start of a longer term
 * ("witdraw" → withdrawal). Common words (`how`, `the`, `my` …) are ignored unless the query is
 * nothing else.
 *
 * ## Ranking
 *
 * Where a term appears weighs more than how often: title 8 · section headings (and the FAQ question)
 * 4 · summary 3 · category 2 · body 1. Every query word must match (AND); if no article matches
 * them all, articles matching some are returned, most words first. A multi-word query found as a
 * phrase in a title earns a bonus. Ties keep reading order (category, then article).
 */

// #region Text folding
/** Fold text for matching: decompose, drop combining marks, lower-case. */
export function foldText(text: string): string {
	return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** The words of `text`, folded (runs of letters and digits). */
export function tokenize(text: string): string[] {
	return foldText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Words a query ignores unless it holds nothing else. */
const STOPWORDS = new Set([
	"a",
	"about",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"can",
	"do",
	"does",
	"for",
	"from",
	"how",
	"i",
	"if",
	"in",
	"is",
	"it",
	"me",
	"my",
	"of",
	"on",
	"or",
	"so",
	"that",
	"the",
	"this",
	"to",
	"we",
	"what",
	"when",
	"where",
	"which",
	"who",
	"why",
	"will",
	"with",
	"you",
	"your",
]);

/** The query's meaningful words, in order, without repeats. */
export function queryTerms(query: string): string[] {
	const words = [...new Set(tokenize(query.slice(0, HELP_CENTRE_QUERY_MAX)))];
	const meaningful = words.filter((w) => !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)));
	return meaningful.length > 0 ? meaningful : words;
}
// #endregion

// #region Edit distance
/**
 * The optimal-string-alignment distance between `a` and `b` (insertions, deletions, substitutions,
 * adjacent swaps), or `limit + 1` as soon as it is certain to exceed `limit`.
 */
export function editDistance(a: string, b: string, limit: number): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	const rows: number[][] = [];
	for (let i = 0; i <= a.length; i++) {
		rows.push(new Array<number>(b.length + 1).fill(0));
		rows[i][0] = i;
	}
	for (let j = 0; j <= b.length; j++) rows[0][j] = j;
	for (let i = 1; i <= a.length; i++) {
		let rowMin = Number.MAX_SAFE_INTEGER;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, rows[i - 2][j - 2] + 1);
			}
			rows[i][j] = value;
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > limit) return limit + 1;
	}
	return rows[a.length][b.length];
}

/**
 * Whether `word` is one edit away from the START of `term` — a word still being typed with a slip in
 * it. The start is tried one letter shorter, as long and one letter longer than the word, because the
 * slip may have dropped or added a letter (`witdraw` is one edit from `withdraw`).
 */
function typoPrefix(word: string, term: string): boolean {
	for (const length of [word.length - 1, word.length, word.length + 1]) {
		if (length <= 0 || length > term.length) continue;
		if (editDistance(word, term.slice(0, length), 1) <= 1) return true;
	}
	return false;
}

/** How many edits a query word of this length may carry and still match. */
function typoAllowance(length: number): number {
	if (length >= 8) return 2;
	if (length >= 4) return 1;
	return 0;
}
// #endregion

// #region Index
/** The fields an article is indexed under, with their weights (see the module docblock). */
const FIELD_WEIGHT = { title: 8, headings: 4, summary: 3, category: 2, body: 1 } as const;
type Field = keyof typeof FIELD_WEIGHT;

/** One indexed article. */
interface IndexedArticle {
	article: HelpCentreArticle;
	categoryTitle: string;
	href: string;
	/** Folded title, for the phrase bonus. */
	foldedTitle: string;
	/** Summary then body, as sentences — where a snippet is cut from. */
	sentences: string[];
}

/** The search index over one library. Build it with {@link buildHelpSearchIndex}. */
export interface HelpSearchIndex {
	readonly entries: readonly IndexedArticle[];
	/** Every indexed term, sorted. */
	readonly vocabulary: readonly string[];
	/** term → (entry index → the best field weight it appears under). */
	readonly postings: ReadonlyMap<string, ReadonlyMap<number, number>>;
}

/** Split prose into sentences (a full stop, question or exclamation mark followed by a space). */
function sentencesOf(text: string): string[] {
	return text
		.split(/\n+/)
		.flatMap((line) => line.split(/(?<=[.!?])\s+/))
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** The text an article is indexed by, per field. */
function fieldsOf(article: HelpCentreArticle, categoryTitle: string): Record<Field, string> {
	const headings: string[] = [];
	const body: string[] = [];
	for (const section of article.sections) {
		headings.push(section.heading);
		for (const node of section.body) if (node.type === "h3") headings.push(node.text);
		if (section.tldr) body.push(inlineText(section.tldr));
		body.push(nodesText(section.body));
	}
	if (article.faq) headings.push(article.faq.question);
	return {
		title: article.title,
		headings: headings.join("\n"),
		summary: article.summary,
		category: categoryTitle,
		body: body.join("\n"),
	};
}

/** Index every article of a library. */
export function buildHelpSearchIndex(library: HelpCentreLibrary): HelpSearchIndex {
	const entries: IndexedArticle[] = [];
	const postings = new Map<string, Map<number, number>>();
	library.articles.forEach((article, index) => {
		const categoryTitle = library.categoryOf(article)?.title ?? article.category;
		const fields = fieldsOf(article, categoryTitle);
		entries.push({
			article,
			categoryTitle,
			href: helpArticlePath(article),
			foldedTitle: foldText(article.title),
			sentences: [...sentencesOf(article.summary), ...sentencesOf(fields.body)],
		});
		for (const field of Object.keys(FIELD_WEIGHT) as Field[]) {
			for (const term of tokenize(fields[field])) {
				let byEntry = postings.get(term);
				if (!byEntry) {
					byEntry = new Map();
					postings.set(term, byEntry);
				}
				byEntry.set(index, Math.max(byEntry.get(index) ?? 0, FIELD_WEIGHT[field]));
			}
		}
	});
	return Object.freeze({ entries, vocabulary: [...postings.keys()].sort(), postings });
}
// #endregion

// #region Matching and ranking
/** An indexed term a query word matched, and how closely. */
interface TermMatch {
	term: string;
	closeness: number;
}

/**
 * The index terms one query word matches (see the module docblock). Typos are a fallback: a word
 * that matches some term exactly or as a prefix is not also matched loosely, so a correctly spelt
 * word never drags in its one-letter neighbours (`fees` is not `feed`).
 */
export function matchTerm(index: HelpSearchIndex, word: string): TermMatch[] {
	const matches: TermMatch[] = [];
	for (const term of index.vocabulary) {
		if (term === word) matches.push({ term, closeness: 1 });
		else if (word.length >= 2 && term.startsWith(word)) matches.push({ term, closeness: 0.75 });
	}
	if (matches.length > 0) return matches;
	const allowance = typoAllowance(word.length);
	if (allowance === 0) return matches;
	for (const term of index.vocabulary) {
		if (editDistance(word, term, allowance) <= allowance) {
			matches.push({ term, closeness: 0.5 });
		} else if (word.length >= 5 && term.length > word.length && typoPrefix(word, term)) {
			matches.push({ term, closeness: 0.4 });
		}
	}
	return matches;
}

/** One ranked hit before it is shaped for the response. */
interface Hit {
	entry: number;
	score: number;
	matched: number;
	terms: Set<string>;
}

/** Rank the index's articles for `query`. */
function rank(index: HelpSearchIndex, query: string): Hit[] {
	const words = queryTerms(query);
	if (words.length === 0) return [];
	const perWord = words.map((word) => {
		const best = new Map<number, { score: number; terms: string[] }>();
		for (const { term, closeness } of matchTerm(index, word)) {
			for (const [entry, weight] of index.postings.get(term) ?? []) {
				const score = weight * closeness;
				const prior = best.get(entry);
				if (!prior) best.set(entry, { score, terms: [term] });
				else {
					prior.terms.push(term);
					if (score > prior.score) prior.score = score;
				}
			}
		}
		return best;
	});

	const hits = new Map<number, Hit>();
	for (const best of perWord) {
		for (const [entry, { score, terms }] of best) {
			const hit = hits.get(entry) ?? { entry, score: 0, matched: 0, terms: new Set<string>() };
			hit.score += score;
			hit.matched += 1;
			for (const term of terms) hit.terms.add(term);
			hits.set(entry, hit);
		}
	}

	const phrase = words.length > 1 ? words.join(" ") : null;
	for (const hit of hits.values()) {
		if (phrase && tokenize(index.entries[hit.entry].foldedTitle).join(" ").includes(phrase)) {
			hit.score += FIELD_WEIGHT.title;
		}
	}

	const all = [...hits.values()];
	const complete = all.filter((hit) => hit.matched === words.length);
	const chosen = complete.length > 0 ? complete : all;
	return chosen.sort((a, b) => b.matched - a.matched || b.score - a.score || a.entry - b.entry);
}
// #endregion

// #region Snippets and highlights
/** The longest snippet, in characters. */
export const SNIPPET_MAX = 180;

/** The `[start, end)` runs of `text`'s words whose folded form is in `terms`. */
export function highlightRuns(text: string, terms: ReadonlySet<string>): HelpCentreHighlight[] {
	const runs: HelpCentreHighlight[] = [];
	for (const match of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
		const word = match[0];
		const folded = tokenize(word);
		if (folded.length > 0 && folded.every((part) => terms.has(part))) {
			const start = match.index ?? 0;
			runs.push([start, start + word.length]);
		}
	}
	return runs;
}

/** Cut `sentence` to {@link SNIPPET_MAX} around its first highlighted word, on word boundaries. */
function window(sentence: string, terms: ReadonlySet<string>): string {
	if (sentence.length <= SNIPPET_MAX) return sentence;
	const first = highlightRuns(sentence, terms)[0]?.[0] ?? 0;
	let start = Math.max(0, first - 60);
	let end = Math.min(sentence.length, start + SNIPPET_MAX);
	start = Math.max(0, end - SNIPPET_MAX);
	if (start > 0) {
		const space = sentence.indexOf(" ", start);
		start = space >= 0 && space < first ? space + 1 : start;
	}
	if (end < sentence.length) {
		const space = sentence.lastIndexOf(" ", end);
		end = space > start ? space : end;
	}
	return `${start > 0 ? "…" : ""}${sentence.slice(start, end).trim()}${
		end < sentence.length ? "…" : ""
	}`;
}

/** The sentence a hit is shown with: the first that holds a matched word, else the summary. */
function snippetOf(entry: IndexedArticle, terms: ReadonlySet<string>): string {
	const sentence = entry.sentences.find((s) => highlightRuns(s, terms).length > 0);
	return window(sentence ?? entry.article.summary, terms);
}
// #endregion

// #region Search
/**
 * Search the index. An empty query (or one of no words) answers nothing; otherwise up to `limit`
 * hits, best first, each with its snippet and the runs to `<mark>` in its title and snippet.
 */
export function searchHelp(
	index: HelpSearchIndex,
	query: string,
	limit: number = HELP_CENTRE_RESULT_LIMIT,
): HelpCentreSearchResult[] {
	return rank(index, query).slice(0, limit).map((hit) => {
		const entry = index.entries[hit.entry];
		const snippet = snippetOf(entry, hit.terms);
		return {
			slug: entry.article.slug,
			title: entry.article.title,
			category: entry.article.category,
			categoryTitle: entry.categoryTitle,
			href: entry.href,
			snippet,
			highlights: {
				title: highlightRuns(entry.article.title, hit.terms),
				snippet: highlightRuns(snippet, hit.terms),
			},
		};
	});
}
// #endregion
