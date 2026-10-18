import type { SupabaseClient } from "supabaseClient";
import { containsPii } from "@projective/types/comms";
import {
	canSeeFeedbackIdea,
	FEEDBACK_IDEA_COLUMNS,
	FEEDBACK_PUBLIC_STATES,
	type FeedbackAuthor,
	type FeedbackBoard,
	type FeedbackBoardQuery,
	type FeedbackIdea,
	type FeedbackIdeaCreate,
	type FeedbackIdeaDetail,
	FeedbackIdeaDoorRowSchema,
	type FeedbackModeration,
	type FeedbackViewer,
	FeedbackVoteDoorResultSchema,
	type FeedbackVoteResult,
} from "@projective/types/community";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import { fetchProfileCards, profileKey } from "../profile/live-follows.ts";
import {
	communityDb,
	communityRpc,
	type CommunitySource,
	communitySource,
	readCommunityTable,
} from "./community-source.ts";
import {
	FEEDBACK_BOARD_STATES,
	FEEDBACK_EVENTS_TABLE,
	FEEDBACK_IDEAS_TABLE,
	FEEDBACK_RELATED_MAX,
	FEEDBACK_SEARCH_POOL,
	feedbackCountsFromRpc,
	feedbackCountsOf,
	feedbackHistoryOf,
	type FeedbackIdeaRecord,
	feedbackSearchScore,
	feedbackSearchTokens,
	feedbackStatesFor,
	ideaFromDoorRow,
	rankFeedbackSearch,
	relatedFeedbackIdeas,
	sortFeedbackIdeas,
	toFeedbackIdea,
} from "./feedback-model.ts";
import {
	feedbackDemoAuthor,
	feedbackStoreEvents,
	feedbackStoreIdeas,
	type FeedbackStoreRefusal,
	feedbackStoreSubmit,
	feedbackStoreVote,
	feedbackStoreVotedIds,
	fixtureUserId,
} from "./feedback-store.ts";

/**
 * FeedbackBackendService — the public feedback board (`/feedback` and the `?feedback=open` drawer,
 * Decision #272): read the board and one idea, suggest an idea, vote, and an operator's moves.
 *
 * It decides nothing the database does not. Visibility is RLS (00002021): a guest reads the public
 * board with the anon client, a member reads it AS themselves, so their own ideas under review
 * appear and nobody else's do. Every write is a definer door (00001320 [community.feedback]) that
 * stamps the actor, screens the text and rate-limits; this service adds only the Tier 1 contact-detail
 * refusal of Decision #147 (C) — public copy is refused field-named rather than silently masked —
 * and maps each door's SQLSTATE onto a status.
 *
 * Gated by `COMMUNITY_BACKEND_LIVE`. With it off, the same code path runs over the fixture store
 * (`feedback-store.ts`), which mirrors every door's rules, so the board behaves identically.
 */

// #region Plumbing
/** What a caller may pin (tests). */
export interface FeedbackServiceOptions {
	/** The road to take instead of the gate's. */
	source?: CommunitySource;
	/** "Now", for the fixture road's clock and every "3 days ago". */
	now?: Date;
	/** The client a live read runs as, instead of the actor's own (tests stub the database here). */
	client?: () => SupabaseClient;
}

const IDEA_COLUMNS = FEEDBACK_IDEA_COLUMNS.join(",");
const EVENT_COLUMNS = "id,idea_id,from_status,to_status,created_at";

/** The client a read runs as: the member's own JWT, or anon for a guest. */
function readerClient(actor: ReadActor): SupabaseClient {
	return actor.accessToken ? getUserClient(actor.accessToken) : getAnonClient();
}

/** The PostgREST error shape a door refusal arrives in. */
interface DoorError {
	code?: string;
	message?: string;
	details?: string | null;
}

/** The field a `22023` refusal names (`"title: …"`), and its sentence. */
function fieldOf(message: string): { field: string; text: string } | null {
	const match = /^([a-z_]+): (.+)$/s.exec(message);
	return match ? { field: match[1], text: match[2] } : null;
}

