import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
	Button,
	FieldLegend,
	FormControl,
	InputText,
	Select,
	Textarea,
} from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	FEEDBACK_BODY_MAX,
	FEEDBACK_CATEGORIES,
	FEEDBACK_CATEGORY_LABEL,
	FEEDBACK_IMPACT_MAX,
	FEEDBACK_STATE_LABEL,
	FEEDBACK_TITLE_MAX,
	type FeedbackCategory,
	type FeedbackIdea,
	isFeedbackVotable,
} from "@projective/types/community";
import { FeedbackService } from "../core/FeedbackService.ts";
import type { VoteStore } from "../core/vote-store.ts";
import { checkCompose, type ComposeState, piiHintFor } from "../core/compose-state.ts";
import { voteAnnouncement, voteCountText } from "../core/feedback-view.ts";
import { isPlainClick } from "./IdeaRow.tsx";
import { SentFlourish } from "./SentFlourish.tsx";

/** How long the title rests before the "already suggested?" search runs. */
const DUPLICATE_DEBOUNCE_MS = 350;
/** The shortest title worth searching on. */
const DUPLICATE_MIN_CHARS = 6;
/** What the form's live region says once an idea is sent — the success, independent of any motion. */
export const FEEDBACK_SENT_ANNOUNCEMENT =
	"Your idea was sent. New ideas appear on the board after the team reviews them.";

const CATEGORY_OPTIONS = FEEDBACK_CATEGORIES.map((value) => ({
	value,
	label: FEEDBACK_CATEGORY_LABEL[value],
}));

/** Props for {@link IdeaComposeForm}. */
export interface IdeaComposeFormProps {
	/** The `<form>` id the pinned footer's submit button names. */
	formId: string;
	state: ComposeState;
	votes: VoteStore;
	/** The drawer shows a heading of its own (`<h3>`); the dialog's header already names it. */
	heading?: boolean;
	hrefOf: (slug: string) => string;
	onOpenIdea: (slug: string) => void;
	/** After a send: show the idea, back to the board, or start another. */
	onShowSent: (idea: FeedbackIdea) => void;
	onDone: () => void;
	onAnother: () => void;
}

/**
 * Send the form: check it, post it, and either move to the success state or paint the refusals onto
 * their fields. Shared by the form's own submit and the footer's button (which names the form).
 */
export async function submitCompose(state: ComposeState): Promise<FeedbackIdea | null> {
	if (state.submitting.peek()) return null;
	const check = checkCompose(state.values.peek());
	if (!check.ok) {
		state.errors.value = check.errors;
		state.formError.value = null;
		return null;
	}
	state.submitting.value = true;
	state.formError.value = null;
	const res = await FeedbackService.submit(check.input);
	state.submitting.value = false;
	if (res.ok && res.data) {
		state.errors.value = {};
		state.sent.value = res.data.idea;
		return res.data.idea;
	}
	state.errors.value = res.errors ?? {};
	state.formError.value = res.errors && Object.keys(res.errors).length > 0
		? null
		: res.message ?? "Your idea didn't send. Try again.";
	return null;
}

/**
 * IdeaComposeForm — "Suggest an idea" (Decision #272): a title (≤ 90), a category, the problem it
 * solves and optional details. As the title is typed, ideas already on the board with the same words
 * are listed with "Vote for this instead". The commit lives in the host's pinned footer
 * ({@link ComposeActions}); a send gives way to the success state, with the owner's paper-aeroplane
 * flourish where motion is allowed. The success is announced by the form's own polite live region —
 * present before the send, so a screen reader hears the change whatever the motion setting — and
 * focus moves to the success heading, because the submit button it was on has gone.
 *
 * The same live region speaks for the duplicate list's votes. It is the FORM's own, never the
 * board's: on `/feedback` the form sits in a Dialog whose focus trap makes everything outside it —
 * the board's live region included — inert, so a board announcement would never be heard.
 */
