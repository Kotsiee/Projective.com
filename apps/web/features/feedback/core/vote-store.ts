import { type Signal, signal } from "@preact/signals";

/**
 * vote-store — the board's optimistic votes (Decision #272): one signal of per-idea vote states that
 * every row, the idea view and the duplicate list read, so a vote cast anywhere shows everywhere.
 *
 * A press flips the state at once (pressed, count ± 1), sends, and settles on the server's answer —
 * the true count, which may differ when others voted meanwhile. A refusal (any non-2xx) rolls the
 * idea back to exactly what it was and keeps the message for an inline error. While a vote is in
 * flight that idea ignores further presses, and a board refresh never overwrites it.
 */

/** One idea's vote, as the reader sees it. */
export interface VoteState {
	voted: boolean;
	count: number;
	/** A vote for this idea is in flight. */
	pending: boolean;
	/** Why the last vote was refused, until the next press. */
	error: string | null;
}

/** The server's answer to a vote: `ok` with the true state, or a refusal's message. */
export type VoteAnswer =
	| { ok: true; voted: boolean; voteCount: number }
	| { ok: false; message: string };

/** Sends one vote (`voted: true`) or retraction. */
export type VoteSender = (slug: string, voted: boolean) => Promise<VoteAnswer>;

/** What one press came to. */
export interface VoteOutcome {
	/** `false` when the press was ignored (already in flight, or an idea the store does not know). */
	sent: boolean;
	ok: boolean;
	state: VoteState | undefined;
	message?: string;
}

/** The board's vote states. */
export interface VoteStore {
	/** Every known idea's vote, by slug. */
	readonly states: Signal<Readonly<Record<string, VoteState>>>;
	/** Learn ideas from a read. An idea with a vote in flight keeps its optimistic state. */
	seed(ideas: ReadonlyArray<{ slug: string; viewerVoted: boolean; voteCount: number }>): void;
	/** One idea's vote. */
	get(slug: string): VoteState | undefined;
	/** Press the vote control: flip optimistically, send, settle or roll back. */
	toggle(slug: string, send: VoteSender): Promise<VoteOutcome>;
}

/** A store for one board. */
export function createVoteStore(): VoteStore {
	const states = signal<Readonly<Record<string, VoteState>>>({});

	function write(slug: string, state: VoteState): void {
		states.value = { ...states.value, [slug]: state };
	}

	return {
		states,
		seed(ideas) {
			const next = { ...states.value };
			for (const idea of ideas) {
				if (next[idea.slug]?.pending) continue;
				next[idea.slug] = {
					voted: idea.viewerVoted,
					count: idea.voteCount,
					pending: false,
					error: null,
				};
			}
			states.value = next;
		},
		get(slug) {
			return states.value[slug];
		},
		async toggle(slug, send) {
			const before = states.value[slug];
			if (!before || before.pending) return { sent: false, ok: false, state: before };
			const voted = !before.voted;
			write(slug, {
				voted,
				count: Math.max(0, before.count + (voted ? 1 : -1)),
				pending: true,
				error: null,
			});
			let answer: VoteAnswer;
			try {
				answer = await send(slug, voted);
			} catch {
				answer = { ok: false, message: "Your vote didn't go through. Check your connection." };
			}
			if (answer.ok) {
				const settled = {
					voted: answer.voted,
					count: answer.voteCount,
					pending: false,
					error: null,
				};
				write(slug, settled);
				return { sent: true, ok: true, state: settled };
			}
			const rolledBack = { ...before, pending: false, error: answer.message };
			write(slug, rolledBack);
			return { sent: true, ok: false, state: rolledBack, message: answer.message };
		},
	};
}
