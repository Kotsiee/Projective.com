import { z } from "zod";
import { slugPattern } from "../slugs/slug.ts";
import { timestamp, uuid } from "./common.ts";
import {
	FEEDBACK_SORTS,
	FEEDBACK_STATUS_FILTERS,
	type FeedbackSort,
	type FeedbackStatusFilter,
} from "./feedback-constants.ts";

/**
 * community.feedback — the Zod SSOT for the public feedback board (P7, Decision #272): the three
 * tables of `00000025` region `[feedback]`, the shapes `/api/feedback/ideas*` speaks, and the board's
 * status vocabulary.
 *
 * An idea stores a UNIFIED-machine state (PRODUCT_MANAGEMENT.md §3.1 / §3.9), never a bespoke one:
 * `backlog` (shown "Under review", visible only to its author and operators), `ready` ("Planned"),
 * `in_progress` ("In progress"), `complete` ("Shipped") and `archived` (terminal, hidden). The label
 * differs from the stored state; the state does not (owner ruling (d), 2026-10-17). The URL speaks the
 * labels' slugs (`?status=under_review|planned|in_progress|shipped`), mapped here once.
 *
 * Every rule that also lives in SQL is stated here value for value — the states and categories (the
 * tables' CHECKs), the length bounds and rate limits (the doors in `00001320`), the legal moves
 * (`community.fn_feedback_move_legal`) and visibility (the SELECT policies of `00002021`) — and
 * `feedback.contract.test.ts` reads the migrations to pin each one.
 */

// #region States
/** The stored states, in lifecycle order. */
export const FEEDBACK_STATES = ["backlog", "ready", "in_progress", "complete", "archived"] as const;

/** One stored state of an idea. */
export const FeedbackIdeaStateSchema = z.enum(FEEDBACK_STATES);
export type FeedbackIdeaState = z.infer<typeof FeedbackIdeaStateSchema>;

/** The board's label for each stored state (also `community.fn_feedback_state_label`). */
export const FEEDBACK_STATE_LABEL: Readonly<Record<FeedbackIdeaState, string>> = {
	backlog: "Under review",
	ready: "Planned",
	in_progress: "In progress",
	complete: "Shipped",
	archived: "Archived",
};

/** The states anyone may read, guests included. */
export const FEEDBACK_PUBLIC_STATES: readonly FeedbackIdeaState[] = [
	"ready",
	"in_progress",
	"complete",
];

/** The states an idea takes votes in; voting closes once it ships or is archived. */
export const FEEDBACK_VOTABLE_STATES: readonly FeedbackIdeaState[] = [
	"backlog",
	"ready",
	"in_progress",
];

/**
 * The legal moves of the idea lifecycle (`community.fn_feedback_move_legal`). They use the unified
 * machine's states but not all of its §3.2 edges: an idea has no claimant and no deliverable, so
 * Ready → In progress skips Claimed, In progress → Shipped skips Review, and Ready → Backlog ("sent
 * back for review") has no §3.2 edge at all — flagged for the owner in Decision #272 (l). Archived
 * is terminal and non-reopenable, and a shipped idea can only be archived — a regression is a new idea.
 */
export const FEEDBACK_MOVES: Readonly<Record<FeedbackIdeaState, readonly FeedbackIdeaState[]>> = {
	backlog: ["ready", "archived"],
	ready: ["backlog", "in_progress", "archived"],
	in_progress: ["ready", "complete", "archived"],
	complete: ["archived"],
	archived: [],
};

/** Whether an operator may move an idea from `from` to `to`. */
export function isLegalFeedbackMove(from: FeedbackIdeaState, to: FeedbackIdeaState): boolean {
	return FEEDBACK_MOVES[from].includes(to);
}

/** Whether an idea in `state` still takes votes. */
export function isFeedbackVotable(state: FeedbackIdeaState): boolean {
	return FEEDBACK_VOTABLE_STATES.includes(state);
}
// #endregion

