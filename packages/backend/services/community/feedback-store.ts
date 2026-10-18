import { maskPii } from "@projective/types/comms";
import {
	canSeeFeedbackIdea,
	FEEDBACK_IDEAS_PER_DAY,
	FEEDBACK_VOTES_PER_HOUR,
	type FeedbackAuthor,
	type FeedbackIdeaCreate,
	type FeedbackViewer,
	isFeedbackVotable,
} from "@projective/types/community";
import { mintSlug } from "@projective/types/slugs";
import { FEEDBACK_DEMO_IDEAS, FEEDBACK_DEMO_PEOPLE } from "./feedback-fixtures.ts";
import type { FeedbackIdeaRecord, FeedbackStatusEventRecord } from "./feedback-model.ts";

/**
 * feedback-store — the fixture road's board (`COMMUNITY_BACKEND_LIVE` off, Decision #272): the demo
 * ideas of `feedback-fixtures.ts`, plus what people suggested and voted for since the process started.
 *
 * A per-process store, like the catalogue and pipeline-draft stores before it: submitting and voting
 * work end to end with the gate off and nothing is persisted — a restart is a clean slate. Each write
 * mirrors its door in `00001320` [community.feedback] rule for rule (the author's vote with the idea,
 * the submission's history row, Decision #147's screen, visibility, voting closed once shipped, both
 * rate limits), so the fixture road refuses exactly what the database would.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// #region State
interface StoreState {
	ideas: Map<string, FeedbackIdeaRecord>;
	/** idea id → (user id → when they voted). */
	votes: Map<string, Map<string, string>>;
	events: FeedbackStatusEventRecord[];
}

let state: StoreState | null = null;

function iso(now: number, daysAgo: number): string {
	return new Date(now - daysAgo * DAY_MS).toISOString();
}

/** Build the demo board as the seed would have written it, relative to `now`. */
function load(now: number): StoreState {
	const ideas = new Map<string, FeedbackIdeaRecord>();
	const votes = new Map<string, Map<string, string>>();
	const events: FeedbackStatusEventRecord[] = [];
	for (const spec of FEEDBACK_DEMO_IDEAS) {
		const author = FEEDBACK_DEMO_PEOPLE[spec.author];
		const last = spec.moves.at(-1);
		const status = last?.to ?? "backlog";
		const changed = last?.daysAgo ?? spec.daysAgo;
		const voters = [spec.author, ...spec.voters];
		ideas.set(spec.id, {
			id: spec.id,
			slug: spec.slug,
			title: spec.title,
			impact: spec.impact,
			body: spec.body ?? null,
			category: spec.category,
			status,
			authorId: author.userId,
			voteCount: voters.length,
			teamResponse: spec.response?.text ?? null,
			teamResponseAt: spec.response ? iso(now, spec.response.daysAgo) : null,
			createdAt: iso(now, spec.daysAgo),
			updatedAt: iso(now, Math.min(changed, spec.response?.daysAgo ?? changed)),
			statusChangedAt: iso(now, changed),
			archivedAt: status === "archived" ? iso(now, changed) : null,
		});
		votes.set(
			spec.id,
			new Map(
				voters.map((key, i) => [
					FEEDBACK_DEMO_PEOPLE[key].userId,
					iso(now, Math.max(spec.daysAgo - i * 0.7, 0.05)),
				]),
			),
		);
		let from: FeedbackStatusEventRecord["from"] = null;
		const moves = [{ to: "backlog" as const, daysAgo: spec.daysAgo }, ...spec.moves];
		moves.forEach((move, i) => {
			events.push({
				id: `${spec.id.slice(0, 24)}${String(i).padStart(12, "0")}`,
				ideaId: spec.id,
				from,
				to: move.to,
				at: iso(now, move.daysAgo),
			});
			from = move.to;
		});
	}
	return { ideas, votes, events };
}

function store(now = Date.now()): StoreState {
	state ??= load(now);
	return state;
}