/** A door's refusal (SQLSTATE + message) onto a ServiceResult. */
function doorRefusal<T>(error: DoorError): ServiceResult<T> {
	const message = error.message ?? "That couldn't be done just now.";
	switch (error.code) {
		case "28000":
			return fail(401, { message: "Sign in to continue." });
		case "42501":
			return fail(403, { message });
		case "22023": {
			const field = fieldOf(message);
			return field
				? fail(422, { message: field.text, errors: { [field.field]: field.text } })
				: fail(422, { message });
		}
		case "P0002":
			return fail(404, { message: "That idea isn't on the board." });
		case "55000":
			return fail(409, { message });
		case "PR429":
			return fail(429, { message, details: { retryAt: error.details ?? null } });
		case "23503":
			return fail(403, { message: "Finish setting up your account to take part." });
		default:
			return fail(503, {
				message: "The feedback board is unavailable right now. Please try again shortly.",
				details: { code: error.code ?? null },
			});
	}
}

/** A fixture-store refusal onto the same results the doors produce. */
function storeRefusal<T>(refusal: FeedbackStoreRefusal): ServiceResult<T> {
	switch (refusal.reason) {
		case "not_found":
			return fail(404, { message: "That idea isn't on the board." });
		case "voting_closed":
			return fail(409, { message: "Voting has closed on this idea." });
		case "rate_limited":
			return fail(429, {
				message: "You've reached the limit for now. Try again later.",
				details: { retryAt: refusal.retryAt },
			});
	}
}

/** Author cards for `ids`, by user id. A read failure leaves the ideas unattributed, never failed. */
async function authorsFor(
	ids: readonly (string | null)[],
	source: CommunitySource,
	client: () => SupabaseClient,
): Promise<Map<string, FeedbackAuthor>> {
	const unique = [...new Set(ids.filter((id): id is string => !!id))];
	const out = new Map<string, FeedbackAuthor>();
	if (unique.length === 0) return out;
	if (source === "fixture") {
		for (const id of unique) {
			const card = feedbackDemoAuthor(id);
			if (card) out.set(id, card);
		}
		return out;
	}
	try {
		const cards = await fetchProfileCards(client(), unique.map((id) => ({ type: "user", id })));
		for (const id of unique) {
			const card = cards.get(profileKey("user", id));
			if (card) out.set(id, { handle: card.handle, name: card.name, avatar: card.avatar });
		}
	} catch {
		// An unattributed idea still reads; the board must not fail on a profile lookup.
	}
	return out;
}

/** Which of `ids` the reader voted for. A failed lookup reads as "none" — the vote doors are idempotent. */
async function votedFor(
	viewerId: string | null,
	ids: readonly string[],
	source: CommunitySource,
	client: () => SupabaseClient,
	now: number,
): Promise<Set<string>> {
	if (!viewerId || ids.length === 0) return new Set();
	if (source === "fixture") return feedbackStoreVotedIds(viewerId, ids, now);
	const { data, error } = await communityDb(client()).from("feedback_votes").select("idea_id")
		.eq("user_id", viewerId).in("idea_id", [...ids]);
	if (error || !Array.isArray(data)) return new Set();
	return new Set((data as { idea_id: string }[]).map((row) => row.idea_id));
}

/** Fold the reader's facts into a page of records. */
async function present(
	records: readonly FeedbackIdeaRecord[],
	viewerId: string | null,
	source: CommunitySource,
	client: () => SupabaseClient,
	now: number,
): Promise<FeedbackIdea[]> {
	const [voted, authors] = await Promise.all([
		votedFor(viewerId, records.map((r) => r.id), source, client, now),
		authorsFor(records.map((r) => r.authorId), source, client),
	]);
	return records.map((r) => toFeedbackIdea(r, { viewerId, voted, authors }));
}

