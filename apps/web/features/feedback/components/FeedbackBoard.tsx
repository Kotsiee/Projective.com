import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/feedback.css";
import { Button, SelectButton } from "@projective/ui/fields";
import { Dialog, Message, Skeleton } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { TabMenu } from "@projective/ui/navigation";
import { EmptyState } from "@projective/ui/utils";
import type {
	FeedbackBoard as FeedbackBoardData,
	FeedbackIdea,
	FeedbackIdeaDetail,
	FeedbackSort,
} from "@projective/types/community";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { FeedbackService } from "../core/FeedbackService.ts";
import { createVoteStore } from "../core/vote-store.ts";
import type { ComposeState } from "../core/compose-state.ts";
import { resetCompose } from "../core/compose-state.ts";
import {
	feedbackBoardHref,
	feedbackIdeaHref,
	type FeedbackLocation,
	withFeedbackLocation,
} from "../core/feedback-url.ts";
import {
	FEEDBACK_ROADMAP_COLUMNS,
	FEEDBACK_TABS,
	feedbackEmptyCopy,
	feedbackIdeaUnavailable,
	feedbackRoadmap,
	type FeedbackRoadmapColumn,
	feedbackTabCount,
	feedbackTabLabel,
	type FeedbackUnavailableCopy,
	voteAnnouncement,
} from "../core/feedback-view.ts";
import { IdeaRow } from "./IdeaRow.tsx";
import { IdeaDetail } from "./IdeaDetail.tsx";
import { ComposeActions, IdeaComposeForm } from "./IdeaComposeForm.tsx";

/** How the host moves the board: a new history entry, or the current one rewritten. */
export type FeedbackNavigate = (next: FeedbackLocation, how: "push" | "replace") => void;

/** Props for {@link FeedbackBoard}. */
export interface FeedbackBoardProps {
	/** `page` on `/feedback`; `drawer` inside the `?feedback=open` overlay on any other page. */
	mode: "page" | "drawer";
	/** Where the board is — the host reads it from the URL and owns every write. */
	location: FeedbackLocation;
	navigate: FeedbackNavigate;
	/** The address bar as it stands (path + query), for links and the sign-in return. */
	currentHref: string;
	/** The server's read for the first location (the page); `null` and the board reads it itself. */
	initialBoard: FeedbackBoardData | null;
	initialDetail: FeedbackIdeaDetail | null;
	/**
	 * Why the idea the first location names will not open (the server's read refused it), so the page
	 * renders that answer — and its heading — without a client round trip.
	 */
	initialDetailError?: FeedbackUnavailableCopy | null;
	/** Whether the reader is signed in, as the server knew it when the page rendered. */
	signedIn: boolean;
	/** The suggestion form's state — the host owns it because its commit lives in the host's footer. */
	compose: ComposeState;
}

const SORT_OPTIONS = [
	{ value: "top", label: "Top" },
	{ value: "new", label: "New" },
];

/** The id of the one tab panel (the WAI-ARIA tabs pattern). */
const PANEL_ID = "fb-panel";
/** The suggestion form's id, which the pinned footer's submit names. */
export const FEEDBACK_COMPOSE_FORM_ID = "fb-compose-form";

function boardKey(location: Pick<FeedbackLocation, "status" | "sort">): string {
	return `${location.status ?? "all"}|${location.sort}`;
}

/**
 * FeedbackBoard — the one body of the feedback board, shared by `/feedback` and the drawer
 * (Decision #272). It reads and renders; the host owns the URL.
 *
 * - **Board**: "Feedback & roadmap", the status tabs with their counts (roving tabindex), Top / New,
 *   and "Suggest an idea" — the region's one filled primary, or a sign-in link for a guest. On the
 *   page the All tab is the roadmap (Planned · In progress · Shipped, side by side from 1024px of
 *   frame); in the drawer it is always one list.
 * - **Idea**: one idea with its history and related ideas.
 * - **Suggest**: the form — a second view in the drawer, a dialog over the board on the page.
 *
 * Votes are optimistic through one store, rolled back with an inline error on any refusal, and every
 * vote is announced politely.
 */
