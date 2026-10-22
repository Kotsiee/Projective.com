import type { EmojiCategoryId, EmojiDataset, EmojiEntry } from "./emoji-data.ts";

// #region Vocabulary
/**
 * Feeling words people type that the CLDR tags spell differently. A query term also matches any of
 * its synonyms, scored below a direct hit so the literal match still leads.
 */
const SENTIMENT_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
	happy: ["joy", "smile", "grin", "glad", "cheerful"],
	glad: ["happy", "smile"],
	sad: ["unhappy", "cry", "frown", "disappointed", "sorrow"],
	crying: ["cry", "tear", "sob"],
	cry: ["crying", "tear", "sob"],
	upset: ["sad", "frown", "angry"],
	angry: ["anger", "mad", "rage", "furious", "annoyed"],
	mad: ["angry", "rage"],
	love: ["heart", "adore", "kiss", "affection"],
	laugh: ["lol", "haha", "joy", "funny"],
	lol: ["laugh", "haha", "joy"],
	funny: ["laugh", "lol", "haha"],
	party: ["celebration", "celebrate", "tada", "confetti"],
	celebrate: ["party", "celebration", "tada"],
	congrats: ["celebration", "party", "tada", "congratulations"],
	thanks: ["pray", "please", "grateful", "thank"],
	yes: ["thumbs", "ok", "check", "approve"],
	ok: ["thumbs", "check", "okay"],
	no: ["cross", "prohibited", "thumbs"],
	scared: ["fear", "fearful", "afraid", "scream", "anxious"],
	tired: ["sleepy", "sleep", "yawn", "weary"],
	sick: ["ill", "nauseated", "vomit", "sneeze"],
	cool: ["sunglasses"],
	wow: ["astonished", "surprise", "shocked"],
	surprised: ["astonished", "surprise", "shocked", "wow"],
	think: ["thinking", "hmm"],
	fire: ["lit", "flame", "hot"],
};
// #endregion

// #region Scoring
const SCORE = {
	shortcodeExact: 1000,
	labelExact: 950,
	emoticonExact: 900,
	wordExact: 60,
	tagExact: 55,
	shortcodeWord: 50,
	wordPrefix: 40,
	tagPrefix: 35,
	synonym: 30,
	substring: 20,
	fuzzy: 10,
} as const;

/** Strip shortcode colons and collapse separators so `:thumbs_up:` and `thumbs up` read alike. */
export function normaliseEmojiQuery(query: string): string {
	return query.trim().toLowerCase().replace(/^:+|:+$/g, "").replace(/[\s_-]+/g, " ").trim();
}

/** Damerau-style distance capped at `max`; returns `max + 1` once exceeded. */
export function boundedEditDistance(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let prev2: number[] = [];
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, prev2[j - 2] + 1);
			}
			row.push(value);
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > max) return max + 1;
		prev2 = prev;
		prev = row;
	}
	return prev[b.length];
}

function fuzzyMatches(term: string, candidate: string): boolean {
	if (term.length < 4 || candidate.length < 3) return false;
	const max = term.length >= 7 ? 2 : 1;
	return boundedEditDistance(term, candidate, max) <= max;
}

/** The best score one query term earns against one entry; 0 when it does not match at all. */
function scoreTerm(entry: EmojiEntry, term: string): number {
	const codeWords = entry.shortcodeWords;
	if (entry.words.includes(term)) return SCORE.wordExact;
	if (entry.tags.includes(term)) return SCORE.tagExact;
	if (codeWords.includes(term)) return SCORE.shortcodeWord;
	if (entry.words.some((w) => w.startsWith(term))) return SCORE.wordPrefix;
	if (entry.tags.some((t) => t.startsWith(term)) || codeWords.some((c) => c.startsWith(term))) {
		return SCORE.tagPrefix;
	}
	const synonyms = SENTIMENT_SYNONYMS[term];
	if (synonyms?.some((s) => entry.words.includes(s) || entry.tags.includes(s))) {
		return SCORE.synonym;
	}
	if (term.length >= 3 && entry.label.toLowerCase().includes(term)) return SCORE.substring;
	const vocabulary = [...entry.words, ...entry.tags];
	if (vocabulary.some((candidate) => fuzzyMatches(term, candidate))) return SCORE.fuzzy;
	return 0;
}

/**
 * Score one entry against a normalised query. Every term must match (AND); whole-query hits on a
 * shortcode, the label or an emoticon outrank any per-term sum.
 */
export function scoreEmoji(entry: EmojiEntry, normalised: string, raw: string): number {
	if (!normalised && !raw.trim()) return 0;
	if (raw.trim() && entry.emoticons.includes(raw.trim())) return SCORE.emoticonExact;
	if (!normalised) return 0;
	const underscored = normalised.replace(/ /g, "_");
	if (entry.shortcodes.includes(underscored)) return SCORE.shortcodeExact;
	if (entry.label.toLowerCase() === normalised) return SCORE.labelExact;

	let total = 0;
	for (const term of normalised.split(" ")) {
		const score = scoreTerm(entry, term);
		if (score === 0) return 0;
		total += score;
	}
	return total;
}
// #endregion

// #region Search
/**
 * Rank the dataset against a query, best first, ties in Unicode order. `category` narrows the
 * results to one category. An empty query returns no results; browsing is the caller's job.
 */
export function searchEmoji(
	dataset: EmojiDataset,
	query: string,
	category: EmojiCategoryId | null = null,
): EmojiEntry[] {
	const normalised = normaliseEmojiQuery(query);
	if (!normalised && !query.trim()) return [];
	const pool = category ? dataset.byCategory.get(category) ?? [] : dataset.entries;
	const scored: { entry: EmojiEntry; score: number }[] = [];
	for (const entry of pool) {
		const score = scoreEmoji(entry, normalised, query);
		if (score > 0) scored.push({ entry, score });
	}
	scored.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
	return scored.map((s) => s.entry);
}
// #endregion