// #region Board filters
// The lists themselves live in the Zod-free `./feedback-constants.ts` (the drawer host reads them).
export { FEEDBACK_SORTS, FEEDBACK_STATUS_FILTERS, type FeedbackSort, type FeedbackStatusFilter };

/** One status tab. */
export const FeedbackStatusFilterSchema = z.enum(FEEDBACK_STATUS_FILTERS);

/** The stored state each status tab shows. */
export const FEEDBACK_FILTER_STATE: Readonly<Record<FeedbackStatusFilter, FeedbackIdeaState>> = {
	under_review: "backlog",
	planned: "ready",
	in_progress: "in_progress",
	shipped: "complete",
};

/** The tab a stored state is listed under, or `null` for Archived (never on the board). */
export function feedbackFilterOf(state: FeedbackIdeaState): FeedbackStatusFilter | null {
	const hit = FEEDBACK_STATUS_FILTERS.find((f) => FEEDBACK_FILTER_STATE[f] === state);
	return hit ?? null;
}

/** The board's orders: most votes first, or newest first. */
export const FeedbackSortSchema = z.enum(FEEDBACK_SORTS);
// #endregion

// #region Categories
/** What an idea is about — `feedback_ideas_category_check`, value for value. */
export const FEEDBACK_CATEGORIES = [
	"projects",
	"escrow_payments",
	"messaging",
	"profiles",
	"teams",
	"explore",
	"other",
] as const;

/** One category. */
export const FeedbackCategorySchema = z.enum(FEEDBACK_CATEGORIES);
export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>;

/** The words each category reads as. */
export const FEEDBACK_CATEGORY_LABEL: Readonly<Record<FeedbackCategory, string>> = {
	projects: "Projects",
	escrow_payments: "Escrow & payments",
	messaging: "Messaging",
	profiles: "Profiles",
	teams: "Teams",
	explore: "Explore",
	other: "Other",
};
// #endregion

// #region Bounds
/** A title of 6 to 90 characters (the door's bounds; the column allows mask headroom). */
export const FEEDBACK_TITLE_MIN = 6;
export const FEEDBACK_TITLE_MAX = 90;
/** "What problem does this solve?" — 10 to 600 characters. */
export const FEEDBACK_IMPACT_MIN = 10;
export const FEEDBACK_IMPACT_MAX = 600;
/** Optional details, at most 4,000 characters. */
export const FEEDBACK_BODY_MAX = 4000;
/** The team's official response, at most 2,000 characters. */
export const FEEDBACK_RESPONSE_MAX = 2000;
/** An operator's note on a status move, at most 1,000 characters. */
export const FEEDBACK_NOTE_MAX = 1000;
/** Ideas one person may suggest per rolling 24 hours. */
export const FEEDBACK_IDEAS_PER_DAY = 5;
/** New votes one person may cast per rolling hour. */
export const FEEDBACK_VOTES_PER_HOUR = 120;
// #endregion

// #region Visibility
/** Who is reading — the facts visibility turns on. */
export interface FeedbackViewer {
	/** The signed-in reader's user id, or `null` for a guest. */
	userId: string | null;
	/** Whether the reader is a platform operator (`ops.admin_users`). */
	isOperator: boolean;
}

/**
 * Whether `viewer` may see an idea — the same rule the SELECT policies (`00002021`) and
 * `community.fn_feedback_idea_visible` state: the public states to everyone, an idea under review to
 * its author, and everything (Archived included) to an operator. The fixture road filters with this.
 */
export function canSeeFeedbackIdea(
	idea: { status: FeedbackIdeaState; authorId: string | null },
	viewer: FeedbackViewer,
): boolean {
	if (viewer.isOperator) return true;
	if (FEEDBACK_PUBLIC_STATES.includes(idea.status)) return true;
	return idea.status === "backlog" && idea.authorId !== null && idea.authorId === viewer.userId;
}
// #endregion

// #region Rows
/** An idea's opaque `fbk-` address. */
export const FeedbackIdeaSlugSchema = z.string().regex(
	slugPattern("idea"),
	"Expected an idea address.",
);

