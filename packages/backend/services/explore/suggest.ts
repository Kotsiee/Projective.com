import { compareRecommended, inCategory } from "./query.ts";
import type {
	ExploreCategory,
	ExploreEntity,
	ExploreItem,
	SuggestHandle,
	SuggestHit,
	Suggestions,
	SuggestQuery,
	SuggestTerm,
} from "@projective/types/explore";

/**
 * Explore — the pure typeahead selectors behind `ExploreBackendService.suggest`.
 *
 * Matching is by PREFIX, not substring: a reader typing "bra" expects "Brand refresh", not "Zebra
 * print". Every list is ranked phrase-prefix → word-prefix → anywhere-in-the-listing, then by the same
 * {@link compareRecommended} the results page sorts with, so the top hit is what the search would also
 * put first. Deterministic: `now` is a parameter.
 */

// #region Limits
const HITS_PER_TYPE = 2;
const HITS_ISOLATED = 6;
const HITS_MAX = 8;
const TERMS_MAX = 5;
const HANDLES_MAX = 4;
const TRENDING_MAX = 6;
const TRENDING_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
// #endregion

// #region Vocabulary
const PROFILE_TYPES: ReadonlySet<ExploreEntity> = new Set([
	"users",
	"freelancers",
	"teams",
	"businesses",
]);

/** Listing types in the Search-Results section order, so the panel reads like the page it opens. */
const HIT_ORDER: ExploreEntity[] = ["services", "products", "projects", "articles"];

const NO_RANK = Number.POSITIVE_INFINITY;
// #endregion