/**
 * Who the reader is on a road: their user id (`null` for a guest) and — on the fixture road, where no
 * operator exists — never an operator. A fixture-road id that is not a uuid (a development stub
 * session) is folded onto a stable uuid, so the store's rows still parse as the table's.
 */
function viewerOf(actor: ReadActor, source: CommunitySource): FeedbackViewer {
	if (!actor.userId) return { userId: null, isOperator: false };
	return {
		userId: source === "fixture" ? fixtureUserId(actor.userId) : actor.userId,
		isOperator: false,
	};
}
// #endregion

export class FeedbackBackendService {
	/**
	 * The board as the reader may see it: one tab's ideas (or every tab's, with no `status`), in the
	 * asked order, the counts behind every tab, and — with `q` — the title search the composer's
	 * "already suggested?" list reads. 503 when the database is unreachable.
	 */
	static async board(
		query: FeedbackBoardQuery,
		actor: ReadActor,
		opts: FeedbackServiceOptions = {},
	): Promise<ServiceResult<FeedbackBoard>> {
		const source = opts.source ?? communitySource();
		const now = opts.now ?? new Date();
		const client = opts.client ?? (() => readerClient(actor));
		const viewer = viewerOf(actor, source);
		const states = feedbackStatesFor(query.status);
		const tokens = feedbackSearchTokens(query.q);
		const searching = query.q !== undefined;
		const fixtures = source === "fixture" ? feedbackStoreIdeas(now.getTime()) : [];

		const [read, counts] = await Promise.all([
			searching && tokens.length === 0
				? Promise.resolve(ok({ records: [] as FeedbackIdeaRecord[], source }))
				: readCommunityTable(FEEDBACK_IDEAS_TABLE, {
					client,
					source,
					live: (db) => {
						let q = db.from("feedback_ideas").select(IDEA_COLUMNS).in("status", states);
						if (tokens.length) q = q.or(tokens.map((t) => `title.ilike.*${t}*`).join(","));
						if (query.sort === "top") q = q.order("vote_count", { ascending: false });
						// A search ranks by words in common, which the database cannot order by: read a
						// bounded pool, rank it below, and only then take the asked limit.
						return q.order("created_at", { ascending: false })
							.limit(tokens.length ? Math.max(query.limit, FEEDBACK_SEARCH_POOL) : query.limit);
					},
					fixtures,
					filter: (r) =>
						states.includes(r.status) && canSeeFeedbackIdea(r, viewer) &&
						(tokens.length === 0 || feedbackSearchScore(r.title, tokens) > 0),
				}),
			source === "fixture"
				? Promise.resolve(
					ok(feedbackCountsOf(
						fixtures.filter((r) =>
							FEEDBACK_BOARD_STATES.includes(r.status) && canSeeFeedbackIdea(r, viewer)
						),
					)),
				)
				: communityRpc(client(), "feedback_status_counts", {}).then(({ data, error }) =>
					error ? doorRefusal<ReturnType<typeof feedbackCountsFromRpc>>(error) : ok(
						feedbackCountsFromRpc(data),
					)
				),
		]);
		if (!read.ok || !read.data) return read as ServiceResult<never>;
		if (!counts.ok || !counts.data) return counts as ServiceResult<never>;

		const ordered = tokens.length
			? rankFeedbackSearch(read.data.records, tokens)
			: sortFeedbackIdeas(read.data.records, query.sort);
		const ideas = await present(
			ordered.slice(0, query.limit),
			viewer.userId,
			source,
			client,
			now.getTime(),
		);
		return ok({
			ideas,
			counts: counts.data,
			viewer: { signedIn: viewer.userId !== null },
			now: now.toISOString(),
		});
	}

