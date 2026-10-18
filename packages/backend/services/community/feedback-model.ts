import {
	FEEDBACK_FILTER_STATE,
	FEEDBACK_PUBLIC_STATES,
	FEEDBACK_STATES,
	FEEDBACK_STATUS_FILTERS,
	type FeedbackAuthor,
	type FeedbackCategory,
	type FeedbackIdea,
	type FeedbackIdeaDoorRow,
	type FeedbackIdeaRow,
	FeedbackIdeaRowSchema,
	type FeedbackIdeaState,
	type FeedbackSort,
	type FeedbackStatusCounts,
	type FeedbackStatusEvent,
	type FeedbackStatusEventRow,
	FeedbackStatusEventRowSchema,
	type FeedbackStatusFilter,
} from "@projective/types/community";
import { defineCommunityTable } from "./community-source.ts";

/**
 * feedback-model — the feedback board's pure half (Decision #272): the two table mappers, and every
 * rule the service applies to records on BOTH roads — the order, the title search, the tab counts,
 * the related ideas and the mapping onto the shape the API speaks. Nothing here reads the gate, a
 * client or the clock; the service and the fixture store pass all three in.
 */

// #region Records
/** One idea as the service handles it — the row, camelCased, with its id (never sent to a client). */
export interface FeedbackIdeaRecord {
	id: string;
	slug: string;
	title: string;
	impact: string;
	body: string | null;
	category: FeedbackCategory;
	status: FeedbackIdeaState;
	authorId: string | null;
	voteCount: number;
	teamResponse: string | null;
	teamResponseAt: string | null;
	createdAt: string;
	updatedAt: string;
	statusChangedAt: string;
	archivedAt: string | null;
}

/** One status-history row. `from` is `null` for the submission. */
export interface FeedbackStatusEventRecord {
	id: string;
	ideaId: string;
	from: FeedbackIdeaState | null;
	to: FeedbackIdeaState;
	at: string;
}

function ideaToRow(r: FeedbackIdeaRecord): FeedbackIdeaRow {
	return {
		id: r.id,
		slug: r.slug,
		title: r.title,
		impact: r.impact,
		body: r.body,
		category: r.category,
		status: r.status,
		author_id: r.authorId,
		vote_count: r.voteCount,
		team_response: r.teamResponse,
		team_response_at: r.teamResponseAt,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
		status_changed_at: r.statusChangedAt,
		archived_at: r.archivedAt,
	};
}

/** Row → record for `community.feedback_ideas` (also the door answers' row half). */
export function ideaFromRow(row: FeedbackIdeaRow): FeedbackIdeaRecord {
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		impact: row.impact,
		body: row.body,
		category: row.category,
		status: row.status,
		authorId: row.author_id,
		voteCount: row.vote_count,
		teamResponse: row.team_response,
		teamResponseAt: row.team_response_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		statusChangedAt: row.status_changed_at,
		archivedAt: row.archived_at,
	};
}

/** `community.feedback_ideas`, declared once for the live read and the fixture road. */
export const FEEDBACK_IDEAS_TABLE = defineCommunityTable<FeedbackIdeaRow, FeedbackIdeaRecord>({
	table: "community.feedback_ideas",
	key: ["id"],
	row: FeedbackIdeaRowSchema,
	toRow: ideaToRow,
	fromRow: ideaFromRow,
});

/** `community.feedback_status_events`, as a client role may read it. */
export const FEEDBACK_EVENTS_TABLE = defineCommunityTable<
	FeedbackStatusEventRow,
	FeedbackStatusEventRecord
>({
	table: "community.feedback_status_events",
	key: ["id"],
	row: FeedbackStatusEventRowSchema,
	toRow: (r) => ({
		id: r.id,
		idea_id: r.ideaId,
		from_status: r.from,
		to_status: r.to,
		created_at: r.at,
	}),
	fromRow: (row) => ({
		id: row.id,
		ideaId: row.idea_id,
		from: row.from_status,
		to: row.to_status,
		at: row.created_at,
	}),
});

