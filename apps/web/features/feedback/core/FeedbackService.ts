import type {
	FeedbackBoard,
	FeedbackIdea,
	FeedbackIdeaCreate,
	FeedbackIdeaDetail,
	FeedbackSort,
	FeedbackStatusFilter,
	FeedbackVoteResult,
} from "@projective/types/community";
import { apiFetch } from "@web/utils/api-client.ts";
import type { VoteAnswer } from "./vote-store.ts";

/** What every call resolves to — a failure is a sentence (and field errors), never a throw. */
export interface FeedbackCall<T> {
	ok: boolean;
	status: number;
	message?: string;
	errors?: Record<string, string>;
	details?: Record<string, unknown>;
	data?: T;
}

async function call<T>(path: string, init?: RequestInit): Promise<FeedbackCall<T>> {
	try {
		const res = await apiFetch(path, {
			...init,
			headers: {
				accept: "application/json",
				...(init?.body ? { "content-type": "application/json" } : {}),
			},
		});
		const body = await res.json().catch(() => null) as Record<string, unknown> | null;
		if (!body || typeof body.ok !== "boolean") {
			return {
				ok: false,
				status: res.status,
				message: "The feedback board didn't answer. Try again.",
			};
		}
		const { ok, message, errors, details, ...data } = body;
		return {
			ok: ok as boolean,
			status: res.status,
			message: message as string | undefined,
			errors: errors as Record<string, string> | undefined,
			details: details as Record<string, unknown> | undefined,
			data: ok ? data as T : undefined,
		};
	} catch {
		return {
			ok: false,
			status: 0,
			message: "Network error — check your connection and try again.",
		};
	}
}

/**
 * FeedbackService — the dumb client behind the feedback board's islands (Decision #272). It builds a
 * URL or a JSON body and calls `/api/feedback/*`; what the reader may see, vote on or suggest is the
 * server's decision.
 */
export const FeedbackService = {
	/** The board for one tab (or every tab) in an order — and, with `q`, the title search. */
	board(query: {
		status?: FeedbackStatusFilter | null;
		sort?: FeedbackSort;
		q?: string;
		limit?: number;
	}): Promise<FeedbackCall<FeedbackBoard>> {
		const params = new URLSearchParams();
		if (query.status) params.set("status", query.status);
		if (query.sort) params.set("sort", query.sort);
		if (query.q !== undefined) params.set("q", query.q);
		if (query.limit !== undefined) params.set("limit", String(query.limit));
		const qs = params.toString();
		return call(`/api/feedback/ideas${qs ? `?${qs}` : ""}`);
	},

	/** One idea with its history and related ideas. */
	idea(slug: string): Promise<FeedbackCall<FeedbackIdeaDetail>> {
		return call(`/api/feedback/ideas/${encodeURIComponent(slug)}`);
	},

	/** Suggest an idea. */
	submit(input: FeedbackIdeaCreate): Promise<FeedbackCall<{ idea: FeedbackIdea }>> {
		return call("/api/feedback/ideas", { method: "POST", body: JSON.stringify(input) });
	},

	/** Vote or retract, as the vote store's sender. */
	async vote(slug: string, voted: boolean): Promise<VoteAnswer> {
		const res = await call<FeedbackVoteResult>(
			`/api/feedback/ideas/${encodeURIComponent(slug)}/vote`,
			{ method: voted ? "POST" : "DELETE" },
		);
		return res.ok && res.data
			? { ok: true, voted: res.data.voted, voteCount: res.data.voteCount }
			: { ok: false, message: res.message ?? "Your vote didn't go through. Try again." };
	},
};
