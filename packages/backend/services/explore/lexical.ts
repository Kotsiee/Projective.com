import type { ExploreItem } from "@projective/types/explore";

/**
 * lexical — how well an item matches the words typed (the "Best match" text term). Pure.
 *
 * A field-weighted BM25 (BM25F) over exactly the fields the discovery text filter reads
 * (`query.ts` `matchesQuery`), so it can only reorder what the filter admitted and never changes the
 * result set:
 *
 * ```
 * x(t)     = Σ_field  weight × credit(t) / (1 − b + b × length / mean length)
 * fields   = Σ_t idf(t) × x(t) / (k1 + x(t))  ÷  Σ_t idf(t)               ∈ [0, 1)
 * title    = Σ_t idf(t) × best credit of t in the title  ÷  Σ_t idf(t)    ∈ [0, 1]
 * phrase   = the longest stretch of the words, in the order typed, in the title (as a share of the
 *            query), or TAG_PHRASE_CREDIT × the same inside one tag label; a stretch is ≥ 2 words
 *            unless the query is one word
 * lexical  = (1 − TITLE_SHARE − PHRASE_SHARE) × fields + TITLE_SHARE × title + PHRASE_SHARE × phrase
 * ```
 *
 * A word's `credit` in a field is 1 per exact word and {@link PREFIX_CREDIT} per word it begins
 * ("brand" in "branding"); a word only found inside another ("sign" in "design") earns nothing.
 * `idf` is BM25's rarity weight over the corpus handed in. Stop words are not scored unless the query
 * is nothing but stop words, which then scores its own words. An item whose title IS the query
 * ({@link LexicalScorer.exactTitle}) is the caller's to put first.
 */

// #region Dials
/** The fields a match is scored in, strongest first. */
export const LEXICAL_FIELDS = ["title", "tags", "summary", "owner"] as const;

/** One scored field: `tags` is the skill labels plus the listing category, `owner` its name and handle. */
export type LexicalField = typeof LEXICAL_FIELDS[number];

/** How much one matching word counts in each field (title > tags > summary > owner). */
export const FIELD_WEIGHT: Readonly<Record<LexicalField, number>> = Object.freeze({
	title: 3,
	tags: 2,
	summary: 1,
	owner: 0.5,
});

/** BM25's `b` per field: how far a longer-than-average field dilutes a match (0 = not at all). */
export const FIELD_LENGTH_NORM: Readonly<Record<LexicalField, number>> = Object.freeze({
	title: 0.3,
	tags: 0.5,
	summary: 0.75,
	owner: 0.3,
});

/** BM25's `k1`: how quickly repeating a word stops adding. */
export const TERM_SATURATION = 1.2;

/** The credit for a word that begins a longer word, against 1 for the word itself. */
export const PREFIX_CREDIT = 0.5;

/** The shortest query word that earns prefix credit; shorter words must match whole. */
export const PREFIX_MIN_LENGTH = 2;

/** The share of the score carried by how many of the words typed (by rarity) the title holds. */
export const TITLE_SHARE = 0.35;

/** The share of the score carried by the words appearing in the order typed. */
export const PHRASE_SHARE = 0.15;

/** The phrase credit for the words, in order, inside one skill or category label, against 1 in the title. */
export const TAG_PHRASE_CREDIT = 0.5;

/** Words too common to say anything about a match. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"in",
	"into",
	"is",
	"it",
	"me",
	"my",
	"of",
	"on",
	"or",
	"our",
	"the",
	"to",
	"with",
	"your",
]);
// #endregion

// #region Words
const MARKS = /\p{M}+/gu;
const SEPARATOR = /[^\p{L}\p{N}]+/u;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const ASCII_SEPARATOR = /[^a-z0-9]+/;

/** Lower-case, accent-free words of `text`, in order. */
export function wordsOf(text: string): string[] {
	if (PRINTABLE_ASCII.test(text)) return text.toLowerCase().split(ASCII_SEPARATOR).filter(Boolean);
	return text.normalize("NFKD").replace(MARKS, "").toLowerCase().split(SEPARATOR).filter(Boolean);
}