/** Forget everything written since load. Tests only. */
export function resetFeedbackStore(): void {
	state = null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The store's id for a reader. A real session's user id is a uuid and is kept; a development stub
 * id (`u-alice`) is folded onto a stable uuid (FNV-1a, version-4 nibbles) so the rows it writes
 * still parse as the table's — the same id every time, so "your idea" stays yours.
 */
export function fixtureUserId(userId: string): string {
	if (UUID_RE.test(userId)) return userId.toLowerCase();
	const words: string[] = [];
	for (let seed = 0; seed < 4; seed++) {
		let h = 0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b9);
		for (let i = 0; i < userId.length; i++) {
			h ^= userId.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		words.push((h >>> 0).toString(16).padStart(8, "0"));
	}
	const hex = words.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${
		hex.slice(20, 32)
	}`;
}
// #endregion

// #region Reads
/** Every idea on the fixture board (copies), Archived included — the reader filters by visibility. */
export function feedbackStoreIdeas(now?: number): FeedbackIdeaRecord[] {
	return [...store(now).ideas.values()].map((r) => ({ ...r }));
}

/** One idea's history rows. */
export function feedbackStoreEvents(ideaId: string, now?: number): FeedbackStatusEventRecord[] {
	return store(now).events.filter((e) => e.ideaId === ideaId).map((e) => ({ ...e }));
}

/** Which of `ideaIds` `userId` has voted for. */
export function feedbackStoreVotedIds(
	userId: string,
	ideaIds: readonly string[],
	now?: number,
): Set<string> {
	const s = store(now);
	return new Set(ideaIds.filter((id) => s.votes.get(id)?.has(userId)));
}

/** The demo person with this user id, as the board shows them — the fixture road's profile cards. */
export function feedbackDemoAuthor(userId: string): FeedbackAuthor | null {
	const person = Object.values(FEEDBACK_DEMO_PEOPLE).find((p) => p.userId === userId);
	return person ? { handle: person.handle, name: person.name, avatar: person.avatar } : null;
}
// #endregion

// #region Writes — each mirrors its door
/** Why a fixture write was refused, in the doors' terms. */
export type FeedbackStoreRefusal =
	| { reason: "not_found" }
	| { reason: "voting_closed" }
	| { reason: "rate_limited"; retryAt: string };

/** What a fixture write answers. */
export type FeedbackStoreResult<T> = { ok: true; value: T } | {
	ok: false;
	refusal: FeedbackStoreRefusal;
};

/** `community.submit_feedback_idea`: Under review, screened, self-voted, one history row. */
export function feedbackStoreSubmit(
	input: FeedbackIdeaCreate,
	userId: string,
	now = Date.now(),
): FeedbackStoreResult<{ record: FeedbackIdeaRecord; viewerVoted: true }> {
	const s = store(now);
	const recent = [...s.ideas.values()]
		.filter((r) => r.authorId === userId && Date.parse(r.createdAt) > now - DAY_MS)
		.map((r) => Date.parse(r.createdAt))
		.sort((a, b) => a - b);
	if (recent.length >= FEEDBACK_IDEAS_PER_DAY) {
		return {
			ok: false,
			refusal: { reason: "rate_limited", retryAt: new Date(recent[0] + DAY_MS).toISOString() },
		};
	}
	const at = new Date(now).toISOString();
	const id = crypto.randomUUID();
	let slug = mintSlug("idea");
	while ([...s.ideas.values()].some((r) => r.slug === slug)) slug = mintSlug("idea");
	const body = input.body?.trim() ? maskPii(input.body.trim()).masked : null;
	const record: FeedbackIdeaRecord = {
		id,
		slug,
		title: maskPii(input.title.trim()).masked,
		impact: maskPii(input.impact.trim()).masked,
		body,
		category: input.category,
		status: "backlog",
		authorId: userId,
		voteCount: 1,
		teamResponse: null,
		teamResponseAt: null,
		createdAt: at,
		updatedAt: at,
		statusChangedAt: at,
		archivedAt: null,
	};
	s.ideas.set(id, record);
	s.votes.set(id, new Map([[userId, at]]));
	s.events.push({ id: crypto.randomUUID(), ideaId: id, from: null, to: "backlog", at });
	return { ok: true, value: { record: { ...record }, viewerVoted: true } };
}

/** `community.vote_feedback_idea` / `unvote_feedback_idea`: idempotent, visible and open ideas only. */
export function feedbackStoreVote(
	slug: string,
	viewer: FeedbackViewer & { userId: string },
	voted: boolean,
	now = Date.now(),
): FeedbackStoreResult<{ voted: boolean; voteCount: number }> {
	const s = store(now);
	const idea = [...s.ideas.values()].find((r) => r.slug === slug);
	if (!idea || !canSeeFeedbackIdea(idea, viewer)) {
		return { ok: false, refusal: { reason: "not_found" } };
	}
	if (!isFeedbackVotable(idea.status)) return { ok: false, refusal: { reason: "voting_closed" } };
	const voters = s.votes.get(idea.id) ?? new Map<string, string>();
	s.votes.set(idea.id, voters);
	if (voted && !voters.has(viewer.userId)) {
		const lastHour = [...s.votes.values()]
			.map((m) => m.get(viewer.userId))
			.filter((at): at is string => at !== undefined && Date.parse(at) > now - HOUR_MS)
			.map((at) => Date.parse(at))
			.sort((a, b) => a - b);
		if (lastHour.length >= FEEDBACK_VOTES_PER_HOUR) {
			return {
				ok: false,
				refusal: { reason: "rate_limited", retryAt: new Date(lastHour[0] + HOUR_MS).toISOString() },
			};
		}
		voters.set(viewer.userId, new Date(now).toISOString());
	} else if (!voted) {
		voters.delete(viewer.userId);
	}
	idea.voteCount = voters.size;
	return { ok: true, value: { voted, voteCount: idea.voteCount } };
}
// #endregion
