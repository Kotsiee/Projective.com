import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { FEEDBACK_CATEGORY_LABEL, type FeedbackIdea } from "@projective/types/community";
import type { VoteState } from "../core/vote-store.ts";
import { feedbackAge, feedbackStatusTag } from "../core/feedback-view.ts";
import { VoteButton } from "./VoteButton.tsx";

/** Props for {@link IdeaRow}. */
export interface IdeaRowProps {
	idea: FeedbackIdea;
	/** The board's "now", for the age. */
	now: string;
	/** The idea's vote from the board's store (falls back to the read's own figures). */
	vote: VoteState | undefined;
	signedIn: boolean;
	signInHref: string;
	/** The idea's own address — a real link, so it opens in a new tab or copies as one. */
	href: string;
	/** Open the idea in place (a plain click); modified clicks keep the browser's behaviour. */
	onOpen: (slug: string) => void;
	onVote: (idea: FeedbackIdea) => void;
	/**
	 * Show the lifecycle tag — off inside a roadmap column or a single-status tab, whose heading
	 * already says it.
	 */
	showStatus?: boolean;
	/**
	 * Give the row its slug as an `id`, so `/feedback#<slug>` (the address the page's JSON-LD lists)
	 * lands on it. The page's board only — a drawer row must not claim ids on a host page.
	 */
	anchor?: boolean;
}

/**
 * IdeaFacts — an idea's one line of facts (§B.11.2): the lifecycle tag (the one container a fact may
 * have, §B.11.3), then category · age · flags as inline text. `@projective/ui`'s `MetaLine` takes text
 * only, and this line leads with a `Tag` and a `<time>`, so it is drawn here — with `DocumentHeader`'s
 * separator: each item after the first hangs its `aria-hidden` middot in the column gap before it,
 * and the list clips its own overflow, so a wrapped line never starts or ends on a dot.
 */
export function IdeaFacts(
	props: { items: Array<JSX.Element | string | null | false> },
): JSX.Element {
	const items = props.items.filter((item): item is JSX.Element | string => Boolean(item));
	return (
		<ul class="fb-meta" role="list">
			{items.map((item, i) => (
				<li class="fb-meta__item" key={i}>
					{i > 0 && <span class="fb-meta__sep" aria-hidden="true">·</span>}
					{item}
				</li>
			))}
		</ul>
	);
}

/** A plain left click — the one a page may take over; anything else is the browser's. */
export function isPlainClick(event: MouseEvent): boolean {
	return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * IdeaRow — one idea on the board (Decision #272): the vote control, the title (the link that opens
 * it), its one-line reason, and one line of facts — the lifecycle tag, then category · age as inline
 * text. Unboxed: rows are separated by a single hairline, never a card (the drawer is an elevated
 * panel, §B.9.2).
 */
export function IdeaRow(props: IdeaRowProps): JSX.Element {
	const { idea, now, signedIn, signInHref, href, onOpen, onVote, showStatus = true } = props;
	const vote = props.vote ??
		{ voted: idea.viewerVoted, count: idea.voteCount, pending: false, error: null };
	const tag = feedbackStatusTag(idea.status);
	return (
		<li class="fb-row" data-slug={idea.slug} id={props.anchor ? idea.slug : undefined}>
			<VoteButton
				title={idea.title}
				status={idea.status}
				vote={vote}
				signedIn={signedIn}
				signInHref={signInHref}
				onToggle={() => onVote(idea)}
			/>
			<div class="fb-row__body">
				<a
					class="fb-row__title"
					href={href}
					onClick={(event) => {
						if (!isPlainClick(event)) return;
						event.preventDefault();
						onOpen(idea.slug);
					}}
				>
					{idea.title}
				</a>
				<p class="fb-row__summary">{idea.impact}</p>
				<IdeaFacts
					items={[
						showStatus && (
							<Tag
								key="status"
								value={tag.label}
								severity={tag.severity}
								variant="subtle"
								rounded
							/>
						),
						FEEDBACK_CATEGORY_LABEL[idea.category],
						<time key="age" dateTime={idea.createdAt}>{feedbackAge(idea.createdAt, now)}</time>,
						idea.isOwn && "Your idea",
						idea.teamResponse !== null && "Team responded",
					]}
				/>
				{vote.error && <p class="fb-row__error" role="alert">{vote.error}</p>}
			</div>
		</li>
	);
}
