import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { type FeedbackIdeaState, isFeedbackVotable } from "@projective/types/community";
import type { VoteState } from "../core/vote-store.ts";
import { signInToVoteLabel, voteCountText, voteLabel } from "../core/feedback-view.ts";

/** Props for {@link VoteButton}. */
export interface VoteButtonProps {
	/** The idea's title — the control's accessible name says what it votes for. */
	title: string;
	status: FeedbackIdeaState;
	/** The idea's vote from the board's store. */
	vote: VoteState;
	/** Whether the reader is signed in; a guest gets a sign-in link in its place. */
	signedIn: boolean;
	/** Where a guest signs in, returning to this exact URL. */
	signInHref: string;
	onToggle: () => void;
	/** The idea view's larger control. */
	size?: "md" | "lg";
}

/**
 * VoteButton — the board's tactile upvote (Decision #272): a stacked up-chevron over a tabular count.
 *
 * - Open idea, signed in: a toggle `<button aria-pressed>` named "Upvote <title>, n votes"; pressed is
 *   the brand pair. The press compresses by `transform: scale()` only (gate 12) and the count reserves
 *   its width, so nothing around it moves. While a vote is in flight it is `aria-disabled`.
 * - Open idea, guest: the same control as a link to sign in that comes back to this URL — so the
 *   control still does something (§3 gate 11).
 * - Shipped (voting closed): the count alone, with no border and no press — a figure, not a control.
 */
export function VoteButton(props: VoteButtonProps): JSX.Element {
	const { title, status, vote, signedIn, signInHref, onToggle, size = "md" } = props;
	const sizeClass = size === "lg" ? " fb-vote--lg" : "";
	const face = (
		<>
			<span class="fb-vote__icon" aria-hidden="true">
				<Icon name="chevron-up" />
			</span>
			<span class="fb-vote__count" aria-hidden="true">{vote.count}</span>
		</>
	);

	if (!isFeedbackVotable(status)) {
		return (
			<span class={`fb-vote fb-vote--closed${sizeClass}`}>
				{face}
				<span class="ui-visually-hidden">{voteCountText(vote.count)}</span>
			</span>
		);
	}
	if (!signedIn) {
		return (
			<a
				class={`fb-vote fb-vote--signin${sizeClass}`}
				href={signInHref}
				aria-label={signInToVoteLabel(title, vote.count)}
			>
				{face}
			</a>
		);
	}
	return (
		<button
			type="button"
			class={`fb-vote${sizeClass}`}
			aria-pressed={vote.voted}
			aria-disabled={vote.pending || undefined}
			aria-label={voteLabel(title, vote.count)}
			onClick={() => {
				if (!vote.pending) onToggle();
			}}
		>
			{face}
		</button>
	);
}