/** A door's answer split into the record and the caller's vote. */
export function ideaFromDoorRow(row: FeedbackIdeaDoorRow): {
	record: FeedbackIdeaRecord;
	viewerVoted: boolean;
} {
	const { viewer_voted, ...rest } = row;
	return { record: ideaFromRow(rest), viewerVoted: viewer_voted };
}
// #endregion

// #region Which states a query reads
/** Every state the board lists (Archived never is). */
export const FEEDBACK_BOARD_STATES: readonly FeedbackIdeaState[] = FEEDBACK_STATES.filter((s) =>
	s !== "archived"
);

/** The states one tab reads, or — with no tab — every state on the board. */
export function feedbackStatesFor(filter: FeedbackStatusFilter | undefined): FeedbackIdeaState[] {
	return filter ? [FEEDBACK_FILTER_STATE[filter]] : [...FEEDBACK_BOARD_STATES];
}
// #endregion

// #region Order
/**
 * The board's order. `top`: most votes, then newest; `new`: newest first. Ties end on the slug, so
 * the order is total and both roads (and a re-render) agree.
 */
export function sortFeedbackIdeas<
	T extends Pick<FeedbackIdeaRecord, "voteCount" | "createdAt" | "slug">,
>(
	records: readonly T[],
	sort: FeedbackSort,
): T[] {
	return [...records].sort((a, b) => {
		if (sort === "top" && a.voteCount !== b.voteCount) return b.voteCount - a.voteCount;
		const at = Date.parse(b.createdAt) - Date.parse(a.createdAt);
		if (at !== 0) return at;
		return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
	});
}
// #endregion

// #region Title search — the composer's "already suggested?" list
/** Words too common to tell two ideas apart. */
const STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"from",
	"that",
	"this",
	"into",
	"when",
	"let",
	"can",
	"add",
	"able",
	"have",
	"more",
	"our",
	"you",
	"your",
	"not",
	"all",
	"any",
	"are",
	"but",
	"was",
	"its",
	"out",
	"get",
]);

/** At most this many words reach the query, so a pasted paragraph stays one bounded `or()`. */
export const FEEDBACK_SEARCH_TOKENS_MAX = 6;

/**
 * The words of a title search worth matching on: letters and digits only (so a token can never
 * carry PostgREST filter syntax), three characters or more, lowercased, de-duplicated, stopwords
 * dropped, at most {@link FEEDBACK_SEARCH_TOKENS_MAX}.
 */
export function feedbackSearchTokens(q: string | undefined): string[] {
	if (!q) return [];
	const out: string[] = [];
	for (const match of q.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
		const word = match[0];
		if (word.length < 3 || STOPWORDS.has(word) || out.includes(word)) continue;
		out.push(word);
		if (out.length === FEEDBACK_SEARCH_TOKENS_MAX) break;
	}
	return out;
}

/** How many of `tokens` the title contains — the live query's `title.ilike` test, counted. */
export function feedbackSearchScore(title: string, tokens: readonly string[]): number {
	const haystack = title.toLowerCase();
	return tokens.reduce((n, token) => n + (haystack.includes(token) ? 1 : 0), 0);
}

/**
 * The ideas a title search returns: any token in the title, best match first (more words in common,
 * then more votes, then newest).
 */
export function rankFeedbackSearch<T extends FeedbackIdeaRecord>(
	records: readonly T[],
	tokens: readonly string[],
): T[] {
	if (tokens.length === 0) return [...records];
	const scored = records
		.map((record) => ({ record, score: feedbackSearchScore(record.title, tokens) }))
		.filter((s) => s.score > 0);
	const byTop = sortFeedbackIdeas(scored.map((s) => s.record), "top");
	const rank = new Map(byTop.map((r, i) => [r.id, i]));
	return scored
		.sort((a, b) => b.score - a.score || rank.get(a.record.id)! - rank.get(b.record.id)!)
		.map((s) => s.record);
}
// #endregion