export function FeedbackBoard(props: FeedbackBoardProps): JSX.Element {
	const { mode, location, navigate, currentHref, compose } = props;
	const votes = useMemo(() => {
		const store = createVoteStore();
		if (props.initialBoard) store.seed(props.initialBoard.ideas);
		if (props.initialDetail) store.seed([props.initialDetail.idea, ...props.initialDetail.related]);
		return store;
	}, []);
	const board = useSignal<FeedbackBoardData | null>(props.initialBoard);
	const loadedKey = useSignal<string | null>(props.initialBoard ? boardKey(location) : null);
	const boardBusy = useSignal(false);
	const boardError = useSignal<string | null>(null);
	const detail = useSignal<FeedbackIdeaDetail | null>(props.initialDetail);
	const detailError = useSignal<FeedbackUnavailableCopy | null>(props.initialDetailError ?? null);
	/** The idea `detailError` answers for, so the server's answer is not asked for again. */
	const detailErrorFor = useRef<string | null>(props.initialDetailError ? location.idea : null);
	const announcement = useSignal("");
	const tabIndex = useSignal(FEEDBACK_TABS.indexOf(location.status));
	const sort = useSignal<string>(location.sort);
	const composeOpen = useSignal(mode === "page" && location.view === "compose");
	const titleRef = useRef<HTMLHeadingElement | null>(null);
	const returnTo = useRef<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	/** The location as of the last render — what an answer that arrives late is checked against. */
	const latest = useRef(location);
	latest.current = location;
	const signedIn = board.value?.viewer.signedIn ?? props.signedIn;

	// #region Reads
	async function loadBoard(target: Pick<FeedbackLocation, "status" | "sort">): Promise<void> {
		const key = boardKey(target);
		boardBusy.value = true;
		const res = await FeedbackService.board({
			status: target.status,
			sort: target.sort,
			limit: target.status === null && mode === "page" ? 100 : 60,
		});
		boardBusy.value = false;
		// A tab the reader has already left: its answer would overwrite the one they are on.
		if (boardKey(latest.current) !== key && loadedKey.peek() !== null) return;
		if (!res.ok || !res.data) {
			boardError.value = res.message ?? "The board couldn't load.";
			return;
		}
		boardError.value = null;
		votes.seed(res.data.ideas);
		board.value = res.data;
		loadedKey.value = key;
	}

	async function loadDetail(slug: string): Promise<void> {
		detailError.value = null;
		detailErrorFor.current = null;
		const res = await FeedbackService.idea(slug);
		if (latest.current.idea !== slug) return;
		if (!res.ok || !res.data) {
			detail.value = null;
			detailError.value = feedbackIdeaUnavailable(res.status, res.message);
			detailErrorFor.current = slug;
			return;
		}
		votes.seed([res.data.idea, ...res.data.related]);
		detail.value = res.data;
	}

	useEffect(() => {
		tabIndex.value = FEEDBACK_TABS.indexOf(location.status);
		sort.value = location.sort;
		if (loadedKey.peek() !== boardKey(location)) void loadBoard(location);
	}, [location.status, location.sort]);

	useEffect(() => {
		if (location.view === "idea" && location.idea) {
			const known = detail.peek()?.idea.slug === location.idea ||
				detailErrorFor.current === location.idea;
			if (!known) {
				detail.value = null;
				void loadDetail(location.idea);
			}
		}
		if (mode === "page") composeOpen.value = location.view === "compose";
	}, [location.view, location.idea]);

	// Focus follows the view: the idea's title on the way in, the row it came from on the way back.
	useEffect(() => {
		if (location.view === "idea" && (detail.value || detailError.value)) titleRef.current?.focus();
		if (location.view === "board" && returnTo.current) {
			const link = rootRef.current?.querySelector<HTMLElement>(
				`[data-slug="${returnTo.current}"] .fb-row__title`,
			);
			returnTo.current = null;
			link?.focus();
		}
	}, [location.view, detail.value, detailError.value]);
	// #endregion

	// #region Actions
	function go(next: Partial<FeedbackLocation>, how: "push" | "replace"): void {
		navigate({ ...location, ...next }, how);
	}

	function openIdea(slug: string): void {
		returnTo.current = slug;
		go({ view: "idea", idea: slug }, mode === "page" ? "push" : "replace");
	}

	function backToBoard(): void {
		go({ view: "board", idea: null }, "replace");
	}

	function startCompose(): void {
		resetCompose(compose);
		go({ view: "compose", idea: null }, "replace");
	}

	function closeCompose(): void {
		go({ view: "board", idea: null }, "replace");
		if (compose.sent.peek()) {
			resetCompose(compose);
			void loadBoard(location);
		}
	}

	async function vote(idea: FeedbackIdea): Promise<void> {
		const outcome = await votes.toggle(idea.slug, FeedbackService.vote);
		if (!outcome.sent || !outcome.state) return;
		announcement.value = outcome.ok
			? voteAnnouncement(idea.title, outcome.state.voted, outcome.state.count)
			: outcome.message ?? "Your vote didn't go through.";
	}

	const hrefOf = (slug: string) => feedbackIdeaHref(slug, mode, currentHref);
	const signInHref = withRedirect("/login", currentHref);
	const composeHref = mode === "page"
		? withFeedbackLocation(currentHref, { ...location, view: "compose", idea: null }, {
			filters: true,
		})
		: withFeedbackLocation(currentHref, { ...location, view: "compose", idea: null }, {
			overlay: true,
		});
	const signInToSuggestHref = withRedirect("/login", composeHref);
	// #endregion

	// #region Views
	const suggest = signedIn
		? (
			<Button
				label="Suggest an idea"
				icon={<Icon name="plus" />}
				onClick={startCompose}
			/>
		)
		: (
			<a
				class="ui-button ui-button--primary ui-button--filled ui-button--size-md fb-link-button"
				href={signInToSuggestHref}
			>
				<span class="ui-button__label">Sign in to suggest an idea</span>
			</a>
		);

	function row(idea: FeedbackIdea, showStatus = true): JSX.Element {
		return (
			<IdeaRow
				key={idea.slug}
				idea={idea}
				now={board.value?.now ?? idea.createdAt}
				vote={votes.states.value[idea.slug]}
				signedIn={signedIn}
				signInHref={signInHref}
				href={hrefOf(idea.slug)}
				onOpen={openIdea}
				onVote={(target) => void vote(target)}
				showStatus={showStatus}
			/>
		);
	}

	function ideasPanel(): JSX.Element {
		const data = board.value;
		if (!data) {
			return boardError.value
				? (
					<Message severity="danger" variant="subtle">
						{boardError.value}{" "}
						<Button
							label="Try again"
							size="sm"
							severity="neutral"
							variant="outlined"
							onClick={() => void loadBoard(location)}
						/>
					</Message>
				)
				: (
					<div class="fb-drawer__loading" aria-label="Loading ideas">
						{[0, 1, 2, 3].map((i) => <Skeleton key={i} lines={2} />)}
					</div>
				);
		}
		const ideas = data.ideas;
		if (ideas.length === 0) {
			const copy = feedbackEmptyCopy(location.status, signedIn);
			return (
				<EmptyState
					size="sm"
					icon={<Icon name="send" />}
					title={copy.title}
					description={copy.description}
				/>
			);
		}
		if (mode === "page" && location.status === null) {
			const { columns, underReview } = feedbackRoadmap(ideas);
			return (
				<div class="fb-roadmap-frame">
					{underReview.length > 0 && (
						<section class="fb-review" aria-labelledby="fb-review-title">
							<h2 id="fb-review-title" class="fb-section-title">Your ideas under review</h2>
							<p class="fb-notice">
								Only you can see these until the team reviews them. New ideas appear on the board
								after review.
							</p>
							<ul class="fb-list">{underReview.map((idea) => row(idea))}</ul>
						</section>
					)}
					<div class="fb-roadmap">
						{FEEDBACK_ROADMAP_COLUMNS.map((column) => roadmapColumn(column, columns[column]))}
					</div>
				</div>
			);
		}
		return (
			<ul class="fb-list" aria-label={`${feedbackTabLabel(location.status)} ideas`}>
				{ideas.map((idea) => row(idea))}
			</ul>
		);
	}

	function roadmapColumn(column: FeedbackRoadmapColumn, ideas: FeedbackIdea[]): JSX.Element {
		const id = `fb-column-${column}`;
		const label = feedbackTabLabel(column);
		return (
			<section key={column} class="fb-column" aria-labelledby={id}>
				<div class="fb-column__head">
					<h2 id={id} class="fb-section-title">{label}</h2>
					<span class="fb-column__count">{ideas.length}</span>
				</div>
				{ideas.length > 0
					? <ul class="fb-list">{ideas.map((idea) => row(idea, false))}</ul>
					: <p class="fb-column__empty">{feedbackEmptyCopy(column, signedIn).description}</p>}
			</section>
		);
	}

	function boardView(): JSX.Element {
		const counts = board.value?.counts;
		return (
			<>
				<div class="fb-head">
					<div class="fb-head__text">
						{mode === "page" && <h1 class="fb-head__title">Feedback &amp; roadmap</h1>}
						<p class="fb-head__lede">
							Suggest what Projective should build next, vote for the ideas you want most, and
							follow them from Planned to Shipped. New ideas appear after review.
						</p>
					</div>
					<div class="fb-head__action">{suggest}</div>
				</div>
				<div class="fb-toolbar">
					<div class="fb-toolbar__tabs">
						<TabMenu
							id="fb-tabs"
							aria-label="Idea status"
							panelId={PANEL_ID}
							activeIndex={tabIndex}
							onActiveIndexChange={(i) =>
								go({ status: FEEDBACK_TABS[i] ?? null, view: "board", idea: null }, "replace")}
							model={FEEDBACK_TABS.map((tab) => ({
								key: tab ?? "all",
								label: feedbackTabLabel(tab),
							}))}
							itemTemplate={(item, i) => {
								const tab = FEEDBACK_TABS[i] ?? null;
								return (
									<>
										<span class="ui-tabmenu__label">{item.label}</span>
										{counts && (
											<span class="fb-tabcount">
												<span class="ui-visually-hidden">,</span>
												{feedbackTabCount(tab, counts)}
												<span class="ui-visually-hidden">ideas</span>
											</span>
										)}
									</>
								);
							}}
						/>
					</div>
					<div class="fb-toolbar__sort">
						<span class="fb-toolbar__sort-label" id="fb-sort-label">Sort</span>
						<SelectButton
							aria-label="Sort ideas"
							options={SORT_OPTIONS}
							value={sort}
							onValueChange={(v) => {
								const next = v === "new" ? "new" : "top";
								go({ sort: next as FeedbackSort, view: "board", idea: null }, "replace");
							}}
						/>
					</div>
				</div>
				<div
					id={PANEL_ID}
					class="fb-panel"
					role="tabpanel"
					aria-labelledby={`fb-tabs-tab-${Math.max(0, tabIndex.value)}`}
					aria-busy={boardBusy.value || undefined}
				>
					{ideasPanel()}
				</div>
			</>
		);
	}

	function ideaView(): JSX.Element {
		const data = detail.value;
		if (!data || data.idea.slug !== location.idea) {
			const unavailable = detailError.value;
			// On the page this is the document's one <h1>; in the drawer it sits under the drawer's <h2>.
			const Heading = mode === "page" ? "h1" : "h3";
			return unavailable
				? (
					<div class="fb-idea">
						<Button
							class="fb-back"
							label="All ideas"
							icon={<Icon name="arrow-left" />}
							size="sm"
							variant="text"
							severity="secondary"
							onClick={backToBoard}
						/>
						<Heading class="fb-idea__title" tabIndex={-1} ref={titleRef}>
							{unavailable.title}
						</Heading>
						<Message severity="warning" variant="subtle">{unavailable.text}</Message>
					</div>
				)
				: (
					<div class="fb-drawer__loading" aria-label="Loading the idea">
						<Skeleton lines={1} width="40%" />
						<Skeleton lines={4} />
					</div>
				);
		}
		return (
			<IdeaDetail
				detail={data}
				headingLevel={mode === "page" ? 1 : 3}
				voteOf={(idea) => votes.states.value[idea.slug]}
				signedIn={signedIn}
				signInHref={signInHref}
				boardHref={feedbackBoardHref(mode, currentHref)}
				onBack={backToBoard}
				hrefOf={hrefOf}
				onOpen={openIdea}
				onVote={(idea) => void vote(idea)}
				titleRef={(el) => (titleRef.current = el)}
			/>
		);
	}

	function composeView(): JSX.Element {
		if (!signedIn) {
			return (
				<div class="fb-compose">
					{mode === "drawer" && <h3 class="fb-compose__heading">Suggest an idea</h3>}
					<p class="fb-compose__note">Sign in to suggest an idea and vote on others.</p>
					<div>{suggest}</div>
				</div>
			);
		}
		return (
			<IdeaComposeForm
				formId={FEEDBACK_COMPOSE_FORM_ID}
				state={compose}
				votes={votes}
				heading={mode === "drawer"}
				hrefOf={hrefOf}
				onOpenIdea={openIdea}
				onShowSent={(idea) => {
					votes.seed([idea]);
					resetCompose(compose);
					void loadBoard(location);
					detail.value = null;
					openIdea(idea.slug);
				}}
				onDone={closeCompose}
				onAnother={() => resetCompose(compose)}
				announce={(text) => (announcement.value = text)}
			/>
		);
	}
	// #endregion

	const view = mode === "drawer" ? location.view : location.view === "idea" ? "idea" : "board";
	return (
		<div class="fb-board" ref={rootRef} data-mode={mode}>
			<p class="ui-visually-hidden" aria-live="polite">{announcement.value}</p>
			{view === "idea" ? ideaView() : view === "compose" ? composeView() : boardView()}
			{mode === "page" && (
				<Dialog
					visible={composeOpen}
					onVisibleChange={(open) => {
						if (!open) closeCompose();
					}}
					header="Suggest an idea"
					width="var(--overlay-w-md)"
					class="fb-dialog"
					footer={signedIn && compose.sent.value === null
						? (
							<ComposeActions
								formId={FEEDBACK_COMPOSE_FORM_ID}
								state={compose}
								onCancel={closeCompose}
							/>
						)
						: undefined}
				>
					{composeView()}
				</Dialog>
			)}
		</div>
	);
}