	/** One idea, its status history (oldest first) and up to three related ideas; 404 when unseen. */
	static async idea(
		slug: string,
		actor: ReadActor,
		opts: FeedbackServiceOptions = {},
	): Promise<ServiceResult<FeedbackIdeaDetail>> {
		const source = opts.source ?? communitySource();
		const now = opts.now ?? new Date();
		const client = opts.client ?? (() => readerClient(actor));
		const viewer = viewerOf(actor, source);
		const fixtures = source === "fixture" ? feedbackStoreIdeas(now.getTime()) : [];

		const read = await readCommunityTable(FEEDBACK_IDEAS_TABLE, {
			client,
			source,
			live: (db) => db.from("feedback_ideas").select(IDEA_COLUMNS).eq("slug", slug).limit(1),
			fixtures,
			filter: (r) => r.slug === slug && canSeeFeedbackIdea(r, viewer),
		});
		if (!read.ok || !read.data) return read as ServiceResult<never>;
		const record = read.data.records[0];
		if (!record) return fail(404, { message: "That idea isn't on the board." });

		const [events, neighbours] = await Promise.all([
			readCommunityTable(FEEDBACK_EVENTS_TABLE, {
				client,
				source,
				live: (db) =>
					db.from("feedback_status_events").select(EVENT_COLUMNS).eq("idea_id", record.id)
						.order("created_at", { ascending: true }),
				fixtures: source === "fixture" ? feedbackStoreEvents(record.id, now.getTime()) : [],
			}),
			readCommunityTable(FEEDBACK_IDEAS_TABLE, {
				client,
				source,
				live: (db) =>
					db.from("feedback_ideas").select(IDEA_COLUMNS).eq("category", record.category)
						.in("status", [...FEEDBACK_PUBLIC_STATES]).neq("id", record.id)
						.order("vote_count", { ascending: false }).order("created_at", { ascending: false })
						.limit(FEEDBACK_RELATED_MAX),
				fixtures,
				filter: (r) => canSeeFeedbackIdea(r, viewer),
			}),
		]);
		if (!events.ok || !events.data) return events as ServiceResult<never>;
		if (!neighbours.ok || !neighbours.data) return neighbours as ServiceResult<never>;

		const related = relatedFeedbackIdeas(neighbours.data.records, record);
		const [idea, ...rest] = await present(
			[record, ...related],
			viewer.userId,
			source,
			client,
			now.getTime(),
		);
		return ok({
			idea,
			history: feedbackHistoryOf(events.data.records),
			related: rest,
			now: now.toISOString(),
		});
	}

	/**
	 * Suggest an idea. It enters Under review — visible to its author and operators only — with the
	 * author's own vote. A contact detail in any field is refused here, field by field (Decision #147
	 * (C)); the door masks whatever reaches it by another path.
	 */
	static async submit(
		input: FeedbackIdeaCreate,
		actor: ReadActor,
		opts: FeedbackServiceOptions = {},
	): Promise<ServiceResult<{ idea: FeedbackIdea }>> {
		const source = opts.source ?? communitySource();
		const now = opts.now ?? new Date();
		const viewer = viewerOf(actor, source);
		if (!viewer.userId || (source === "live" && !actor.accessToken)) {
			return fail(401, { message: "Sign in to suggest an idea." });
		}
		const errors: Record<string, string> = {};
		for (
			const [field, value] of Object.entries({
				title: input.title,
				impact: input.impact,
				body: input.body,
			})
		) {
			if (value && containsPii(value)) {
				errors[field] =
					"Ideas are public, so leave out email addresses, phone numbers and payment links.";
			}
		}
		if (Object.keys(errors).length > 0) {
			return fail(422, { message: "Remove the contact details and try again.", errors });
		}

		let record: FeedbackIdeaRecord;
		let viewerVoted: boolean;
		if (source === "fixture") {
			const result = feedbackStoreSubmit(input, viewer.userId, now.getTime());
			if (!result.ok) return storeRefusal(result.refusal);
			({ record, viewerVoted } = result.value);
		} else {
			const { data, error } = await communityRpc(
				getUserClient(actor.accessToken!),
				"submit_feedback_idea",
				{
					p_title: input.title,
					p_category: input.category,
					p_impact: input.impact,
					p_body: input.body ?? null,
				},
			);
			if (error) return doorRefusal(error as DoorError);
			const parsed = FeedbackIdeaDoorRowSchema.safeParse(data);
			if (!parsed.success) {
				return fail(502, { message: "Your idea was saved, but the board couldn't read it back." });
			}
			({ record, viewerVoted } = ideaFromDoorRow(parsed.data));
		}
		const client = () => readerClient(actor);
		const authors = await authorsFor([record.authorId], source, client);
		const idea = toFeedbackIdea(record, {
			viewerId: viewer.userId,
			voted: new Set(viewerVoted ? [record.id] : []),
			authors,
		});
		return ok({ idea }, {
			status: 201,
			message: "Thanks — your idea is in. New ideas appear on the board after review.",
		});
	}