// #region Matching
function words(text: string): string[] {
	return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Every query term prefixes at least one of `pool`'s words. */
function everyTermPrefixes(terms: string[], pool: string[]): boolean {
	return terms.every((t) => pool.some((w) => w.startsWith(t)));
}

/** 0 phrase prefix · 1 every term prefixes a word of `text` · 2 of `wider` · ∞ no match. */
function rankText(text: string, wider: string, q: string, terms: string[]): number {
	if (text.toLowerCase().startsWith(q)) return 0;
	if (everyTermPrefixes(terms, words(text))) return 1;
	if (wider && everyTermPrefixes(terms, words(`${text} ${wider}`))) return 2;
	return NO_RANK;
}

function capitalise(label: string): string {
	return label[0].toUpperCase() + label.slice(1);
}

/** The listing categories and skill labels an item carries, keyed lower-case. */
function termsOf(item: ExploreItem): Map<string, { label: string; kind: SuggestTerm["kind"] }> {
	const out = new Map<string, { label: string; kind: SuggestTerm["kind"] }>();
	if ("category" in item && typeof item.category === "string" && item.category.trim()) {
		const label = item.category.trim();
		out.set(label.toLowerCase(), { label: capitalise(label), kind: "category" });
	}
	for (const s of item.skills) {
		const label = s.label.trim();
		if (label && !out.has(label.toLowerCase())) {
			out.set(label.toLowerCase(), { label: capitalise(label), kind: "skill" });
		}
	}
	return out;
}
// #endregion

// #region Sections
function topHits(
	scoped: readonly ExploreItem[],
	scope: ExploreCategory,
	q: string,
	terms: string[],
): SuggestHit[] {
	const ranked = scoped
		.filter((it) => !PROFILE_TYPES.has(it.type))
		.map((it) => ({
			it,
			rank: rankText(
				it.title,
				[it.owner.name, ...it.skills.map((s) => s.label)].join(" "),
				q,
				terms,
			),
		}))
		.filter((r) => r.rank !== NO_RANK)
		.sort((a, b) => a.rank - b.rank || compareRecommended(a.it, b.it));

	const perType = scope === "all" ? HITS_PER_TYPE : HITS_ISOLATED;
	const hits: SuggestHit[] = [];
	for (const type of HIT_ORDER) {
		for (const { it } of ranked.filter((r) => r.it.type === type).slice(0, perType)) {
			hits.push({
				id: it.id,
				type: it.type,
				title: it.title,
				ownerName: it.owner.name,
				ownerHandle: it.owner.handle,
				media: it.media || undefined,
			});
		}
	}
	return hits.slice(0, HITS_MAX);
}

function matchedHandles(
	scoped: readonly ExploreItem[],
	scope: ExploreCategory,
	q: string,
	terms: string[],
): SuggestHandle[] {
	if (scope !== "all" && !PROFILE_TYPES.has(scope)) return [];
	const handleQuery = q.startsWith("@") ? q.slice(1) : null;
	if (handleQuery === "" || (handleQuery === null && terms.length === 0)) return [];
	const ranked = scoped
		.filter((it) => PROFILE_TYPES.has(it.type))
		.map((it) => {
			const bare = it.owner.handle.replace(/^@/, "").toLowerCase();
			const rank = handleQuery !== null
				? (bare.startsWith(handleQuery) ? 0 : NO_RANK)
				: bare.startsWith(q)
				? 0
				: rankText(it.owner.name, "", q, terms);
			return { it, rank };
		})
		.filter((r) => r.rank !== NO_RANK)
		.sort((a, b) => a.rank - b.rank || compareRecommended(a.it, b.it));

	const out: SuggestHandle[] = [];
	const seen = new Set<string>();
	for (const { it } of ranked) {
		if (seen.has(it.owner.handle)) continue;
		seen.add(it.owner.handle);
		out.push({
			handle: it.owner.handle,
			name: it.owner.name,
			avatar: it.owner.avatar,
			kind: it.owner.kind,
			verified: it.owner.verified,
		});
		if (out.length >= HANDLES_MAX) break;
	}
	return out;
}

function tally(items: readonly ExploreItem[]) {
	const counts = new Map<string, SuggestTerm>();
	for (const it of items) {
		for (const [key, t] of termsOf(it)) {
			const entry = counts.get(key);
			if (entry) entry.count++;
			else counts.set(key, { ...t, count: 1 });
		}
	}
	return counts;
}

function matchedTerms(scoped: readonly ExploreItem[], q: string, terms: string[]): SuggestTerm[] {
	return [...tally(scoped).values()]
		.map((t) => ({ t, rank: rankText(t.label, "", q, terms) }))
		.filter((r) => r.rank !== NO_RANK)
		.sort((a, b) => a.rank - b.rank || b.t.count - a.t.count || a.t.label.localeCompare(b.t.label))
		.slice(0, TERMS_MAX)
		.map((r) => r.t);
}

/**
 * The typeahead's Trending terms, in three tiers, each topping up the one before:
 * 1. the skills and categories of the catalogue's TRENDING items in scope (`trendingIds`, most active
 *    first: distinct people who opened or saved them over the last week), so the dropdown agrees
 *    with the Home "Trending" rail — ties keep the rail's order;
 * 2. the terms most LISTED in scope over the last {@link TRENDING_WINDOW_DAYS} days;
 * 3. the all-time counts.
 * A quiet platform has no trending items, and the list then degrades to what sellers publish.
 */
export function trendingTerms(
	scoped: readonly ExploreItem[],
	now: number,
	trendingIds: readonly string[] = [],
	limit = TRENDING_MAX,
): string[] {
	const byId = new Map(scoped.map((it) => [it.id, it]));
	const active = trendingIds
		.map((id) => byId.get(id))
		.filter((it): it is ExploreItem => it !== undefined);
	const since = now - TRENDING_WINDOW_DAYS * DAY_MS;
	const recent = scoped.filter((it) => {
		const at = Date.parse(it.createdAt);
		return Number.isFinite(at) && at >= since;
	});
	const byActivity = [...tally(active).values()].sort((a, b) => b.count - a.count);
	const order = (m: Map<string, SuggestTerm>) =>
		[...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	const out: string[] = [];
	const seen = new Set<string>();
	for (const t of [...byActivity, ...order(tally(recent)), ...order(tally(scoped))]) {
		const key = t.label.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(t.label);
		if (out.length >= limit) break;
	}
	return out;
}
// #endregion

/**
 * Compose the typeahead answer for `query` over the live corpus; `trendingIds` is the catalogue's
 * trending item list, most active first.
 */
export function suggestFrom(
	corpus: readonly ExploreItem[],
	query: SuggestQuery,
	now: number,
	trendingIds: readonly string[] = [],
): Suggestions {
	const q = query.q.trim().toLowerCase();
	const scoped = corpus.filter((it) => inCategory(it, query.scope));
	if (!q) {
		return {
			q: "",
			scope: query.scope,
			hits: [],
			terms: [],
			handles: [],
			trending: trendingTerms(scoped, now, trendingIds),
		};
	}
	const terms = words(q);
	const listings = terms.length > 0 && !q.startsWith("@");
	return {
		q: query.q.trim(),
		scope: query.scope,
		hits: listings ? topHits(scoped, query.scope, q, terms) : [],
		terms: listings ? matchedTerms(scoped, q, terms) : [],
		handles: matchedHandles(scoped, query.scope, q, terms),
		trending: [],
	};
}