/** `community.feedback_ideas` as a client role may read it (never `pii_categories`, `team_response_by`). */
export const FeedbackIdeaRowSchema = z.object({
	id: uuid,
	slug: FeedbackIdeaSlugSchema,
	title: z.string(),
	impact: z.string(),
	body: z.string().nullable(),
	category: FeedbackCategorySchema,
	status: FeedbackIdeaStateSchema,
	author_id: uuid.nullable(),
	vote_count: z.number().int().nonnegative(),
	team_response: z.string().nullable(),
	team_response_at: timestamp.nullable(),
	created_at: timestamp,
	updated_at: timestamp,
	status_changed_at: timestamp,
	archived_at: timestamp.nullable(),
});
export type FeedbackIdeaRow = z.infer<typeof FeedbackIdeaRowSchema>;

/** The client-readable columns of an idea, in the order the live read selects them. */
export const FEEDBACK_IDEA_COLUMNS = Object.keys(FeedbackIdeaRowSchema.shape) as ReadonlyArray<
	keyof FeedbackIdeaRow
>;

/** What every idea door answers (`community.fn_feedback_idea_json`): the row plus the caller's vote. */
export const FeedbackIdeaDoorRowSchema = FeedbackIdeaRowSchema.extend({
	viewer_voted: z.boolean(),
});
export type FeedbackIdeaDoorRow = z.infer<typeof FeedbackIdeaDoorRowSchema>;

/** `community.feedback_votes` — one vote per person per idea. */
export const FeedbackVoteRowSchema = z.object({
	idea_id: uuid,
	user_id: uuid,
	created_at: timestamp,
});
export type FeedbackVoteRow = z.infer<typeof FeedbackVoteRowSchema>;

/** `community.feedback_status_events` as a client role may read it (never `actor_id`, `note`). */
export const FeedbackStatusEventRowSchema = z.object({
	id: uuid,
	idea_id: uuid,
	from_status: FeedbackIdeaStateSchema.nullable(),
	to_status: FeedbackIdeaStateSchema,
	created_at: timestamp,
});
export type FeedbackStatusEventRow = z.infer<typeof FeedbackStatusEventRowSchema>;

/** What `vote_feedback_idea` / `unvote_feedback_idea` answer. */
export const FeedbackVoteDoorResultSchema = z.object({
	voted: z.boolean(),
	vote_count: z.number().int().nonnegative(),
});
// #endregion

// #region The board, as the API speaks it
/** An idea's author as the board shows them. */
export const FeedbackAuthorSchema = z.object({
	handle: z.string(),
	name: z.string(),
	/** The small avatar URL, or `null` for the initials picture. */
	avatar: z.string().nullable(),
});
export type FeedbackAuthor = z.infer<typeof FeedbackAuthorSchema>;

/** One idea on the board. Addressed by its slug; the row id never leaves the server. */
export const FeedbackIdeaSchema = z.object({
	slug: FeedbackIdeaSlugSchema,
	title: z.string(),
	impact: z.string(),
	body: z.string().nullable(),
	category: FeedbackCategorySchema,
	status: FeedbackIdeaStateSchema,
	/** `null` when the author's account is gone, or their profile is not visible to the reader. */
	author: FeedbackAuthorSchema.nullable(),
	/** Whether the reader suggested it. */
	isOwn: z.boolean(),
	voteCount: z.number().int().nonnegative(),
	viewerVoted: z.boolean(),
	teamResponse: z.string().nullable(),
	teamResponseAt: timestamp.nullable(),
	createdAt: timestamp,
	statusChangedAt: timestamp,
});
export type FeedbackIdea = z.infer<typeof FeedbackIdeaSchema>;

/** One row of an idea's status history. `from` is `null` for the submission. */
export const FeedbackStatusEventSchema = z.object({
	from: FeedbackIdeaStateSchema.nullable(),
	to: FeedbackIdeaStateSchema,
	at: timestamp,
});
export type FeedbackStatusEvent = z.infer<typeof FeedbackStatusEventSchema>;