const ES_PLURAL = /(?:ch|sh|x|ss|z)es$/;

/**
 * Fold a word's plural onto its singular so "logos" matches "logo" ("agencies" → "agency",
 * "sketches" → "sketch").
 */
export function foldWord(word: string): string {
	if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
	if (word.length > 4 && ES_PLURAL.test(word)) return word.slice(0, -2);
	if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
	return word;
}

const isContent = (word: string): boolean => !STOP_WORDS.has(word);
// #endregion

// #region Documents
interface Doc {
	fields: Readonly<Record<LexicalField, readonly string[]>>;
	titleAll: readonly string[];
	titleContent: readonly string[];
	tagLabels: readonly (readonly string[])[];
}

const DOCS = new WeakMap<ExploreItem, Doc>();

function tagLabelsOf(item: ExploreItem): string[] {
	const labels = item.skills.map((s) => s.label);
	if ("category" in item && typeof item.category === "string") labels.push(item.category);
	return labels;
}

function docOf(item: ExploreItem): Doc {
	const cached = DOCS.get(item);
	if (cached) return cached;
	const titleWords = wordsOf(item.title);
	const tagLabels = tagLabelsOf(item).map((label) => wordsOf(label).map(foldWord));
	const doc: Doc = {
		fields: {
			title: titleWords.map(foldWord),
			tags: tagLabels.flat(),
			summary: wordsOf(item.summary).map(foldWord),
			owner: wordsOf(`${item.owner.name} ${item.owner.handle}`).map(foldWord),
		},
		titleAll: titleWords.map(foldWord),
		titleContent: titleWords.filter(isContent).map(foldWord),
		tagLabels,
	};
	DOCS.set(item, doc);
	return doc;
}

interface CorpusIndex {
	size: number;
	meanLength: Readonly<Record<LexicalField, number>>;
	postings: ReadonlyMap<string, readonly number[]>;
}

const INDEXES = new WeakMap<readonly ExploreItem[], CorpusIndex>();

function indexOf(corpus: readonly ExploreItem[]): CorpusIndex {
	const cached = INDEXES.get(corpus);
	if (cached) return cached;
	const totals: Record<LexicalField, number> = { title: 0, tags: 0, summary: 0, owner: 0 };
	const postings = new Map<string, number[]>();
	corpus.forEach((item, i) => {
		const doc = docOf(item);
		for (const field of LEXICAL_FIELDS) {
			totals[field] += doc.fields[field].length;
			for (const word of doc.fields[field]) {
				const list = postings.get(word);
				if (!list) postings.set(word, [i]);
				else if (list[list.length - 1] !== i) list.push(i);
			}
		}
	});
	const n = Math.max(1, corpus.length);
	const index: CorpusIndex = {
		size: corpus.length,
		meanLength: {
			title: totals.title / n || 1,
			tags: totals.tags / n || 1,
			summary: totals.summary / n || 1,
			owner: totals.owner / n || 1,
		},
		postings,
	};
	INDEXES.set(corpus, index);
	return index;
}
// #endregion

// #region Query
/** A query as the scorer reads it. */
export interface LexicalQuery {
	/** Every word, folded, in order — what an exact title is compared with. */
	all: readonly string[];
	/** The scored words in order (stop words dropped, unless that leaves none). */
	sequence: readonly string[];
	/** {@link sequence} without repeats. */
	terms: readonly string[];
	/** Every word is a stop word, so {@link sequence} keeps them. */
	stopWordsOnly: boolean;
}

/** Read a typed query into its words; `null` when it holds no word at all. */
export function parseLexicalQuery(q: string): LexicalQuery | null {
	const words = wordsOf(q);
	if (words.length === 0) return null;
	const content = words.filter(isContent);
	const stopWordsOnly = content.length === 0;
	const sequence = (stopWordsOnly ? words : content).map(foldWord);
	return { all: words.map(foldWord), sequence, terms: [...new Set(sequence)], stopWordsOnly };
}

