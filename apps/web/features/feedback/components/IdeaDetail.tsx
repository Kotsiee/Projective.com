import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import {
	FEEDBACK_CATEGORY_LABEL,
	FEEDBACK_STATE_LABEL,
	type FeedbackIdea,
	type FeedbackIdeaDetail,
} from "@projective/types/community";
import type { VoteState } from "../core/vote-store.ts";
import {
	feedbackAge,
	feedbackDateAttr,
	feedbackHistoryDate,
	feedbackStatusTag,
} from "../core/feedback-view.ts";
import { VoteButton } from "./VoteButton.tsx";
import { IdeaFacts, IdeaRow, isPlainClick } from "./IdeaRow.tsx";

/** Props for {@link IdeaDetail}. */
export interface IdeaDetailProps {
	detail: FeedbackIdeaDetail;
	/** The page renders the idea's title as its `<h1>`; the drawer, under its own `<h2>`, as `<h3>`. */
	headingLevel: 1 | 3;
	voteOf: (idea: FeedbackIdea) => VoteState | undefined;
	signedIn: boolean;
	signInHref: string;
	/** The board's address, for the back link. */
	boardHref: string;
	onBack: () => void;
	hrefOf: (slug: string) => string;
	onOpen: (slug: string) => void;
	onVote: (idea: FeedbackIdea) => void;
	/** Receives the title node, so a view change can move focus to it. */
	titleRef?: (el: HTMLHeadingElement | null) => void;
}

/**
 * IdeaDetail — one idea (Decision #272): its status and facts, the title beside the vote control,
 * who suggested it, the full reason and details, the team's official response, the status history
 * (mono dates, oldest first) and related ideas. Static content is never boxed (§B.9.7): sections are
 * spacing and a section-header label; the response takes one inline-start hairline.
 */
export function IdeaDetail(props: IdeaDetailProps): JSX.Element {
	const { detail, headingLevel, signedIn, signInHref } = props;
	const { idea, history, related, now } = detail;
	const tag = feedbackStatusTag(idea.status);
	const vote = props.voteOf(idea) ??
		{ voted: idea.viewerVoted, count: idea.voteCount, pending: false, error: null };
	const Title = headingLevel === 1 ? "h1" : "h3";
	const Section = headingLevel === 1 ? "h2" : "h4";

	return (
		<article class="fb-idea" aria-labelledby="fb-idea-title">
			<a
				class="fb-back ui-button ui-button--secondary ui-button--text ui-button--size-sm"
				href={props.boardHref}
				onClick={(event) => {
					if (!isPlainClick(event)) return;
					event.preventDefault();
					props.onBack();
				}}
			>
				<span class="ui-button__icon" aria-hidden="true">
					<Icon name="arrow-left" />
				</span>
				<span class="ui-button__label">All ideas</span>
			</a>

			<header class="fb-idea__head">
				<VoteButton
					title={idea.title}
					status={idea.status}
					vote={vote}
					signedIn={signedIn}
					signInHref={signInHref}
					onToggle={() => props.onVote(idea)}
					size="lg"
				/>
				<div class="fb-idea__heading">
					<IdeaFacts
						items={[
							<Tag
								key="status"
								value={tag.label}
								severity={tag.severity}
								variant="subtle"
								rounded
							/>,
							FEEDBACK_CATEGORY_LABEL[idea.category],
							<time key="age" dateTime={idea.createdAt}>{feedbackAge(idea.createdAt, now)}</time>,
						]}
					/>
					<Title id="fb-idea-title" class="fb-idea__title" tabIndex={-1} ref={props.titleRef}>
						{idea.title}
					</Title>
					<address class="fb-idea__byline">
						{idea.author
							? (
								<>
									<UserAvatar image={idea.author.avatar} label={idea.author.name} size="sm" />
									<span>
										Suggested by{" "}
										<a class="fb-idea__author" href={`/${idea.author.handle}`}>
											{idea.isOwn ? "you" : idea.author.name}
										</a>
									</span>
								</>
							)
							: <span>{idea.isOwn ? "Suggested by you" : "Suggested by a member"}</span>}
					</address>
					{/* A refused vote rolls back with its reason inline, as the board's rows do. */}
					{vote.error && <p class="fb-idea__error" role="alert">{vote.error}</p>}
				</div>
			</header>

			<p class="fb-idea__lead">{idea.impact}</p>
			{idea.body && <p class="fb-idea__body">{idea.body}</p>}
			{idea.status === "backlog" && (
				<p class="fb-notice">
					Only you can see this idea while the team reviews it. New ideas appear on the board after
					review.
				</p>
			)}

			{idea.teamResponse && (
				<section class="fb-section" aria-labelledby="fb-idea-response">
					<Section id="fb-idea-response" class="fb-section-title">From the Projective team</Section>
					<blockquote class="fb-response">
						<p class="fb-response__text">{idea.teamResponse}</p>
						{idea.teamResponseAt && (
							<p class="fb-notice">
								<time dateTime={idea.teamResponseAt}>
									{feedbackHistoryDate(idea.teamResponseAt)}
								</time>
							</p>
						)}
					</blockquote>
				</section>
			)}

			{history.length > 0 && (
				<section class="fb-section" aria-labelledby="fb-idea-history">
					<Section id="fb-idea-history" class="fb-section-title">Status history</Section>
					<ol class="fb-history">
						{history.map((event, i) => (
							<li class="fb-history__item" key={i}>
								<time class="fb-history__date" dateTime={feedbackDateAttr(event.at)}>
									{feedbackHistoryDate(event.at)}
								</time>
								<span>
									{event.from === null ? "Suggested" : FEEDBACK_STATE_LABEL[event.to]}
								</span>
							</li>
						))}
					</ol>
				</section>
			)}

			{related.length > 0 && (
				<section class="fb-section" aria-labelledby="fb-idea-related">
					<Section id="fb-idea-related" class="fb-section-title">Related ideas</Section>
					<ul class="fb-list">
						{related.map((other) => (
							<IdeaRow
								key={other.slug}
								idea={other}
								now={now}
								vote={props.voteOf(other)}
								signedIn={signedIn}
								signInHref={signInHref}
								href={props.hrefOf(other.slug)}
								onOpen={props.onOpen}
								onVote={props.onVote}
							/>
						))}
					</ul>
				</section>
			)}
		</article>
	);
}