	/** Vote (`voted: true`) or retract a vote. Idempotent: a repeat answers the same count. */
	static async vote(
		slug: string,
		voted: boolean,
		actor: ReadActor,
		opts: FeedbackServiceOptions = {},
	): Promise<ServiceResult<FeedbackVoteResult>> {
		const source = opts.source ?? communitySource();
		const now = opts.now ?? new Date();
		const viewer = viewerOf(actor, source);
		if (!viewer.userId || (source === "live" && !actor.accessToken)) {
			return fail(401, { message: "Sign in to vote." });
		}
		if (source === "fixture") {
			const result = feedbackStoreVote(
				slug,
				{ userId: viewer.userId, isOperator: false },
				voted,
				now.getTime(),
			);
			return result.ok ? ok(result.value) : storeRefusal(result.refusal);
		}
		const { data, error } = await communityRpc(
			getUserClient(actor.accessToken!),
			voted ? "vote_feedback_idea" : "unvote_feedback_idea",
			{ p_slug: slug },
		);
		if (error) return doorRefusal(error as DoorError);
		const parsed = FeedbackVoteDoorResultSchema.safeParse(data);
		if (!parsed.success) return fail(502, { message: "The vote couldn't be confirmed." });
		return ok({ voted: parsed.data.voted, voteCount: parsed.data.vote_count });
	}

	/**
	 * An operator's move and/or the team's response, in ONE transaction
	 * (`community.moderate_feedback_idea`, which runs `set_feedback_idea_status` then
	 * `respond_to_feedback_idea`): a refused response never leaves a status move — and its
	 * notifications — committed behind an error. 403 for anyone else — the doors check
	 * `security.is_admin()`; the fixture road has no operator, so it refuses everyone the same way.
	 */
	static async moderate(
		slug: string,
		input: FeedbackModeration,
		actor: ReadActor,
		opts: FeedbackServiceOptions = {},
	): Promise<ServiceResult<{ idea: FeedbackIdea }>> {
		const source = opts.source ?? communitySource();
		if (!actor.userId || (source === "live" && !actor.accessToken)) {
			return fail(401, { message: "Sign in to continue." });
		}
		if (source === "fixture") {
			return fail(403, { message: "Only a Projective operator can change an idea's status." });
		}
		const client = getUserClient(actor.accessToken!);
		const { data, error } = await communityRpc(client, "moderate_feedback_idea", {
			p_slug: slug,
			p_status: input.status ?? null,
			p_note: input.note ?? null,
			// `null` leaves the response as it is; an empty string clears it.
			p_response: input.response ?? null,
		});
		if (error) return doorRefusal(error as DoorError);
		const parsed = FeedbackIdeaDoorRowSchema.safeParse(data);
		if (!parsed.success) {
			return fail(502, { message: "The change was saved but couldn't be read back." });
		}
		const { record, viewerVoted } = ideaFromDoorRow(parsed.data);
		const authors = await authorsFor([record.authorId], source, () => client);
		return ok({
			idea: toFeedbackIdea(record, {
				viewerId: actor.userId,
				voted: new Set(viewerVoted ? [record.id] : []),
				authors,
			}),
		});
	}
}