function credit(word: string, term: string): number {
	if (word === term) return 1;
	return term.length >= PREFIX_MIN_LENGTH && word.startsWith(term) ? PREFIX_CREDIT : 0;
}

function documentFrequency(index: CorpusIndex, term: string): number {
	if (term.length < PREFIX_MIN_LENGTH) return index.postings.get(term)?.length ?? 0;
	const docs = new Set<number>();
	for (const [word, list] of index.postings) {
		if (word.startsWith(term)) { for (const i of list) docs.add(i); }
	}
	return docs.size;
}

function idf(index: CorpusIndex, term: string): number {
	const df = documentFrequency(index, term);
	return Math.log(1 + (index.size - df + 0.5) / (df + 0.5));
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((word, i) => word === b[i]);
}

function longestRun(words: readonly string[], sequence: readonly string[]): number {
	let best = 0;
	for (let i = 0; i < words.length; i++) {
		for (let j = 0; j < sequence.length; j++) {
			let k = 0;
			while (i + k < words.length && j + k < sequence.length && words[i + k] === sequence[j + k]) {
				k++;
			}
			if (k > best) best = k;
		}
	}
	return best;
}

function phraseShare(words: readonly string[], sequence: readonly string[]): number {
	if (sequence.length === 0) return 0;
	const run = longestRun(words, sequence);
	return run >= Math.min(2, sequence.length) ? run / sequence.length : 0;
}
// #endregion

// #region Scorer
/** One query's scorer over one corpus. */
export interface LexicalScorer {
	/** How well `item` matches the query, 0 (not by any word) to 1. */
	score(item: ExploreItem): number;
	/** Whether `item`'s title is exactly the query (case, accents, punctuation and plurals aside). */
	exactTitle(item: ExploreItem): boolean;
}

/**
 * Build the scorer for `q` against `corpus` (the population word rarity is measured over). `null`
 * when `q` holds no word, so the caller keeps its own order.
 */
export function lexicalScorer(corpus: readonly ExploreItem[], q: string): LexicalScorer | null {
	const query = parseLexicalQuery(q);
	if (!query) return null;
	const index = indexOf(corpus);
	const rarity = query.terms.map((term) => ({ term, idf: idf(index, term) }));
	const totalIdf = rarity.reduce((sum, r) => sum + r.idf, 0);

	return {
		score(item) {
			if (totalIdf <= 0) return 0;
			const doc = docOf(item);
			let fields = 0;
			let title = 0;
			for (const { term, idf: weight } of rarity) {
				let x = 0;
				let best = 0;
				for (const field of LEXICAL_FIELDS) {
					const words = doc.fields[field];
					let tf = 0;
					for (const word of words) {
						const c = credit(word, term);
						tf += c;
						if (field === "title" && c > best) best = c;
					}
					if (tf === 0) continue;
					const b = FIELD_LENGTH_NORM[field];
					x += FIELD_WEIGHT[field] * tf / (1 - b + b * words.length / index.meanLength[field]);
				}
				fields += weight * x / (TERM_SATURATION + x);
				title += weight * best;
			}
			const titleWords = query.stopWordsOnly ? doc.titleAll : doc.titleContent;
			let phrase = phraseShare(titleWords, query.sequence);
			for (const label of doc.tagLabels) {
				phrase = Math.max(phrase, TAG_PHRASE_CREDIT * phraseShare(label, query.sequence));
			}
			return (1 - TITLE_SHARE - PHRASE_SHARE) * fields / totalIdf +
				TITLE_SHARE * title / totalIdf + PHRASE_SHARE * phrase;
		},
		exactTitle(item) {
			return sameWords(docOf(item).titleAll, query.all);
		},
	};
}

/** `items` with every exact title match for `q` moved to the front, each group in its own order. */
export function exactTitlesFirst<T extends ExploreItem>(items: readonly T[], q: string): T[] {
	const query = parseLexicalQuery(q);
	if (!query) return [...items];
	const exact: T[] = [];
	const rest: T[] = [];
	for (const item of items) (sameWords(docOf(item).titleAll, query.all) ? exact : rest).push(item);
	return [...exact, ...rest];
}
// #endregion