// #region Counts
/** Tab counts from how many visible ideas sit in each stored state. `all` is the board's total. */
export function feedbackCountsFrom(
	byState: Partial<Record<FeedbackIdeaState, number>>,
): FeedbackStatusCounts {
	const counts = {} as Record<FeedbackStatusFilter, number>;
	for (const filter of FEEDBACK_STATUS_FILTERS) {
		const n = byState[FEEDBACK_FILTER_STATE[filter]] ?? 0;
		counts[filter] = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
	}
	const all = FEEDBACK_STATUS_FILTERS.reduce((sum, f) => sum + counts[f], 0);
	return { all, ...counts };
}

/** Tab counts over a set of records the reader can see. */
export function feedbackCountsOf(records: readonly Pick<FeedbackIdeaRecord, "status">[]) {
	const byState: Partial<Record<FeedbackIdeaState, number>> = {};
	for (const r of records) byState[r.status] = (byState[r.status] ?? 0) + 1;
	return feedbackCountsFrom(byState);
}

/**
 * Parse `community.feedback_status_counts()` (a `{ state: n }` object). Anything that is not a known
 * state with a numeric count is ignored rather than trusted.
 */
export function feedbackCountsFromRpc(data: unknown): FeedbackStatusCounts {
	const byState: Partial<Record<FeedbackIdeaState, number>> = {};
	if (data && typeof data === "object" && !Array.isArray(data)) {
		for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
			if ((FEEDBACK_STATES as readonly string[]).includes(key) && typeof value === "number") {
				byState[key as FeedbackIdeaState] = value;
			}
		}
	}
	return feedbackCountsFrom(byState);
}
// #endregion

// #region Related ideas and history
/** How many related ideas an idea's page lists. */
export const FEEDBACK_RELATED_MAX = 3;

/** Up to three public ideas in the same category, most voted first, never the idea itself. */
export function relatedFeedbackIdeas<T extends FeedbackIdeaRecord>(
	records: readonly T[],
	idea: Pick<FeedbackIdeaRecord, "id" | "category">,
	limit = FEEDBACK_RELATED_MAX,
): T[] {
	const pool = records.filter((r) =>
		r.id !== idea.id && r.category === idea.category && FEEDBACK_PUBLIC_STATES.includes(r.status)
	);
	return sortFeedbackIdeas(pool, "top").slice(0, limit);
}

/** An idea's history, oldest first, as the API speaks it. */
export function feedbackHistoryOf(
	events: readonly FeedbackStatusEventRecord[],
): FeedbackStatusEvent[] {
	return [...events]
		.sort((a, b) =>
			Date.parse(a.at) - Date.parse(b.at) || Number(a.from !== null) - Number(b.from !== null)
		)
		.map((e) => ({ from: e.from, to: e.to, at: e.at }));
}
// #endregion

// #region The API shape
/** What {@link toFeedbackIdea} needs besides the record. */
export interface FeedbackIdeaContext {
	/** The reader's user id, or `null` for a guest. */
	viewerId: string | null;
	/** The ids of the ideas the reader has voted for. */
	voted: ReadonlySet<string>;
	/** Author cards keyed by user id; an absent key renders as no author. */
	authors: ReadonlyMap<string, FeedbackAuthor>;
}

/** A record as the board speaks it — addressed by slug, with the reader's own facts folded in. */
export function toFeedbackIdea(record: FeedbackIdeaRecord, ctx: FeedbackIdeaContext): FeedbackIdea {
	return {
		slug: record.slug,
		title: record.title,
		impact: record.impact,
		body: record.body,
		category: record.category,
		status: record.status,
		author: record.authorId ? ctx.authors.get(record.authorId) ?? null : null,
		isOwn: ctx.viewerId !== null && record.authorId === ctx.viewerId,
		voteCount: record.voteCount,
		viewerVoted: ctx.voted.has(record.id),
		teamResponse: record.teamResponse,
		teamResponseAt: record.teamResponseAt,
		createdAt: record.createdAt,
		statusChangedAt: record.statusChangedAt,
	};
}
// #endregion