/** How many ideas the reader can see under each tab, and in all of them. */
export const FeedbackStatusCountsSchema = z.object({
	all: z.number().int().nonnegative(),
	under_review: z.number().int().nonnegative(),
	planned: z.number().int().nonnegative(),
	in_progress: z.number().int().nonnegative(),
	shipped: z.number().int().nonnegative(),
});
export type FeedbackStatusCounts = z.infer<typeof FeedbackStatusCountsSchema>;

/** `GET /api/feedback/ideas` query. Without `status`, every tab's ideas (the roadmap). */
export const FeedbackBoardQuerySchema = z.object({
	status: FeedbackStatusFilterSchema.optional(),
	sort: FeedbackSortSchema.default("top"),
	/** A title search — the composer's "already suggested?" list. */
	q: z.string().trim().max(FEEDBACK_TITLE_MAX).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(60),
});
export type FeedbackBoardQuery = z.infer<typeof FeedbackBoardQuerySchema>;

/** `GET /api/feedback/ideas` — the board as the reader may see it. */
export const FeedbackBoardSchema = z.object({
	ideas: z.array(FeedbackIdeaSchema),
	counts: FeedbackStatusCountsSchema,
	viewer: z.object({ signedIn: z.boolean() }),
	/** The instant the board was read, so every "3 days ago" renders the same on server and client. */
	now: timestamp,
});
export type FeedbackBoard = z.infer<typeof FeedbackBoardSchema>;

/** `GET /api/feedback/ideas/[id]` — one idea, its history and its neighbours. */
export const FeedbackIdeaDetailSchema = z.object({
	idea: FeedbackIdeaSchema,
	history: z.array(FeedbackStatusEventSchema),
	related: z.array(FeedbackIdeaSchema),
	now: timestamp,
});
export type FeedbackIdeaDetail = z.infer<typeof FeedbackIdeaDetailSchema>;

/** `POST /api/feedback/ideas` body. */
export const FeedbackIdeaCreateSchema = z.object({
	title: z.string().trim()
		.min(FEEDBACK_TITLE_MIN, `Give the idea a title of at least ${FEEDBACK_TITLE_MIN} characters.`)
		.max(FEEDBACK_TITLE_MAX, `Keep the title to ${FEEDBACK_TITLE_MAX} characters.`),
	category: FeedbackCategorySchema,
	impact: z.string().trim()
		.min(FEEDBACK_IMPACT_MIN, "Say what problem this solves, in a sentence or two.")
		.max(FEEDBACK_IMPACT_MAX, `Keep this to ${FEEDBACK_IMPACT_MAX} characters.`),
	body: z.string().trim().max(FEEDBACK_BODY_MAX, `Keep the details under 4,000 characters.`)
		.optional(),
});
export type FeedbackIdeaCreate = z.infer<typeof FeedbackIdeaCreateSchema>;

/** `POST|DELETE /api/feedback/ideas/[id]/vote` answer. */
export const FeedbackVoteResultSchema = z.object({
	voted: z.boolean(),
	voteCount: z.number().int().nonnegative(),
});
export type FeedbackVoteResult = z.infer<typeof FeedbackVoteResultSchema>;

/** `POST /api/feedback/ideas/[id]/status` body — an operator's move, and the response if any. */
export const FeedbackModerationSchema = z.object({
	status: FeedbackIdeaStateSchema.optional(),
	note: z.string().trim().max(FEEDBACK_NOTE_MAX).optional(),
	/** The team's response; an empty string clears it. Omitted, it is left as it is. */
	response: z.string().trim().max(FEEDBACK_RESPONSE_MAX).optional(),
}).refine((v) => v.status !== undefined || v.response !== undefined, {
	message: "Change the status, the response, or both.",
});
export type FeedbackModeration = z.infer<typeof FeedbackModerationSchema>;
// #endregion