export function IdeaComposeForm(props: IdeaComposeFormProps): JSX.Element {
	const { state, votes, formId } = props;
	const values = state.values.value;
	const errors = state.errors.value;
	const dupes = useSignal<FeedbackIdea[]>([]);
	/** What the live region last said about a duplicate's vote. */
	const said = useSignal("");
	const sentHeadingRef = useRef<HTMLHeadingElement>(null);

	function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]): void {
		state.values.value = { ...state.values.peek(), [key]: value };
		if (state.errors.peek()[key]) {
			const { [key]: _cleared, ...rest } = state.errors.peek();
			state.errors.value = rest;
		}
	}

	// The "already suggested?" search, debounced on the title.
	useEffect(() => {
		const title = values.title.trim();
		if (title.length < DUPLICATE_MIN_CHARS) {
			dupes.value = [];
			return;
		}
		let live = true;
		const timer = setTimeout(async () => {
			const res = await FeedbackService.board({ q: title, limit: 4 });
			if (!live || !res.ok || !res.data) return;
			votes.seed(res.data.ideas);
			dupes.value = res.data.ideas;
		}, DUPLICATE_DEBOUNCE_MS);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [values.title]);

	const sent = state.sent.value;
	useEffect(() => {
		if (sent) sentHeadingRef.current?.focus();
	}, [sent]);

	const live = (
		<p class="ui-visually-hidden" aria-live="polite">
			{sent ? FEEDBACK_SENT_ANNOUNCEMENT : said.value}
		</p>
	);

	if (sent) {
		return (
			<>
				{live}
				<div class="fb-sent">
					<SentFlourish />
					<span class="fb-sent__mark" aria-hidden="true">
						<Icon name="send" />
					</span>
					<h3 class="fb-sent__title" tabIndex={-1} ref={sentHeadingRef}>
						Thanks — your idea is in.
					</h3>
					<p class="fb-sent__text">
						New ideas appear on the board after the team reviews them. Until then it waits in the
						Under review tab, where only you can see it, and we'll let you know when its status
						changes.
					</p>
					<div class="fb-sent__actions">
						<Button
							label="See your idea"
							severity="neutral"
							variant="outlined"
							onClick={() => props.onShowSent(sent)}
						/>
						<Button
							label="Suggest another"
							variant="text"
							severity="secondary"
							onClick={props.onAnother}
						/>
						<Button
							label="Back to the board"
							variant="text"
							severity="secondary"
							onClick={props.onDone}
						/>
					</div>
				</div>
			</>
		);
	}

	async function voteInstead(idea: FeedbackIdea): Promise<void> {
		const outcome = await votes.toggle(idea.slug, FeedbackService.vote);
		// A refusal is said once, by the item's own inline alert; only a vote that landed is announced.
		if (!outcome.sent || !outcome.ok || !outcome.state) return;
		said.value = voteAnnouncement(idea.title, outcome.state.voted, outcome.state.count);
	}

	return (
		<>
			{live}
			<form
				id={formId}
				class="fb-compose"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void submitCompose(state);
				}}
			>
				{props.heading && <h3 class="fb-compose__heading">Suggest an idea</h3>}
				<p class="fb-compose__note">
					Tell us what would make Projective work better for you. New ideas appear on the board
					after review, and ideas are public once accepted — so leave out contact and payment
					details.
				</p>

				<FormControl
					label="Title"
					required
					class="fb-compose__title"
					status={errors.title ? "invalid" : "default"}
					error={errors.title}
					hint={piiHintFor(values.title) ??
						`${values.title.length} of ${FEEDBACK_TITLE_MAX} characters`}
				>
					{(a) => (
						<InputText
							id={a.id}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							value={values.title}
							onValueChange={(v) => set("title", v)}
							maxLength={FEEDBACK_TITLE_MAX}
							placeholder="A short name for your idea"
							autoComplete="off"
							fluid
						/>
					)}
				</FormControl>

				{dupes.value.length > 0 && (
					<section class="fb-dupes" aria-labelledby={`${formId}-dupes`}>
						<p id={`${formId}-dupes`} class="fb-section-title">Already suggested?</p>
						<ul class="fb-dupes__list">
							{dupes.value.map((idea) => {
								const vote = votes.get(idea.slug);
								const count = vote?.count ?? idea.voteCount;
								const voted = vote?.voted ?? idea.viewerVoted;
								return (
									<li class="fb-dupes__item" key={idea.slug}>
										<div class="fb-dupes__text">
											<a
												class="fb-dupes__title"
												href={props.hrefOf(idea.slug)}
												onClick={(event) => {
													if (!isPlainClick(event)) return;
													event.preventDefault();
													props.onOpenIdea(idea.slug);
												}}
											>
												{idea.title}
											</a>
											<span class="fb-dupes__meta">
												{FEEDBACK_STATE_LABEL[idea.status]} · {voteCountText(count)}
											</span>
										</div>
										{
											/*
											 * An action button, not a toggle: its label says what pressing it does next,
											 * so it changes with the vote and carries no aria-pressed (a toggle's name
											 * must not change with its state). While a vote is in flight it stays in the
											 * focus order — aria-disabled, the press ignored — as VoteButton does.
											 */
										}
										{isFeedbackVotable(idea.status) && (
											<Button
												size="sm"
												severity="neutral"
												variant="outlined"
												aria-disabled={vote?.pending || undefined}
												label={voted ? "Remove my vote" : "Vote for this instead"}
												onClick={() => {
													if (!vote?.pending) void voteInstead(idea);
												}}
											/>
										)}
										{vote?.error && <p class="fb-dupes__error" role="alert">{vote.error}</p>}
									</li>
								);
							})}
						</ul>
					</section>
				)}

				<FormControl
					label="Category"
					required
					status={errors.category ? "invalid" : "default"}
					error={errors.category}
				>
					{(a) => (
						<Select
							id={a.id}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							options={CATEGORY_OPTIONS}
							value={values.category}
							onValueChange={(v) => set("category", (v || "") as FeedbackCategory | "")}
							placeholder="Choose one"
							fluid
						/>
					)}
				</FormControl>

				<FormControl
					label="What problem does this solve?"
					required
					status={errors.impact ? "invalid" : "default"}
					error={errors.impact}
					hint={piiHintFor(values.impact) ?? "Who it helps, and what is hard for them today."}
				>
					{(a) => (
						<Textarea
							id={a.id}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							value={values.impact}
							onValueChange={(v) => set("impact", v)}
							rows={3}
							maxRows={8}
							autoResize
							maxLength={FEEDBACK_IMPACT_MAX}
							fluid
						/>
					)}
				</FormControl>

				<FormControl
					label="Details (optional)"
					status={errors.body ? "invalid" : "default"}
					error={errors.body}
					hint={piiHintFor(values.body) ?? "Anything else that would help us understand it."}
				>
					{(a) => (
						<Textarea
							id={a.id}
							aria-describedby={a.describedBy}
							status={a.status}
							value={values.body}
							onValueChange={(v) => set("body", v)}
							rows={3}
							maxRows={10}
							autoResize
							maxLength={FEEDBACK_BODY_MAX}
							fluid
						/>
					)}
				</FormControl>

				{state.formError.value && (
					<p class="fb-compose__error" role="alert">{state.formError.value}</p>
				)}
				<FieldLegend />
			</form>
		</>
	);
}

/** Props for {@link ComposeActions}. */
export interface ComposeActionsProps {
	formId: string;
	state: ComposeState;
	onCancel: () => void;
}

/**
 * The suggestion form's commit, for the host's pinned footer: Cancel, then "Suggest idea" — the
 * region's one filled primary (tier 3, a core workflow commit), last in the inline direction
 * (§B.8.6). Nothing once the idea is sent: the success state carries its own way on.
 */
export function ComposeActions(props: ComposeActionsProps): JSX.Element | null {
	const { state } = props;
	if (state.sent.value) return null;
	return (
		<div class="fb-compose__actions">
			<Button label="Cancel" variant="text" severity="secondary" onClick={props.onCancel} />
			<Button
				type="submit"
				form={props.formId}
				label="Suggest idea"
				icon={<Icon name="send" />}
				loading={state.submitting.value}
			/>
		</div>
	);
}
